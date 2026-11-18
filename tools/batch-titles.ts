// Re-write the suggested title + description of the batch videos (data/batch/state.json) with the current writer, so that no two
// batch videos share a title. Changes ONLY videos of this batch that are still plain "rendered" renders (no YouTube link, no
// upload/schedule status, no notes). The old texts are saved first in data/batch/old-titles.json, so it can be undone.
//   node tools/batch-titles.ts             dry run: shows what would change (nothing is written)
//   node tools/batch-titles.ts --apply     write the new titles and descriptions through the studio API
//   node tools/batch-titles.ts --undo      put the saved old titles and descriptions back
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestFor, descriptionFor } from '../packages/publish/describe.ts';
import type { PlanItem } from './batch-plan.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:5180';
const APPLY = process.argv.includes('--apply'), UNDO = process.argv.includes('--undo');
const dir = path.join(ROOT, 'data/batch'), OLD = path.join(dir, 'old-titles.json');
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
const taken = new Set(videos.filter(v => !batchJobs.has(v.jobId)).map(v => String(v.title).trim().toLowerCase()));   // titles of the videos that are not in the batch
const changes: { id: string; key: string; title: string; description: string; was: string }[] = [], skipped: string[] = [];
for (const item of plan) {
  const j = state[item.key]; const v = j && mine.get(j.jobId);
  if (!v) { skipped.push(`${item.key}: no video entry`); continue; }
  if (v.status !== 'rendered' || v.youtubeUrl || String(v.notes ?? '').trim()) { skipped.push(`${item.key}: already worked on (${v.status})`); continue; }
  const sug = suggestFor(item.sceneId, v.params); if (!sug) continue;
  const candidates = [sug.title, ...sug.titles.map(t => t.text)];
  const title = candidates.find(t => !taken.has(t.trim().toLowerCase())) ?? sug.title;   // first idea nobody has; the writer's own pick when all are used
  taken.add(title.trim().toLowerCase());
  const description = title === sug.title ? sug.description : (descriptionFor(item.sceneId, v.params, title, 0) ?? sug.description);
  changes.push({ id: v.id, key: item.key, title, description, was: v.title });
}
const distinct = new Set(changes.map(c => c.title.toLowerCase())).size;
console.log(`batch videos ${changes.length + skipped.length} · to rewrite ${changes.length} · skipped ${skipped.length} · distinct new titles ${distinct} · titles before ${new Set(changes.map(c => c.was.toLowerCase())).size}`);
for (const s of skipped.slice(0, 5)) console.log('  skipped', s);
for (const c of changes.filter((_, i) => i % 25 === 0)) console.log(`  ${c.key}\n     was: ${c.was}\n     now: ${c.title}`);
if (!APPLY) { console.log('dry run: nothing written. Add --apply to write.'); process.exit(0); }

const oldSaved: Record<string, { title: string; description: string }> = fs.existsSync(OLD) ? JSON.parse(fs.readFileSync(OLD, 'utf8')) : {};
for (const c of changes) { const v = videos.find(x => x.id === c.id); if (!(c.id in oldSaved)) oldSaved[c.id] = { title: v.title, description: v.description }; }
fs.writeFileSync(OLD, JSON.stringify(oldSaved, null, 1));
let done = 0; for (const c of changes) { await api(`/api/videos/${c.id}`, { method: 'PATCH', body: JSON.stringify({ title: c.title, description: c.description }) }); done++; }
console.log(`written ${done} videos. Old texts saved in data/batch/old-titles.json (undo: node tools/batch-titles.ts --undo).`);
