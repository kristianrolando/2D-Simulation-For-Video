// Long videos from the terminal: the same operations as the studio's Compile page (apps/server/compile-ops.ts), for when the studio is not
// running the new code or when many long videos are built in one go. Local only: it never talks to YouTube and never touches a Short.
//   node tools/compile.ts plan [--seed N] [--write]     show the suggested long videos; --write saves them as drafts (data/compilations)
//   node tools/compile.ts list                          the saved long videos: status, length, text problems
//   node tools/compile.ts texts <id|slug> [--title N]   write the texts again (N = 1..5 picks one of the five title ideas)
//   node tools/compile.ts check <id|slug>               the text checker, plus the chapter list
//   node tools/compile.ts build <id|slug|all>           build (finished clips are reused; stop it any time and run it again)
//   node tools/compile.ts thumb <id|slug>               make the 1280×720 thumbnail
//   node tools/compile.ts verify <id|slug>              re-check a finished video (sizes, codecs, frames, a full decode, black frames)
// The finished MP4 goes to output/ and the thumbnail to data/thumbnails/. The studio adds the entry to the Videos list the next time it
// starts with this code (it never edits data/videos.json from here: the running studio owns that file).
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeVideo, type Video } from '../packages/publish/index.ts';
import { chapterLines, outFileFor, totalFrames, totalSeconds, type Compilation } from '../packages/compile/index.ts';
import { partMinutes } from '../packages/compile/select.ts';
import { writeLongTexts } from '../packages/compile/texts.ts';
import { openCompileStore } from '../apps/server/compile-store.ts';
import { applyReport, buildRequest, issuesOf, library, makeThumbnail, newCompilation, planParts, rewriteTexts } from '../apps/server/compile-ops.ts';
import { buildCompilation, verifyOutput } from '../apps/server/compile-build.ts';
import { toClipRef } from '../packages/compile/select.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = process.env.SIM_DATA_DIR ? path.resolve(process.env.SIM_DATA_DIR) : path.join(ROOT, 'data');
const OUT = process.env.SIM_OUT_DIR ? path.resolve(process.env.SIM_OUT_DIR) : path.join(ROOT, 'output');
const THUMBS = path.join(DATA, 'thumbnails'), CACHE = path.join(DATA, 'compilations', 'cache');
const args = process.argv.slice(2), cmd = args[0] ?? 'list', opt = (k: string, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = Number(opt('--seed', '20261119'));
const store = openCompileStore(path.join(DATA, 'compilations'));
const videos = (): Video[] => { const j = JSON.parse(fs.readFileSync(path.join(DATA, 'videos.json'), 'utf8')); return (j.videos as unknown[]).map(v => sanitizeVideo(v)).filter((v): v is Video => !!v); };
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** a studio that already knows long videos owns these records while it runs: writing from here would be overwritten by it */
async function studioOwns(): Promise<boolean> {
  try { const r = await fetch(`http://127.0.0.1:${process.env.PORT || 5180}/api/compile`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
const pick = (key: string, list: Compilation[]) => list.find(c => c.id === key || c.slug === key);
const die = (msg: string): never => { console.error(msg); process.exit(1); };

const list = store.load(); if (store.notice()) console.warn('note:', store.notice());
const needsWrite = cmd === 'texts' || cmd === 'build' || cmd === 'thumb' || (cmd === 'plan' && args.includes('--write'));
if (needsWrite && await studioOwns()) die('The studio is running with long-video support and owns these records. Use its Compile page, or stop the studio first.');

if (cmd === 'plan') {
  const L = library(videos(), OUT), plan = planParts(L.candidates, seed), used = new Set(list.flatMap(c => c.clips.map(k => k.videoId)));
  console.log(`${L.total} Shorts · ${L.candidates.length} usable · ${plan.twins.length} twins left out · ${L.left.length} not usable (${[...new Set(L.left.map(x => x.why.replace(/ \(.*/, '')))].join('; ')})`);
  let made = 0, minutes = 0;
  for (const p of plan.parts) {
    const clips = p.clips.map(toClipRef), t = writeLongTexts({ group: p.group, part: p.part, parts: p.parts, clips, seed }), mins = partMinutes(p.clips), done = p.clips.every(x => used.has(x.videoId));
    minutes += mins;
    console.log(`${p.group.padEnd(22)} ${p.part}/${p.parts}  ${String(p.clips.length).padStart(2)} clips  ${mins.toFixed(1).padStart(5)} min  ${done ? '(saved)' : ''}  ${t.title}`);
    if (args.includes('--write') && !done) { const c = newCompilation(p, list, seed); store.save(c); list.push(c); for (const x of p.clips) used.add(x.videoId); made++; }
  }
  console.log(`${plan.parts.length} long videos · ${plan.totalClips} clips · ${minutes.toFixed(0)} min${args.includes('--write') ? ` · ${made} saved as drafts in data/compilations` : ' · dry run (add --write to save them as drafts)'}`);
} else if (cmd === 'list') {
  if (!list.length) console.log('No long videos yet. Try: node tools/compile.ts plan --write');
  for (const c of list) { const iss = issuesOf(c); console.log(`${c.id}  ${c.slug.padEnd(30)} ${c.status.padEnd(8)} ${String(c.clips.length).padStart(2)} clips ${fmt(totalSeconds(c.clips)).padStart(6)}  ${iss.length ? iss.map(i => `${i.severity}:${i.code}`).join(',') : 'texts ok'}  ${c.title}`); }
} else if (cmd === 'texts' || cmd === 'check' || cmd === 'verify' || cmd === 'thumb' || cmd === 'build') {
  const key = args[1] ?? ''; const targets = key === 'all' && cmd === 'build' ? list.filter(c => c.status !== 'built') : [pick(key, list) ?? die(`No long video "${key}". Try: node tools/compile.ts list`)];
  for (let c of targets) {
    if (cmd === 'texts') { const ti = opt('--title') ? Number(opt('--title')) - 1 : undefined; c = rewriteTexts(c, ti === undefined ? { keepTitle: false } : { titleIndex: ti }); store.save(c); console.log(`${c.slug}: ${c.title}`); }
    else if (cmd === 'check') { const iss = issuesOf(c); console.log(`${c.slug}: ${c.title}\n${chapterLines(c.clips).join('\n')}\n${iss.length ? iss.map(i => `${i.severity.toUpperCase()} ${i.code}: ${i.text}`).join('\n') : 'texts ok'}`); }
    else if (cmd === 'thumb') { const f = await makeThumbnail(c, videos(), OUT, THUMBS); store.save({ ...c, thumbFile: f, updatedAt: new Date().toISOString() }); console.log(`${c.slug}: ${path.join(THUMBS, f)}`); }
    else if (cmd === 'verify') {
      const file = path.join(OUT, c.file || outFileFor(c)); const { problems, facts } = await verifyOutput(file, totalFrames(c.clips));
      console.log(`${c.slug}: ${facts.width}×${facts.height} ${facts.fps} ${facts.vcodec}/${facts.acodec} ${facts.frames} frames ${facts.durationSec.toFixed(2)} s · ${problems.length ? problems.join(' | ') : 'all checks passed'}`); if (problems.length) process.exitCode = 1;
    } else {
      if (c.status === 'building') die(`${c.slug} is marked as building (a studio build). Use the studio, or fix the record first.`);
      const t0 = Date.now(); console.log(`build ${c.slug}: ${c.clips.length} clips…`);
      store.save({ ...c, status: 'building', error: '', updatedAt: new Date().toISOString() });
      try {
        const rep = await buildCompilation(buildRequest(c, OUT, CACHE), p => process.stdout.write(`\r  ${p.phase.padEnd(9)} ${Math.round((100 * p.frame) / p.frames)}%   `));
        let next = applyReport(c, rep); store.save(next); process.stdout.write('\n');
        try { next = { ...next, thumbFile: await makeThumbnail(next, videos(), OUT, THUMBS) }; store.save(next); } catch (e) { console.warn('  thumbnail failed:', (e as Error).message); }
        console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${fmt(rep.durationSec)} · ${(rep.sizeBytes / 1e6).toFixed(0)} MB · ${rep.made} clips made, ${rep.reused} reused · ${rep.checks.join(' · ')}`);
      } catch (e) {
        store.save({ ...c, status: 'failed', error: (e as Error).message.slice(0, 400), note: 'Run the build again: finished clips are reused.', updatedAt: new Date().toISOString() });
        die(`\n  failed: ${(e as Error).message}`);
      }
    }
  }
} else die('Commands: plan | list | texts | check | build | thumb | verify (see the top of tools/compile.ts)');
