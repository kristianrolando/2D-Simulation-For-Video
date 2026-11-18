// Thumbnails for the studio gallery: rendered ONCE per (scene, params) at quarter resolution, cached as
// PNG under output/thumbs/<hash>.png and reused forever (the hash changes only if the params change).
//   node apps/server/thumbs.ts            -> generate every missing preset/scene thumbnail
import './host.ts'; // bundled fonts + style themes
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validate, type Ctx, type Env } from '../../packages/core/index.ts';
import { sceneById, SCENES } from '../../packages/scenes/index.ts';
import { themeIds } from '../../packages/theme/index.ts';
import { customSig } from '../../packages/theme/node.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const THUMBS = path.join(ROOT, 'output', 'thumbs');

export function thumbKey(sceneId: string, params: Record<string, unknown>) {
  const s = sceneById(sceneId); if (!s) return null;
  const { params: p } = validate(s.schema, params);
  if (p.stylePreset === '') delete p.stylePreset; // no preset: the key is what it was before presets existed (the thumbnails stay cached)
  const sig = customSig(String(p.style ?? '')); // '' for shipped styles: their cache keys stay as they were
  return createHash('sha1').update(JSON.stringify(sig ? [sceneId, p, 'v2', sig] : [sceneId, p, 'v2'])).digest('hex').slice(0, 16);
}

export function renderThumb(sceneId: string, params: Record<string, unknown>): string | null {
  const s = sceneById(sceneId); const key = thumbKey(sceneId, params); if (!s || !key) return null;
  const file = path.join(THUMBS, key + '.png');
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(THUMBS, { recursive: true });
  const scale = 0.25;
  const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale, quality: { particles: 0.5, glow: true } };
  const { params: p } = validate(s.schema, params);
  const inst = s.create(env, p);
  const c = createCanvas(Math.round(s.meta.width * scale), Math.round(s.meta.height * scale));
  const ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // a late frame shows the finished pattern; stop just before the answer text appears
  inst.renderFrame(ctx, Math.floor(inst.frames * 0.82));
  fs.writeFileSync(file, c.toBuffer('image/png'));
  return file;
}

/** one thumbnail per style for a scene configuration (the studio's style picker) */
export function styleThumbs(sceneId: string, params: Record<string, unknown>) {
  return themeIds().map(style => ({ style, key: thumbKey(sceneId, { ...params, style })! }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // --styles <sceneId> <paramsJSON>: render that configuration in every style (style picker)
  const si = process.argv.indexOf('--styles');
  if (si > 0) {
    const id = process.argv[si + 1], p = JSON.parse(process.argv[si + 2] ?? '{}');
    for (const style of themeIds()) renderThumb(id, { ...p, style });
    process.exit(0);
  }
  const jobs: [string, Record<string, unknown>][] = SCENES.map(s => [s.meta.id, {}]);
  const pdir = path.join(ROOT, 'presets');
  for (const f of fs.readdirSync(pdir).filter(f => f.endsWith('.json'))) { const j = JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')); jobs.push([j.sceneId, j.params ?? {}]); }
  for (const [id, p] of jobs) {
    const key = thumbKey(id, p); if (!key) continue;
    const had = fs.existsSync(path.join(THUMBS, key + '.png'));
    const t = performance.now(); renderThumb(id, p);
    console.log(`${had ? 'cached ' : 'created'} ${id} ${JSON.stringify(p).slice(0, 50)} ${had ? '' : (performance.now() - t).toFixed(0) + ' ms'}`);
  }
}
