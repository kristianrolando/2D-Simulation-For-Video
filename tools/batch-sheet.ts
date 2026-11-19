// Contact sheets of a batch plan: one small frame near the end of every video (renders in this process, no studio, nothing is sent or saved
// in the studio). Used to look at a plan before it is rendered for real.
//   node tools/batch-sheet.ts --dir data/batch-plasma --out <folder> [--at 0.9] [--scale 0.16] [--cols 8] [--per 40] [--only plasma:hammer]
// Prints one line per video that looks empty (almost only background) and writes sheet-1.png, sheet-2.png … into --out.
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { validate, type Ctx, type Env } from '../packages/core/index.ts';
import { sceneById } from '../packages/scenes/index.ts';
import type { PlanItem } from './batch-plan.ts';

const args = process.argv.slice(2), opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(opt('--dir', 'data/batch')!), out = path.resolve(opt('--out', 'sheets')!);
const at = +opt('--at', '0.9')!, scale = +opt('--scale', '0.16')!, cols = +opt('--cols', '8')!, per = +opt('--per', '40')!, only = opt('--only');
const items: PlanItem[] = (JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8')).items as PlanItem[]).filter(i => !only || i.key.includes(only) || i.sceneId.includes(only));
const W = 1080, H = 1920, w = Math.round(W * scale), h = Math.round(H * scale), LAB = 14;
fs.mkdirSync(out, { recursive: true });
let sheet = 0, bad = 0; const empty: string[] = [];
for (let s = 0; s < items.length; s += per) {
  const part = items.slice(s, s + per), rows = Math.ceil(part.length / cols);
  const cv = createCanvas(cols * w, rows * (h + LAB)), g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  part.forEach((it, k) => {
    const scene = sceneById(it.sceneId)!, { params } = validate(scene.schema, it.params);
    const env: Env = { createCanvas: (a, b) => createCanvas(a, b) as any, scale };
    const c = createCanvas(w, h), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0);
    try {
      const inst = scene.create(env, params); inst.renderFrame(ctx, Math.floor((inst.frames - 1) * at));
      // "empty" = almost every pixel in the middle of the picture is (nearly) the background colour
      const px = (c.getContext('2d') as any).getImageData(0, Math.round(h * 0.2), w, Math.round(h * 0.6)).data as Uint8ClampedArray;
      let ink = 0; const n = px.length / 4, ref = [px[0], px[1], px[2]];
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - ref[0]) + Math.abs(px[i + 1] - ref[1]) + Math.abs(px[i + 2] - ref[2]) > 90) ink++;
      if (ink / n < 0.02) empty.push(`${it.key} (ink ${(100 * ink / n).toFixed(1)}%)`);
    } catch (e) { bad++; console.log('FAILED', it.key, e instanceof Error ? e.message : e); }
    const x = (k % cols) * w, y = Math.floor(k / cols) * (h + LAB);
    g.drawImage(c, x, y + LAB); g.fillStyle = '#fff'; g.font = '10px DejaVuSans'; g.fillText(`${s + k + 1} ${it.key.replace('plasma:', '')}`.slice(0, Math.floor(w / 5.6)), x + 2, y + 11);
  });
  fs.writeFileSync(path.join(out, `sheet-${++sheet}.png`), cv.toBuffer('image/png'));
  console.log(`sheet-${sheet}.png: videos ${s + 1}-${s + part.length}`);
}
console.log(`videos ${items.length} · failed to draw ${bad} · looking empty ${empty.length}`); for (const e of empty) console.log('  empty:', e);
