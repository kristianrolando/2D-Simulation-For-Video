// Scene: harmonograph — a pen moved by two pairs of damped pendulums draws Lissajous-like figures
// that slowly spiral inwards. Position is a closed-form function of time (dmath only).
import { TimeWarp, commonSchema, samplePalette, PALETTES, frameCount, dsin, dexp, clamp, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { STYLE, createLayer, drawLayer, copyLayer, restoreLayer, makeBackground, makeBallSprite, makeCometSprite, drawComet, drawHeader, makeGlowSprite, drawSprite, TrailHistory } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom, drawSquashed } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, rgbOf, rgbStr } from '../../theme/index.ts';

const meta = { id: 'harmonograph', name: 'Harmonograph', family: 'oscillations', description: 'Two damped pendulum pairs steer one pen; simple frequency ratios draw intricate, decaying figures.', width: 1080, height: 1920, fps: 60, loudness: -18 };

const schema: Schema = {
  ...commonSchema({ title: 'What do two swinging pendulums draw?', duration: 30, answer: 'Ratio {n} — and it never repeats.' }),
  ratioX: { type: 'integer', default: 3, min: 1, max: 9, group: 'Pendulums', label: 'Horizontal frequency', sim: true },
  ratioY: { type: 'integer', default: 2, min: 1, max: 9, group: 'Pendulums', label: 'Vertical frequency', sim: true },
  detune: { type: 'number', default: 0.004, min: 0, max: 0.05, step: 0.0005, group: 'Pendulums', label: 'Detune (slow rotation)', sim: true },
  phase: { type: 'number', default: 0.5, min: 0, max: 6.28, step: 0.01, group: 'Pendulums', label: 'Phase offset (rad)', sim: true },
  damping: { type: 'number', default: 0.035, min: 0, max: 0.08, step: 0.001, group: 'Pendulums', label: 'Damping per second', sim: true },
  cycles: { type: 'number', default: 28, min: 5, max: 400, step: 1, group: 'Timing', label: 'Base swings over the video', sim: true },
  speedUp: { type: 'number', default: 2.2, min: 1, max: 6, step: 0.1, group: 'Timing', label: 'Speed at end ÷ start', sim: true },
  size: { type: 'number', default: 420, min: 150, max: 500, step: 1, unit: 'px', group: 'Style', label: 'Figure size' },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.3, burst: 0.6 }),
};

const C = { x: 540, y: 960 };
const TAU = Math.PI * 2;

/** pen position at sim time s (seconds of pendulum time) */
function pen(P: Params, s: number): [number, number] {
  const fx = +P.ratioX, fy = +P.ratioY, d = +P.damping, de = +P.detune, A = +P.size, ph = +P.phase;
  const ex = dexp(-d * s), ey = dexp(-d * 1.1 * s);
  const x = A * (0.62 * ex * dsin(TAU * fx * s + ph) + 0.38 * ex * dsin(TAU * (fx + de) * s));
  const y = A * (0.62 * ey * dsin(TAU * fy * s) + 0.38 * ey * dsin(TAU * (fy - de) * s + ph * 0.5));
  return [C.x + x, C.y + y];
}

function warpFor(P: Params) {
  const frames = frameCount(P, meta.fps), end = +P.duration - 1.5, k = +P.speedUp - 1;
  // the base pendulum runs `cycles` periods (period 1 sim-second) by `end`
  return new TimeWarp({ fps: meta.fps, frames, anchorFrame: Math.round(end * meta.fps), anchorSim: +P.cycles,
    rateAt: t => (t > end ? 0.15 : 1 + k * Math.min(1, t / end) ** 2) });
}

/** milestone events: every completed base swing (for rhythm) */
function swings(P: Params, warp: TimeWarp) {
  const out: { t: number; n: number }[] = [];
  for (let n = 1; n <= +P.cycles; n++) out.push({ t: warp.videoTime(n), n });
  return out;
}

function audio(P: Params) {
  const warp = warpFor(P), mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio), lim = new VoiceLimiter(0.09, 1);
  for (const e of swings(P, warp)) {
    const decay = dexp(-+P.damping * e.n);
    sfx(mix, e.t, 'note', { gain: 0.12 * (0.4 + 0.6 * decay), pitch: scaleStep((e.n * (+P.ratioX)) % 10) - 5, pan: dsin(e.n) * 0.4, seed: e.n }, lim);
  }
  sfx(mix, +P.duration - 1.5, 'success', { gain: 0.45 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const W = meta.width, H = meta.height, fps = meta.fps, frames = frameCount(P, fps), warp = warpFor(P);
  const T = themeOf(P);
  const juice = new Juice(env, juiceFrom(P), { capacity: 300, seed: 3, gravity: 0, drag: 3, theme: T });
  const bg = makeBackground(env, W, H, T);
  const ink = createLayer(env, W, H), haze = createLayer(env, W, H, 0.25);
  const TRAIL_S = 0.6, trail = new TrailHistory(1, Math.ceil(TRAIL_S * fps * 40) + 8);
  const pal = paletteFor(T, P.palette, 'timeline');
  const N = 48, cols = Array.from({ length: N }, (_, i) => samplePalette(pal, i / (N - 1), false));
  const balls = cols.map(c => makeBallSprite(env, c, 13, {}, T)), comets = cols.map(c => makeCometSprite(env, c, 70, 8, T));
  const glow = makeGlowSprite(env, rgbOf(T.color.highlight), 40, { core: 0.2, intensity: 0.5 }, T);
  const ms = swings(P, warp).map(e => ({ ...e, f: e.t * fps }));
  const end = +P.duration - 1.5;
  let st = { frame: 0, last: pen(P, 0), ev: 0, swing: 0, doneT: -1, speed: 0 };
  const ci = () => clamp(Math.floor((warp.sim(st.frame) / +P.cycles) * (N - 1)), 0, N - 1);

  function step() {
    const f = ++st.frame, s0 = warp.sim(f - 1), s1 = warp.sim(f);
    // sub-sample the curve so fast segments stay smooth (≥ 1 point per ~3 px)
    const [r, g, b] = cols[ci()].map(Math.round);
    const steps = Math.max(2, Math.ceil(((s1 - s0) * +P.size * 6 * Math.max(+P.ratioX, +P.ratioY)) / 3));
    const lw = (1.4 + 1.2 * dexp(-+P.damping * s1)) * T.trail.width;
    // sample the curve once per frame, reuse the points for every layer and the fading head trail
    const pts: number[] = [];
    for (let k = 1; k <= steps; k++) { const [x, y] = pen(P, s0 + ((s1 - s0) * k) / steps); pts.push(x, y); }
    for (const [l, a, w] of [[ink, Math.min(1, 0.55 * T.trail.alpha), lw], [haze, 0.05 * T.trail.haze, 9]] as const) {
      if (a <= 0) continue;
      const c = l.ctx; c.globalCompositeOperation = T.blend; c.strokeStyle = `rgba(${r},${g},${b},${a})`; c.lineWidth = w;
      c.beginPath(); c.moveTo(st.last[0], st.last[1]);
      for (let k = 0; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
      c.stroke();
    }
    for (let k = 0; k < pts.length; k += 2) trail.push(0, pts[k], pts[k + 1], f);
    const cur = pen(P, s1); st.speed = Math.hypot(cur[0] - st.last[0], cur[1] - st.last[1]) * fps; st.last = cur;
    while (st.ev < ms.length && ms[st.ev].f <= f) { st.ev++; st.swing++; juice.pop('counter', 0.25); if (st.swing % 10 === 0) juice.burst(cur[0], cur[1], 8, { speed: 220, u: st.swing / +P.cycles }); }
    if (st.doneT < 0 && f / fps >= end) { st.doneT = f / fps; juice.flash(0.5, [255, 236, 190]); juice.shake(6); juice.burst(cur[0], cur[1], 40, { speed: 600 }); }
    juice.update(1 / fps);
  }

  function draw(ctx: Ctx) {
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze); drawLayer(ctx, ink);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trail.draw(ctx, 0, st.frame, TRAIL_S * fps, cols[ci()].map(Math.round).join(','), Math.min(1, 0.9 * T.trail.alpha), 3.5 * T.trail.width);
    const [x, y] = st.last, s1 = warp.sim(st.frame), [x0, y0] = pen(P, Math.max(0, s1 - 0.004));
    const e = clamp(st.speed / 2500, 0, 1);
    ctx.globalCompositeOperation = T.juice.blend; drawSprite(ctx, glow, x, y, 0.3 + 0.7 * e); ctx.globalCompositeOperation = T.blend;
    drawComet(ctx, comets[ci()], x, y, x - x0, y - y0, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    const sq = juice.squash(e);
    drawSquashed(ctx, balls[ci()], x, y, Math.atan2(y - y0, x - x0), sq.sx, sq.sy);
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const ratio = `${P.ratioX} : ${P.ratioY}`;
    const counter = st.doneT >= 0 ? [{ text: String(P.answer).replace('{n}', ratio), color: T.color.accent }]
      : [{ text: 'swings: ', color: T.color.text }, { text: String(st.swing), color: T.color.accent }, { text: `   ·   ratio ${ratio}`, color: `rgba(${rgbStr(T.color.muted)},0.75)` }];
    drawHeader(ctx, W, { title: String(P.title), counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t: st.frame / fps }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('harmonograph: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), trail: trail.snapshot(), layers: [copyLayer(env, ink), copyLayer(env, haze)] }),
    restore(s: any) { st = structuredClone(s.st); juice.restore(s.juice); trail.restore(s.trail); restoreLayer(ink, s.layers[0]); restoreLayer(haze, s.layers[1]); },
    diagnostics: () => { const s = warp.sim(st.frame); return { simSeconds: s, amplitudeLeft: dexp(-+P.damping * s), swings: st.swing }; },
    stateVector: () => { const p = pen(P, warp.sim(st.frame)); return [p[0], p[1]]; },
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
