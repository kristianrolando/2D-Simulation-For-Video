// npm run render -- <sceneId> [--preset name | --job file.json] [--params '{"k":v}'] [--out file.mp4]
//                              [--hash hashes.txt] [--png 1,2.5 --pngdir dir] [--frames N] [--no-video]
import fs from 'node:fs';
import path from 'node:path';
import { renderJob, ROOT } from './render-job.ts';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
let sceneId = args[0], params: Record<string, unknown> = {};
const jobFile = opt('--job') ?? (opt('--preset') ? path.join(ROOT, 'presets', opt('--preset')! + '.json') : undefined);
if (jobFile) { const j = JSON.parse(fs.readFileSync(jobFile, 'utf8')); sceneId = j.sceneId; params = j.params ?? {}; }
if (opt('--params')) params = { ...params, ...JSON.parse(opt('--params')!) };
if (!sceneId || sceneId.startsWith('--')) { console.error('usage: npm run render -- <sceneId> [--preset name] [--params json] [--out file]'); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.resolve(opt('--out') ?? path.join(ROOT, 'output', `${sceneId}-${stamp}.mp4`));
const report = await renderJob({
  sceneId, params, out, hashFile: opt('--hash'), maxFrames: opt('--frames') ? +opt('--frames')! : undefined,
  pngAt: opt('--png')?.split(',').map(Number), pngDir: opt('--pngdir') ?? path.join(ROOT, 'output', 'frames', sceneId),
  noVideo: args.includes('--no-video'),
}, p => { if (process.stderr.isTTY) process.stderr.write(`\r${p.phase} ${p.frame}/${p.frames} ${p.fps.toFixed(0)} fps   `); });
if (process.stderr.isTTY) process.stderr.write('\n');
console.log(JSON.stringify(report, null, 1));
