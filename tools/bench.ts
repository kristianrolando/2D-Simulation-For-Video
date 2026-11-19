// Performance benchmark (Node, offline renderer path). Draw cost per frame, total, memory.
//   node tools/bench.ts [--out docs/evidence/bench/<name>.json] [--encode]
// Without --encode it measures simulation+drawing only (the part we control); --encode runs the
// full job (ffmpeg + audio) through renderJob for wall-clock numbers.
import '../apps/server/host.ts'; // bundled fonts + style themes
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { validate, type Env, type Ctx } from '../packages/core/index.ts';
import { SCENES } from '../packages/scenes/index.ts';
import { renderJob, ROOT } from '../apps/server/render-job.ts';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only');
// --style <id>: run every case in that style (measures the cost of a theme)
const style = opt('--style');
const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: 1 };

const presetFiles = fs.readdirSync(path.join(ROOT, 'presets')).filter(f => f.endsWith('.json')).sort();
const cases = presetFiles.map(f => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(ROOT, 'presets', f), 'utf8')) }))
  .filter(c => !only || only.split(',').some(o => c.name === o || c.name.includes(o)));

const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
const results: Record<string, unknown>[] = [];
for (const c of cases) {
  const scene = SCENES.find(s => s.meta.id === c.sceneId);
  if (!scene) continue;
  const { params } = validate(scene.schema, style ? { ...c.params, style } : c.params);
  (globalThis as any).gc?.();
  const rss0 = process.memoryUsage().rss;
  let rssPeak = rss0;
  const t0 = performance.now();
  const inst = scene.create(env, params);
  const setup = performance.now() - t0;
  const canvas = createCanvas(scene.meta.width, scene.meta.height); const ctx = canvas.getContext('2d') as unknown as Ctx;
  const d: number[] = [];
  const tl = performance.now();
  for (let i = 0; i < inst.frames; i++) {
    const a = performance.now(); inst.renderFrame(ctx, i); canvas.data(); d.push(performance.now() - a);
    if ((i & 31) === 0) rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }
  const loop = (performance.now() - tl) / 1000;
  const a0 = performance.now(); scene.audio(params); const audioMs = performance.now() - a0;
  const s = d.slice().sort((x, y) => x - y);
  const r: Record<string, unknown> = { name: c.name, frames: inst.frames, setupMs: +setup.toFixed(0), audioMs: +audioMs.toFixed(0),
    drawP50: +q(s, 0.5).toFixed(2), drawP95: +q(s, 0.95).toFixed(2), drawMax: +q(s, 1).toFixed(1), drawLoopSec: +loop.toFixed(2),
    rssDeltaMB: +((rssPeak - rss0) / 1048576).toFixed(0), rssPeakMB: +(rssPeak / 1048576).toFixed(0) };
  if (args.includes('--encode')) {
    const out = path.join(ROOT, 'work', 'bench-' + c.name + '.mp4');
    const rep: any = await renderJob({ sceneId: c.sceneId, params: style ? { ...c.params, style } : c.params, out });
    r.renderTotalSec = rep.totalSec; r.realtimeFactor = rep.realtimeFactor;
    fs.rmSync(out, { force: true }); fs.rmSync(out.replace(/\.mp4$/, '.job.json'), { force: true });
  }
  results.push(r);
  console.log(JSON.stringify(r));
}
if (opt('--out')) fs.writeFileSync(opt('--out')!, JSON.stringify({ when: new Date().toISOString(), node: process.version, results }, null, 1) + '\n');
