// Re-write the suggested title + description of the batch videos (data/batch/state.json) with the current writer, so that no two
// batch videos share a title. Changes ONLY videos of this batch that are still plain "rendered" renders (no YouTube link, no
// upload/schedule status, no notes). The old texts are saved first in data/batch/old-titles.json, so it can be undone.
//   node tools/batch-titles.ts             dry run: shows what would change (nothing is written)
//   node tools/batch-titles.ts --apply     write the new titles and descriptions through the studio API
//   node tools/batch-titles.ts --undo      put the saved old titles and descriptions back
//   --strict                               also avoid titles that are NEARLY the same (word overlap ≥ 0.75) as a title outside the batch, and
//                                          any title already given inside it; prints how many are still near
//   --own-title                            (with --strict) also offer the video's own on-screen title (params.title) as a title idea; for a batch whose
//                                          on-screen titles were written to be different from the others (Fourier Loom). Off by default: Photon and Plasma unchanged.
//   --dir <folder>                         another batch (default data/batch), e.g. --dir data/batch-plasma: its own plan, state and old-titles.json;
//                                          titles already used by any video OUTSIDE that batch (Photon Lab's included) are avoided
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestFor, descriptionFor, hookFor, factsFor, topicFor } from '../packages/publish/describe.ts';
import { checkQuality } from '../packages/publish/quality.ts';
import type { PlanItem } from './batch-plan.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:5180';
const APPLY = process.argv.includes('--apply'), UNDO = process.argv.includes('--undo');
const di = process.argv.indexOf('--dir'), dir = di >= 0 ? path.resolve(process.argv[di + 1]) : path.join(ROOT, 'data/batch'), OLD = path.join(dir, 'old-titles.json');
async function api(p: string, init?: RequestInit) { const r = await fetch(BASE + p, { ...init, headers: { 'content-type': 'application/json' } }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json() as Promise<any>; }

const listed = await api('/api/videos');
const videos: any[] = Array.isArray(listed) ? listed : listed.videos;
const plan: PlanItem[] = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).items;
const state: Record<string, { jobId: string }> = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));

if (UNDO) {
  const old: Record<string, { title: string; description: string }> = JSON.parse(fs.readFileSync(OLD, 'utf8'));
  let n = 0; for (const [id, o] of Object.entries(old)) { await api(`/api/videos/${id}`, { method: 'PATCH', body: JSON.stringify(o) }); n++; }
  console.log(`restored ${n} videos`); process.exit(0);
}

const batchJobs = new Set(Object.values(state).map(s => s.jobId));
const mine = new Map(videos.filter(v => batchJobs.has(v.jobId)).map(v => [v.jobId, v]));
const outside = videos.filter(v => !batchJobs.has(v.jobId)).map(v => String(v.title).trim().toLowerCase());
const taken = new Set(outside);   // titles of the videos that are not in the batch
const STRICT = process.argv.includes('--strict'), OWN_TITLE = process.argv.includes('--own-title');
/** words of a title without emoji, punctuation and the " — variant" tail, for the overlap measure */
const words = (t: string) => new Set(t.toLowerCase().split(' — ')[0].replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1));
const jacc = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i); };
const outsideWords = outside.map(words);
const nearest = (t: string) => { const w = words(t); let m = 0; for (const o of outsideWords) { const j = jacc(w, o); if (j > m) m = j; } return m; };
const changes: { id: string; key: string; title: string; description: string; was: string }[] = [], skipped: string[] = [];
for (const item of plan) {
  const j = state[item.key]; const v = j && mine.get(j.jobId);
  if (!v) { skipped.push(`${item.key}: no video entry`); continue; }
  if (v.status !== 'rendered' || v.youtubeUrl || String(v.notes ?? '').trim()) { skipped.push(`${item.key}: already worked on (${v.status})`); continue; }
  const sug = suggestFor(item.sceneId, v.params); if (!sug) continue;
  const candidates = [sug.title, ...sug.titles.map(t => t.text)];
  if (STRICT) {
    // the video's own on-screen hook as a title (it is written for this video and says only what its parameters say), with the variant
    // words of the two templates ("in a square with stars"); the writer's own ideas come first, except for a tilted Galton board, whose
    // writer titles talk about a bell curve
    const lines = hookFor(item.sceneId, v.params).split(/\s*—\s*|\n/).map(x => x.trim()).filter(Boolean);
    const joined = lines.reduce((a, b) => (a ? (/[.?!:]$/.test(a) ? `${a} ${b}` : `${a}: ${b.charAt(0).toLowerCase()}${b.slice(1)}`) : b), '');
    const tag = factsFor(item.sceneId, v.params).tag;
    const own = [tag ? `${joined} — ${tag}` : joined, joined].filter(Boolean);
    if (OWN_TITLE) {   // the title shown on screen, flattened the same way (a different wording by design), with and without the variant tag
      const sc = String((v.params as any)?.title ?? '').split('\n').map((x: string) => x.trim()).filter(Boolean).reduce((a: string, b: string) => (a ? (/[.?!:]$/.test(a) ? `${a} ${b}` : `${a}: ${b.charAt(0).toLowerCase()}${b.slice(1)}`) : b), '');
      if (sc) {   // the full tag can make the title longer than YouTube's 100 characters: offer shorter tags too (the keyword is added below)
        const parts = tag ? tag.split(/,\s*/) : [], short = [] as string[];
        for (let k = parts.length; k >= 1; k--) short.push(`${sc} — ${parts.slice(0, k).join(', ')}`, `${sc} — ${parts.slice(-k).join(', ')}`);
        if (item.sceneId === 'hammer-smash') {   // when the template words run out: two true facts of the video (its hammers, its starting balls)
          const P = v.params as any, h = `${P.hammers} hammer${Number(P.hammers) === 1 ? '' : 's'}`, b = `starts with ${P.startBalls} ball${Number(P.startBalls) === 1 ? '' : 's'}`;
          short.push(`${sc} — ${h}, ${parts[0] ?? ''}`.replace(/, $/, ''), `${sc} — ${b}, ${parts[0] ?? ''}`.replace(/, $/, ''), `${sc} — ${h}, ${b}`);
        }
        own.unshift(...short, sc);
      }
    }
    if (item.sceneId === 'billiard') own.push(`${joined} — ${Math.round(Number(v.params.maxBounces))} bounces`);   // two videos on one table differ in their bounce count
    // a title needs the topic's search keyword (the quality checker says so); add it where the hook lacks it, except for a tilted Galton
    // board: its keyword is "bell curve", which is not what that board draws
    const topic = topicFor(item.sceneId, v.params), tilted = item.sceneId === 'galton-board' && Math.abs(Number(v.params.p ?? 0.5) - 0.5) > 0.01;
    if (!tilted) for (const t of [...own]) if (!topic.keywords.some(k => t.toLowerCase().includes(k))) own.push(`${t} — ${topic.keyword}`);
    if (item.sceneId === 'galton-board' && Math.abs(Number(v.params.p ?? 0.5) - 0.5) > 0.01) candidates.splice(0, candidates.length, ...own); else candidates.push(...own);
  }
  const fresh = (t: string) => !taken.has(t.trim().toLowerCase());
  const clean = (t: string) => !checkQuality({ ...(v as any), title: t }, { topic: topicFor(item.sceneId, v.params), facts: factsFor(item.sceneId, v.params), otherTitles: [] }).some(i => i.severity !== 'info' && i.field === 'title');
  const title = (STRICT ? candidates.find(t => fresh(t) && nearest(t) < 0.75 && clean(t)) ?? candidates.find(t => fresh(t) && clean(t)) ?? candidates.find(t => fresh(t) && nearest(t) < 0.75) : undefined) ?? candidates.find(fresh) ?? sug.title;   // first idea nobody has; the writer's own pick when all are used
  taken.add(title.trim().toLowerCase());
  const description = title === sug.title ? sug.description : (descriptionFor(item.sceneId, v.params, title, 0) ?? sug.description);
  changes.push({ id: v.id, key: item.key, title, description, was: v.title });
}
const distinct = new Set(changes.map(c => c.title.toLowerCase())).size;
if (STRICT) { const near = changes.filter(c => nearest(c.title) >= 0.75); console.log(`still nearly the same as a title outside the batch: ${near.length}`); for (const c of near.slice(0, 12)) console.log(`   ${c.key}: ${c.title}`); const cnt: Record<string, number> = {}; for (const c of changes) cnt[c.title.toLowerCase()] = (cnt[c.title.toLowerCase()] ?? 0) + 1; for (const [t, n] of Object.entries(cnt)) if (n > 1) console.log(`   used ${n}×: ${t}`); }
console.log(`batch videos ${changes.length + skipped.length} · to rewrite ${changes.length} · skipped ${skipped.length} · distinct new titles ${distinct} · titles before ${new Set(changes.map(c => c.was.toLowerCase())).size}`);
for (const s of skipped.slice(0, 5)) console.log('  skipped', s);
for (const c of changes.filter((_, i) => i % 25 === 0)) console.log(`  ${c.key}\n     was: ${c.was}\n     now: ${c.title}`);
if (!APPLY) { console.log('dry run: nothing written. Add --apply to write.'); process.exit(0); }

const oldSaved: Record<string, { title: string; description: string }> = fs.existsSync(OLD) ? JSON.parse(fs.readFileSync(OLD, 'utf8')) : {};
for (const c of changes) { const v = videos.find(x => x.id === c.id); if (!(c.id in oldSaved)) oldSaved[c.id] = { title: v.title, description: v.description }; }
fs.writeFileSync(OLD, JSON.stringify(oldSaved, null, 1));
let done = 0; for (const c of changes) { await api(`/api/videos/${c.id}`, { method: 'PATCH', body: JSON.stringify({ title: c.title, description: c.description }) }); done++; }
console.log(`written ${done} videos. Old texts saved in ${path.relative(ROOT, OLD)} (undo: node tools/batch-titles.ts${di >= 0 ? ' --dir ' + process.argv[di + 1] : ''} --undo).`);
