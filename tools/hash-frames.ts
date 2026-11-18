// Frame + audio hashes of a scene from any source tree (used to prove the classic style is unchanged).
//   node tools/hash-frames.ts <root> <sceneId|preset:name>
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const [root, which] = process.argv.slice(2);
GlobalFonts.registerFromPath(path.join(root, 'assets/fonts/DejaVuSans-Bold.ttf'), 'DejaVuSansBold');
const core = await import(path.join(root, 'packages/core/index.ts'));
const { SCENES } = await import(path.join(root, 'packages/scenes/index.ts'));
let id = which, params = {};
if (which.startsWith('preset:')) { const j = JSON.parse(fs.readFileSync(path.join(root, 'presets', which.slice(7) + '.json'), 'utf8')); id = j.sceneId; params = j.params; }
const s = SCENES.find((x: any) => x.meta.id === id);
const p = core.validate(s.schema, params).params;
const env = { createCanvas: (w: number, h: number) => createCanvas(w, h) as any, scale: 0.5 };
const inst = s.create(env, p);
const c = createCanvas(540, 960), ctx = c.getContext('2d') as any; ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
const out: string[] = [];
for (const f of [0, 61, 400, Math.floor(inst.frames * 0.7), inst.frames - 1]) { inst.renderFrame(ctx, f); out.push(createHash('sha1').update(c.data()).digest('hex').slice(0, 10)); }
const m = s.audio(p); out.push('audio:' + createHash('sha1').update(Buffer.from(m.L.buffer)).digest('hex').slice(0, 10));
console.log(which, out.join(' '));
