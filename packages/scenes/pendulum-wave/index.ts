// Scene: pendulum wave in 3D perspective with motion-blur ribbons. Fully precomputed => seekable.
import { TimeWarp, commonSchema, samplePalette, PALETTES, smoothstep, dexp, frameCount, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { bakeStatic, makeBackground, makeNeon, makeBallSprite, drawSprite, drawHeader, drawLayer, makeCamera } from '../../render2d/index.ts';
import { createMix, pluck, master } from '../../audio/index.ts';
import { sfx } from '../../audio/bank.ts';
import { juiceSchema, juiceFrom, drawSquashed, ease } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbStr } from '../../theme/index.ts';
import { createSim } from './sim.ts';

const meta = { id: 'pendulum-wave', name: 'Pendulum wave', family: 'oscillations', description: 'Pendulums of tuned lengths drift out of phase and line up again (exact large-amplitude periods).', width: 1080, height: 1920, fps: 60, loudness: -16.6 };

const schema: Schema = {
  ...commonSchema({ title: 'Can this mess sort itself out?', duration: 25.05 }),
  count: { type: 'integer', default: 18, min: 4, max: 30, group: 'Pendulums', label: 'Pendulums', sim: true },
  nMax: { type: 'integer', default: 47, min: 10, max: 80, group: 'Pendulums', label: 'Swings of the shortest per cycle', sim: true },
  cycle: { type: 'number', default: 60, min: 10, max: 120, step: 1, unit: 's', group: 'Pendulums', label: 'Cycle (physical seconds)', sim: true },
  X0: { type: 'number', default: 0.26, min: 0.05, max: 0.33, step: 0.01, unit: 'm', group: 'Pendulums', label: 'Release displacement', sim: true },
  alignAt: { type: 'number', default: 23.47, min: 3, max: 88, step: 0.01, unit: 's', group: 'Timing', label: 'Line up again at', sim: true },
  growth: { type: 'number', default: 0.06, min: 0, max: 0.3, step: 0.005, group: 'Timing', label: 'Speed-up per second', sim: true },
  easeOut: { type: 'number', default: 1.3, min: 0.1, max: 5, step: 0.1, unit: 's', group: 'Timing', label: 'Slow-motion landing', sim: true },
  blur: { type: 'number', default: 0.3, min: 0.02, max: 0.8, step: 0.01, unit: 's', group: 'Style', label: 'Motion-blur length' },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.5, squash: 0.7 }),
};

const CAM = { alpha: 0.97647, Cy: 0.79037, Cz: -0.58785, F: 1549.9 }; // fitted to the reference layout (RMS 6 px)
const RAIL = 0.03504;
const PENTA = [0, 2, 4, 7, 9];

const simCache = new Map<string, ReturnType<typeof createSim>>();
function simFor(P: Params) {
  const key = [P.count, P.nMax, P.cycle, P.X0].join('|');
  let s = simCache.get(key); if (!s) { s = createSim({ count: +P.count, nMax: +P.nMax, cycle: +P.cycle, X0: +P.X0 }); simCache.clear(); simCache.set(key, s); }
  return s;
}
function warpFor(P: Params) {
  const frames = frameCount(P, meta.fps), alignAt = Math.min(+P.alignAt, +P.duration - 0.05);
  return new TimeWarp({ fps: meta.fps, frames, anchorFrame: Math.round(alignAt * meta.fps), anchorSim: +P.cycle,
    rateAt: t => (t >= alignAt ? 0 : dexp(+P.growth * t) * (1 - smoothstep(alignAt - +P.easeOut, alignAt, t))) });
}

function audio(P: Params) {
  const sim = simFor(P), warp = warpFor(P), N = sim.pend.length;
  const mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio);
  const freq = (i: number) => { const d = N - 1 - i; return 196 * Math.pow(2, Math.floor(d / 5) + PENTA[d % 5] / 12); };
  for (const e of sim.extremes) pluck(mix, warp.videoTime(e.t), { freq: freq(e.i), gain: 0.07, decay: 1.4, pan: (e.i / (N - 1)) * 0.6 - 0.3 });
  const at = Math.min(+P.alignAt, +P.duration - 0.05);
  for (let i = 0; i < N; i += 2) pluck(mix, at, { freq: freq(i), gain: 0.06, decay: 2.5 });
  sfx(mix, at, 'success', { gain: 0.45 });
  sfx(mix, at - 0.6, 'whoosh', { gain: 0.25 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const W = meta.width, H = meta.height, fps = meta.fps;
  const sim = simFor(P), warp = warpFor(P), frames = frameCount(P, fps);
  const cam = makeCamera(CAM), N = sim.pend.length;
  const z = (i: number) => (N - 1 - i) * RAIL * (18 - 1) / Math.max(1, N - 1);
  const bob = (i: number, t: number) => { const p = sim.pend[i], th = sim.theta(i, t); return cam(p.L * Math.sin(th), -p.L * Math.cos(th), z(i)); };
  const T = themeOf(P);
  const bg = makeBackground(env, W, H, T);
  const p0 = cam(0, 0, z(0)), p1 = cam(0, 0, z(N - 1));
  const rail = makeNeon(env, W, H, g => { g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); }, { width: 4, blur: 8 }, T);
  bakeStatic(bg, rail);
  const pal = paletteFor(T, P.palette, 'spectrum');
  const cols = Array.from({ length: N }, (_, i) => samplePalette(pal, i / Math.max(1, N - 1), false));
  const sRef = cam(0, -sim.pend[0].L, z(0))[2];
  const sprites = cols.map((c, i) => makeBallSprite(env, c, (22 * cam(0, -sim.pend[i].L, z(i))[2]) / sRef, { halo: 2.0 }, T));
  const K = 18, stringRGB = rgbStr(T.color.guide), tintTo = T.dark ? 255 : 0, ra = T.trail.alpha, rw = T.trail.width;
  const J0 = juiceFrom(P), J = { ...J0, flash: J0.flash * T.juice.flash, shake: T.motion.shake === 'none' ? 0 : J0.shake * T.juice.shake, squash: J0.squash * T.juice.squash }, alignAt = Math.min(+P.alignAt, +P.duration - 0.05);
  let frame = 0;
  // stateless juice: everything below is a pure function of time, so the scene stays seekable
  const flashAt = (t: number) => (J.flash > 0 && t >= alignAt ? Math.max(0, 0.6 * J.flash * (1 - (t - alignAt) / 0.5)) : 0);
  const shakeAt = (t: number) => (J.shake > 0 && t >= alignAt && t < alignAt + 0.4 ? 9 * J.shake * (1 - (t - alignAt) / 0.4) : 0);

  function draw(ctx: Ctx) {
    const now = warp.sim(frame), tv = frame / meta.fps, sh = shakeAt(tv);
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    ctx.save(); if (sh > 0) ctx.translate(sh * Math.sin(frame * 2.3), T.motion.shake === 'horizontal' ? 0 : sh * Math.cos(frame * 3.1));
    ctx.globalCompositeOperation = T.blend;
    ctx.fillStyle = classicOr(T, 'rgba(160,230,255,0.9)', `rgba(${rgbStr(T.color.pivot)},0.9)`);
    for (let i = 0; i < N; i++) { const [x, y] = cam(0, 0, z(i)); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.lineWidth = 1.3;
    for (let i = 0; i < N; i++) {
      const [px, py] = cam(0, 0, z(i)), [bx, by] = bob(i, now);
      const [r, g, b] = cols[i].map(v => Math.round(v * 0.5 + 100));
      ctx.strokeStyle = T.id === 'classic' ? `rgba(${r},${g},${b},0.33)` : `rgba(${stringRGB},0.5)`; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
    }
    const tBack = warp.simAt(Math.max(0, frame - +P.blur * fps));
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (let i = N - 1; i >= 0; i--) {
      const [r, g, b] = cols[i].map(Math.round);
      const pts: [number, number, number][] = [];
      for (let k = 0; k <= K; k++) pts.push(bob(i, tBack + (now - tBack) * (k / K)));
      const [x0, y0] = pts[0], [x1, y1] = pts[K];
      if (Math.hypot(x1 - x0, y1 - y0) < 2) continue;
      const sc = pts[K][2] / sRef;
      for (const [w, a, tint] of [[42, 0.24, 0], [22, 0.8, 0.1], [6, 0.5, 0.6]]) {
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        const c = [r, g, b].map(v => Math.round(v + (tintTo - v) * tint)).join(','), aa = Math.min(1, a * ra);
        gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(0.55, `rgba(${c},${aa * 0.6})`); gr.addColorStop(1, `rgba(${c},${aa})`);
        ctx.strokeStyle = gr; ctx.lineWidth = w * sc * (w === 42 ? 1 : rw);
        ctx.beginPath(); ctx.moveTo(x0, y0); for (let k = 1; k <= K; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    const dtS = Math.max(1e-6, now - warp.simAt(Math.max(0, frame - 1)));
    for (let i = 0; i < N; i++) {
      const [x, y] = bob(i, now), [px, py] = bob(i, now - dtS), v = Math.hypot(x - px, y - py) * meta.fps;
      const sq = { sx: 1, sy: 1 }; if (J.squash > 0) { const k = 1 + 0.3 * J.squash * Math.min(1, v / 1800); sq.sx = k; sq.sy = 1 / k; }
      drawSquashed(ctx, sprites[i], x, y, Math.atan2(y - py, x - px), sq.sx, sq.sy);
    }
    ctx.restore();
    const fl = flashAt(tv);
    if (fl > 0 && T.juice.flashMode !== 'none') {
      const mode = T.juice.flashMode, fc = classicOr(T, '255,240,210', rgbStr(T.juice.flashColor === 'event' ? T.color.flash : T.juice.flashColor));
      ctx.save(); ctx.globalCompositeOperation = mode === 'add' ? 'lighter' : mode === 'invert' ? 'difference' : 'source-over';
      ctx.fillStyle = `rgba(${fc},${fl * (mode === 'add' ? 0.35 : mode === 'invert' ? 1 : 0.45)})`; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    drawHeader(ctx, W, { title: String(P.title), titleY: 218, counter: null, handle: String(P.handle), handleY: 280, t: tv }, T);
  }

  return {
    frames, seekable: true,
    get frame() { return frame; },
    renderFrame(ctx, i) { frame = i; draw(ctx); },
    diagnostics: () => sim.diagnostics(),
    stateVector: () => sim.pend.map((_, i) => sim.theta(i, warp.sim(frame))),
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
