// Prints the same checksum of a scene's state vector as the studio's browser console snippet in docs/report.md,
// so preview (browser) and render (Node) can be compared frame by frame.
//   node tools/state-sig.ts <sceneId> '<paramsJSON>' <frame,frame,...>
import '../apps/server/host.ts';
import { createCanvas } from '@napi-rs/canvas';
import { validate, type Ctx } from '../packages/core/index.ts';
import { sceneById } from '../packages/scenes/index.ts';
const [id, pjson, list] = process.argv.slice(2);
const s = sceneById(id)!, P = validate(s.schema, JSON.parse(pjson)).params, scale = 0.5;
const inst = s.create({ createCanvas: (w, h) => createCanvas(w, h) as any, scale }, P);
const c = createCanvas(Math.round(1080 * scale), Math.round(1920 * scale)), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(scale, 0, 0, scale, 0, 0);
const out: Record<number, [number, string]> = {};
for (const f of list.split(',').map(Number)) { inst.renderFrame(ctx, f); const v = inst.stateVector!(); let sum = 0; for (let i = 0; i < v.length; i++) sum += v[i] * ((i % 7) + 1); out[f] = [v.length, sum.toPrecision(17)]; }
console.log(JSON.stringify(out));
