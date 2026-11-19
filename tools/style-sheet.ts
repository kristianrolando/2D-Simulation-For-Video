// Render the same scene frame in every style, side by side (visual comparison sheet).
//   node tools/style-sheet.ts <sceneId> [--at 0.6] [--params '{...}'] [--styles a,b] [--scale 0.4] [--out docs/evidence/styles/x.png]
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { validate, type Ctx, type Env } from '../packages/core/index.ts';
import { sceneById } from '../packages/scenes/index.ts';
import { themeIds, getTheme } from '../packages/theme/index.ts';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const id = args[0]; const scene = sceneById(id); if (!scene) throw new Error('unknown scene ' + id);
const at = +(opt('--at', '0.6')!), scale = +(opt('--scale', '0.4')!);
const styles = (opt('--styles') ?? themeIds().join(',')).split(',');
const extra = JSON.parse(opt('--params', '{}')!);
const W = Math.round(scene.meta.width * scale), H = Math.round(scene.meta.height * scale), LAB = 56;
const sheet = createCanvas(W * styles.length, H + LAB); const sg = sheet.getContext('2d');
sg.fillStyle = '#111'; sg.fillRect(0, 0, sheet.width, sheet.height);
styles.forEach((s, k) => {
  const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale };
  const { params } = validate(scene.schema, { ...extra, style: s });
  const inst = scene.create(env, params);
  const c = createCanvas(W, H), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const t0 = performance.now(); inst.renderFrame(ctx, Math.floor((inst.frames - 1) * at));
  sg.drawImage(c, k * W, LAB);
  sg.fillStyle = '#fff'; sg.font = '26px DejaVuSansBold'; sg.fillText(getTheme(s).name, k * W + 12, 36);
  console.log(`${s}: ${(performance.now() - t0).toFixed(0)} ms`);
});
const out = opt('--out', `docs/evidence/styles/${id}-sheet.png`)!;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sheet.toBuffer('image/png'));
console.log('wrote', out);
