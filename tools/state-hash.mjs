// node tools/state-hash.mjs <sceneId> <frame> -> same hash as preview.html window.__test.stateHash
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { hashFloats } from '../prototypes/lib/core.js';
GlobalFonts.registerFromPath('assets/fonts/DejaVuSans-Bold.ttf', 'DejaVuSansBold');
const [id, f] = [process.argv[2], +process.argv[3]];
const mod = await import(`../prototypes/${id}/scene.js`);
const env = { createCanvas: (w, h) => createCanvas(w, h) };
const i = mod.create(env, mod.defaults());
i.renderFrame(createCanvas(1080, 1920).getContext('2d'), f);
const s = i.sim.snapshot ? i.sim.snapshot() : i.sim.pend.map((_, k) => i.sim.theta(k, i.warp.sim(f)));
console.log(id, f, hashFloats(s));
