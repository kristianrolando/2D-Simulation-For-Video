// In-browser preview benchmark (dev hook: window.__studio.bench). Measures what the preview loop
// pays per frame. `sync` forces the GPU to finish every frame (upper bound, includes readback);
// without it the number is CPU-side only (lower bound). FPS capability = 1000 / p95.
import type { Ctx, Params, SceneModule } from '../../packages/core/index.ts';

export async function benchScene(scene: SceneModule, params: Params, scale: number, opts: { sync?: boolean; frames?: number } = {}) {
  const env = { scale, createCanvas: (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } };
  const canvas = env.createCanvas(Math.round(1080 * scale), Math.round(1920 * scale));
  const ctx = canvas.getContext('2d') as Ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const heap0 = (performance as any).memory?.usedJSHeapSize ?? 0;
  const t0 = performance.now();
  const inst = scene.create(env, params);
  const setup = performance.now() - t0;
  const n = Math.min(inst.frames, opts.frames ?? inst.frames);
  const d: number[] = []; let heapPeak = heap0;
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    inst.renderFrame(ctx, i);
    if (opts.sync) ctx.getImageData(0, 0, 1, 1);
    d.push(performance.now() - a);
    if ((i & 63) === 0) heapPeak = Math.max(heapPeak, (performance as any).memory?.usedJSHeapSize ?? 0);
    if ((i % 600) === 599) await new Promise(r => setTimeout(r, 0));
  }
  d.sort((a, b) => a - b);
  const q = (p: number) => +d[Math.min(d.length - 1, Math.floor(p * (d.length - 1)))].toFixed(2);
  return { scene: scene.meta.id, scale, sync: !!opts.sync, frames: n, setupMs: +setup.toFixed(0), p50: q(0.5), p95: q(0.95), max: q(1),
    over16ms: d.filter(x => x > 16.7).length, fpsCapP95: Math.min(60, +(1000 / Math.max(q(0.95), 1e-3)).toFixed(0)),
    heapDeltaMB: +((heapPeak - heap0) / 1048576).toFixed(1) };
}
