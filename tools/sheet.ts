// Contact sheet of a scene: node tools/sheet.ts <sceneId> <paramsJSON> <frames: 0,25%,last> <out.png>
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import { validate } from '../packages/core/index.ts';
import { sceneById } from '../packages/scenes/index.ts';
const [id, pjson, list, out] = process.argv.slice(2);
const s = sceneById(id)!, P = validate(s.schema, JSON.parse(pjson)).params;
const sc = 0.4, env = { createCanvas: (w: number, h: number) => createCanvas(w, h) as any, scale: sc };
const inst = s.create(env, P);
const fr = list.split(',').map(x => x.endsWith('%') ? Math.floor(inst.frames * +x.slice(0, -1) / 100) : x === 'last' ? inst.frames - 1 : +x);
const W = Math.round(1080 * sc), H = Math.round(1920 * sc), sheet = createCanvas(W * fr.length, H), sg = sheet.getContext('2d');
const c = createCanvas(W, H), ctx = c.getContext('2d') as any; ctx.setTransform(sc, 0, 0, sc, 0, 0);
const t0 = performance.now();
fr.forEach((f, k) => { inst.renderFrame(ctx, f); sg.drawImage(c, k * W, 0); });
fs.writeFileSync(out, sheet.toBuffer('image/png'));
console.log('frames', fr.join(','), 'ms', (performance.now() - t0).toFixed(0), JSON.stringify(inst.diagnostics?.()));
