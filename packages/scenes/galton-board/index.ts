// Scene: Galton board — randomness that adds up to a bell curve.
import { TimeWarp, commonSchema, samplePalette, PALETTES, frameCount, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx, clamp } from '../../core/index.ts';
import { STYLE, bakeStatic, createLayer, drawLayer, copyLayer, restoreLayer, makeBackground, makeNeon, makeBallSprite, makeGlowSprite, drawSprite, drawHeader } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep, hash01 } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbOf, rgbStr } from '../../theme/index.ts';
import { mixRgb } from '../../core/index.ts';
import { simulate, ballPos, pegXY, binX, binomialExpected, type GaltonSim } from './sim.ts';

const meta = { id: 'galton-board', name: 'Galton board', family: 'probability', description: 'Hundreds of random left/right bounces stack into a bell curve.', width: 1080, height: 1920, fps: 60, loudness: -18 };

const schema: Schema = {
  ...commonSchema({ title: 'Can pure chance draw a curve?', duration: 30, answer: 'A perfect bell curve — {n} balls!' }),
  counter: { type: 'text', default: 'balls: ', group: 'Text', label: 'Counter label' },
  balls: { type: 'integer', default: 520, min: 20, max: 1500, group: 'Board', label: 'Balls', sim: true },
  rows: { type: 'integer', default: 12, min: 4, max: 16, group: 'Board', label: 'Peg rows', sim: true },
  p: { type: 'number', default: 0.5, min: 0.1, max: 0.9, step: 0.01, group: 'Board', label: 'Chance to bounce right', sim: true },
  seed: { type: 'integer', default: 7, min: 1, max: 99999, group: 'Board', label: 'Random seed', sim: true },
  finalAt: { type: 'number', default: 27, min: 3, max: 88, step: 0.1, unit: 's', group: 'Timing', label: 'Last ball lands at', sim: true },
  speedUp: { type: 'number', default: 3, min: 1, max: 8, step: 0.1, group: 'Timing', label: 'Speed at end ÷ start', sim: true },
  showCurve: { type: 'boolean', default: true, group: 'Style', label: 'Draw the expected curve' },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.6, burst: 0.7 }),
};

const cache = new Map<string, GaltonSim>();
function simFor(P: Params) {
  const key = [P.balls, P.rows, P.p, P.seed].join('|');
  let s = cache.get(key);
  if (!s) { s = simulate({ balls: +P.balls, rows: +P.rows, p: +P.p, seed: +P.seed, interval: 0.05 }); cache.clear(); cache.set(key, s); }
  return s;
}
function warpFor(P: Params, S: GaltonSim) {
  const finalAt = Math.min(+P.finalAt, +P.duration - 0.3), k = +P.speedUp - 1;
  return new TimeWarp({ fps: meta.fps, frames: frameCount(P, meta.fps), anchorFrame: Math.round(finalAt * meta.fps), anchorSim: S.tEnd,
    rateAt: t => { const u = Math.min(1, t / finalAt); return 1 + k * u * u; } });
}

function audio(P: Params) {
  const S = simFor(P), warp = warpFor(P, S);
  const mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio);
  const lim = new VoiceLimiter(0.015, 2);
  for (const e of S.events) {
    const t = warp.videoTime(e.t), pan = (binX(S.g, S.P.rows, e.bin) - 540) / 700;
    if (e.type === 'peg') sfx(mix, t, 'tick', { gain: 0.12, pitch: scaleStep(S.P.rows - e.row, undefined) - 6 + hash01(e.i) * 0.3, pan, seed: e.i * 31 + e.row }, lim);
    else sfx(mix, t, 'drop', { gain: 0.16, pitch: scaleStep(e.bin) - 7, pan, seed: e.i }, lim);
  }
  sfx(mix, warp.videoTime(S.tEnd) + 0.05, 'success', { gain: 0.5 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const S = simFor(P), warp = warpFor(P, S), frames = frameCount(P, meta.fps);
  const W = meta.width, H = meta.height, fps = meta.fps, g = S.g, R = S.P.rows;
  const T = themeOf(P);
  const juice = new Juice(env, juiceFrom(P), { capacity: 500, seed: +P.seed, gravity: 1400, theme: T });
  const bg = makeBackground(env, W, H, T);
  // bins: neon walls between columns, drawn once
  const walls = makeNeon(env, W, H, c => {
    for (let k = 0; k <= R + 1; k++) { const x = binX(g, R, k) - g.dx / 2; c.moveTo(x, g.binTop); c.lineTo(x, g.floor); }
    c.moveTo(binX(g, R, 0) - g.dx / 2, g.floor); c.lineTo(binX(g, R, R) + g.dx / 2, g.floor);
  }, { width: 4, blur: 10 }, T);
  bakeStatic(bg, walls);
  const pal = paletteFor(T, P.palette, 'cyclic');
  const NB = 32, cols = Array.from({ length: NB }, (_, i) => samplePalette(pal, i / NB, true));
  const sprites = cols.map(c => makeBallSprite(env, c, g.ballR, { halo: 1.8 }, T));
  const pegGlow = makeGlowSprite(env, classicOr(T, [255, 220, 120], rgbOf(T.color.pegLit)), 22, { core: 0.3 }, T);
  const pegHot = rgbOf(T.color.pegHot), pegLit = rgbOf(T.color.pegLit);
  const pegIdle = classicOr(T, 'rgba(150,215,240,0.85)', `rgba(${rgbStr(T.color.peg)},0.9)`);
  const colorOf = (i: number) => Math.floor((i / Math.max(1, S.balls.length)) * NB * 3) % NB;
  // balls that have landed are painted once into this layer (they never move again)
  const settled = createLayer(env, W, H);
  const events = S.events.map(e => ({ e, f: warp.videoTime(e.t) * fps }));
  const pegs: [number, number][] = [];
  for (let r = 0; r < R; r++) for (let k = 0; k <= r; k++) pegs.push(pegXY(g, r, k));
  const pegIndex = (r: number, k: number) => (r * (r + 1)) / 2 + k;

  let st = { frame: 0, ev: 0, landed: 0, pegHit: new Array(pegs.length).fill(-9) as number[], finalT: -1, binPop: new Array(R + 1).fill(-9) as number[] };

  function step() {
    const f = ++st.frame, t = f / fps;
    while (st.ev < events.length && events[st.ev].f <= f) {
      const { e } = events[st.ev++];
      const b = S.balls[e.i];
      if (e.type === 'peg') {
        let c = 0; for (let j = 0; j < e.row; j++) if (b.bits & (1 << j)) c++;
        const pi = pegIndex(e.row, c); st.pegHit[pi] = t;
        if (hash01(e.i * 13 + e.row) < 0.25) juice.burst(pegs[pi][0], pegs[pi][1] - g.pegR, 2, { speed: 160, life: 0.3, size: 0.5, u: 0.3 });
      } else {
        st.landed++;
        drawSprite(settled.ctx, sprites[colorOf(e.i)], b.landX, b.landY);
        st.binPop[e.bin] = t;
        juice.pop('counter', 0.12);
        if (e.i === S.balls.length - 1) { st.finalT = t; juice.flash(0.6, [255, 230, 160]); juice.shake(8); for (let k = 0; k <= R; k++) juice.burst(binX(g, R, k), g.floor - 40, 10, { speed: 520, dir: -Math.PI / 2, spread: 1.4, u: k / R }); }
      }
    }
    juice.update(1 / fps);
  }

  function draw(ctx: Ctx) {
    const t = st.frame / fps, now = warp.sim(st.frame);
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    // pegs: glow briefly after each hit
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < pegs.length; i++) {
      const age = t - st.pegHit[i], lit = age < 0.25 ? 1 - age / 0.25 : 0;
      ctx.fillStyle = lit > 0 ? (T.id === 'classic' ? `rgba(255,${200 + 55 * lit},${150 + 80 * lit},1)` : `rgba(${mixRgb(pegHot, pegLit, lit).map(Math.round).join(',')},1)`) : pegIdle;
      ctx.beginPath(); ctx.arc(pegs[i][0], pegs[i][1], g.pegR, 0, Math.PI * 2); ctx.fill();
      if (lit > 0) { ctx.globalCompositeOperation = T.juice.blend; drawSprite(ctx, pegGlow, pegs[i][0], pegs[i][1], lit); ctx.globalCompositeOperation = 'source-over'; }
    }
    drawLayer(ctx, settled);
    // balls in flight
    for (let i = 0; i < S.balls.length; i++) {
      const b = S.balls[i];
      if (now < b.release || now >= b.tLand) continue;
      const p = ballPos(S, b, now); if (p) drawSprite(ctx, sprites[colorOf(i)], p[0], p[1]);
    }
    // expected curve (binomial), fades in during the last third
    if (P.showCurve) {
      const a = clamp((t - (+P.finalAt) * 0.55) / 4, 0, 1) * 0.9;
      if (a > 0) {
        const d = 2 * g.ballR + 0.6, perLayerH = d * 0.87;
        ctx.save(); ctx.globalCompositeOperation = T.dark ? 'lighter' : 'source-over'; ctx.strokeStyle = classicOr(T, `rgba(255,210,63,${a})`, `rgba(${rgbStr(T.color.accent)},${a})`); ctx.lineWidth = 4 * T.line.width;
        ctx.shadowColor = classicOr(T, 'rgba(255,200,60,0.8)', `rgba(${rgbStr(T.color.accent)},0.8)`); ctx.shadowBlur = env.quality?.glow === false || T.line.glow <= 0 ? 0 : 12;
        if (T.line.style === 'technical') ctx.setLineDash([22, 10]);
        ctx.beginPath();
        for (let s = 0; s <= R * 8; s++) {
          const k = s / 8, lo = Math.floor(k), hi = Math.min(R, lo + 1), f = k - lo;
          const ex = binomialExpected(S.balls.length, R, S.P.p, lo) * (1 - f) + binomialExpected(S.balls.length, R, S.P.p, hi) * f;
          const x = binX(g, R, 0) + k * g.dx, y = g.floor - (ex / g.perLayer) * perLayerH;
          s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke(); ctx.restore();
      }
    }
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const n = Math.round(juice.roll('n', st.landed));
    const counter = st.finalT >= 0 ? [{ text: String(P.answer).replace('{n}', String(S.balls.length)), color: T.color.accent }]
      : [{ text: String(P.counter), color: T.color.text }, { text: String(n), color: T.color.accent }];
    drawHeader(ctx, W, { title: String(P.title), counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('galton-board: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), settled: copyLayer(env, settled) }),
    restore(s: any) { st = structuredClone(s.st); juice.restore(s.juice); restoreLayer(settled, s.settled); },
    diagnostics: () => {
      const n = S.balls.length; let chi = 0;
      for (let k = 0; k <= R; k++) { const e = binomialExpected(n, R, S.P.p, k); if (e >= 5) chi += (S.counts[k] - e) ** 2 / e; }
      const mean = S.counts.reduce((s, c, k) => s + c * k, 0) / n;
      return { bins: S.counts, mean, expectedMean: R * S.P.p, chiSquare: chi, dof: R };
    },
    stateVector: () => { const now = warp.sim(st.frame); const v: number[] = []; for (const b of S.balls) { const p = ballPos(S, b, now); if (p) v.push(p[0], p[1]); } return v; },
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
