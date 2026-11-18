// Scene: butterfly effect — balls released a billionth of a pixel apart inside a circle under gravity.
import { TimeWarp, commonSchema, samplePalette, PALETTES, frameCount, clamp, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { STYLE, bakeStatic, createLayer, drawLayer, fadeLayer, copyLayer, restoreLayer, makeBackground, makeNeon, makeBallSprite, makeCometSprite, makeGlowSprite, drawComet, drawSprite, drawHeader, TrailHistory } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom, drawSquashed } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbOf } from '../../theme/index.ts';
import { simulate, posAt, CENTER, type BounceSim } from './sim.ts';

const meta = { id: 'gravity-bounce', name: 'Butterfly bounce', family: 'chaos', description: 'Balls start a billionth of a pixel apart inside a circle under gravity — chaos pulls them apart.', width: 1080, height: 1920, fps: 60, loudness: -18 };

const schema: Schema = {
  ...commonSchema({ title: 'Same start. Same rules. Same ending?', duration: 30, answer: 'Not even close.' }),
  balls: { type: 'integer', default: 24, min: 2, max: 120, group: 'Setup', label: 'Balls', sim: true },
  offsetExp: { type: 'number', default: -9, min: -14, max: -1, step: 0.5, group: 'Setup', label: 'Start gap (10^x px)', sim: true },
  radius: { type: 'number', default: 430, min: 250, max: 500, step: 1, unit: 'px', group: 'Setup', label: 'Container radius', sim: true },
  gravity: { type: 'number', default: 1800, min: 200, max: 5000, step: 10, unit: 'px/s²', group: 'Setup', sim: true },
  startX: { type: 'number', default: 140, min: -300, max: 300, step: 1, unit: 'px', group: 'Setup', label: 'Release point (x)', sim: true },
  ballR: { type: 'number', default: 14, min: 4, max: 30, step: 0.5, unit: 'px', group: 'Style', label: 'Ball radius', sim: true },
  speed: { type: 'number', default: 1, min: 0.25, max: 3, step: 0.05, group: 'Timing', label: 'Playback speed', sim: true },
  trailHalfLife: { type: 'number', default: 0.45, min: 0.05, max: 3, step: 0.05, unit: 's', group: 'Style', label: 'Trail half-life' },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.5, burst: 0.8 }),
};

const cache = new Map<string, BounceSim>();
function simFor(P: Params) {
  const key = [P.balls, P.offsetExp, P.radius, P.gravity, P.startX, P.ballR, P.speed, P.duration].join('|');
  let s = cache.get(key);
  if (!s) {
    s = simulate({ balls: +P.balls, radius: +P.radius, ballR: +P.ballR, g: +P.gravity, offset: 10 ** +P.offsetExp,
      startX: CENTER.x + +P.startX, startY: CENTER.y - +P.radius * 0.7, vx0: 0, tEnd: +P.duration * +P.speed + 1 });
    cache.clear(); cache.set(key, s);
  }
  return s;
}
const warpFor = (P: Params) => new TimeWarp({ fps: meta.fps, frames: frameCount(P, meta.fps), rateAt: () => +P.speed, anchorFrame: 60, anchorSim: +P.speed });

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 0.0000000012 -> "1.2 × 10⁻⁹" ; big values in plain px */
export function formatGap(px: number) {
  if (px >= 0.01) return px.toFixed(px < 10 ? 2 : 0);
  const e = Math.floor(Math.log10(px)), m = px / 10 ** e;
  return `${m.toFixed(1)} × 10⁻${String(-e).split('').map(d => SUP[+d]).join('')}`;
}
/** largest distance from ball 0 at time t */
function spread(S: BounceSim, t: number) { const a = posAt(S, 0, t); let m = 0; for (let i = 1; i < S.tracks.length; i++) { const b = posAt(S, i, t); const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > m) m = d; } return m; }

function audio(P: Params) {
  const S = simFor(P), warp = warpFor(P), mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio), lim = new VoiceLimiter(0.02, 3);
  const n = S.tracks.length;
  for (const h of S.hits) {
    const t = warp.videoTime(h.t); if (t > +P.duration) break;
    sfx(mix, t, 'bounce', { gain: 0.1 + 0.18 * clamp(h.speed / 2500, 0, 1), pitch: scaleStep(Math.round((h.i / n) * 9)) - 3, pan: (h.x - 540) / 600, seed: h.i * 977 + Math.round(h.t * 100) }, lim);
  }
  // the moment the group visibly splits
  for (let t = 0; t < +P.duration; t += 0.05) if (spread(S, t * +P.speed) > 6) { sfx(mix, t, 'whoosh', { gain: 0.5 }); break; }
  sfx(mix, +P.duration - 2, 'success', { gain: 0.4 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const S = simFor(P), warp = warpFor(P), frames = frameCount(P, meta.fps);
  const W = meta.width, H = meta.height, fps = meta.fps, n = S.tracks.length, R = +P.radius;
  const T = themeOf(P);
  const juice = new Juice(env, juiceFrom(P), { capacity: 700, seed: 11, gravity: 600, theme: T });
  const bg = makeBackground(env, W, H, T);
  const rim = makeNeon(env, W, H, g => g.arc(CENTER.x, CENTER.y, R, 0, Math.PI * 2), {}, T);
  bakeStatic(bg, rim);
  const haze = createLayer(env, W, H, 0.25);
  const trailSec = Math.min(2.5, 3 * +P.trailHalfLife), SUB = 2;
  const trails = new TrailHistory(n, Math.ceil(trailSec * fps * SUB) + 4);
  const pal = paletteFor(T, P.palette, 'cyclic');
  const cols = Array.from({ length: n }, (_, i) => samplePalette(pal, i / n, true));
  const css = cols.map(c => c.map(Math.round));
  const balls = cols.map(c => makeBallSprite(env, c, +P.ballR, {}, T)), comets = cols.map(c => makeCometSprite(env, c, +P.ballR * 4, +P.ballR * 0.7, T));
  const hitGlow = makeGlowSprite(env, classicOr(T, [180, 240, 255], rgbOf(T.color.highlight)), 60, { core: 0.2 }, T);
  const hits = S.hits.map(h => ({ ...h, f: warp.videoTime(h.t) * fps }));
  const keep = Math.pow(0.5, 1 / (fps * +P.trailHalfLife));
  const lastHit = new Float64Array(n).fill(-9);
  let st = { frame: 0, together: 1, ev: 0, bounces: 0, splitT: -1, doneT: -1, last: Array.from({ length: n }, (_, i) => posAt(S, i, 0).slice(0, 2)) as number[][], rimHits: [] as { x: number; y: number; t: number }[], lastHit: Array.from(lastHit) };

  function step() {
    const f = ++st.frame, t = f / fps, s1 = warp.sim(f);
    fadeLayer(haze, keep * keep);
    // while the balls still overlap, n additive lines would saturate: share one line's brightness
    st.together = 1 / n + (1 - 1 / n) * clamp(spread(S, s1) / 250, 0, 1);
    const s0 = warp.sim(f - 1), c = haze.ctx; c.globalCompositeOperation = T.blend; c.lineWidth = 14; c.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const [r, g, b] = css[i];
      c.strokeStyle = `rgba(${r},${g},${b},${0.05 * T.trail.haze * st.together})`; c.beginPath(); c.moveTo(st.last[i][0], st.last[i][1]);
      for (let k = 1; k <= SUB; k++) { const p = posAt(S, i, s0 + ((s1 - s0) * k) / SUB); trails.push(i, p[0], p[1], f * SUB + k); c.lineTo(p[0], p[1]); st.last[i] = [p[0], p[1]]; }
      c.stroke();
    }
    while (st.ev < hits.length && hits[st.ev].f <= f) {
      const h = hits[st.ev++]; st.bounces++; st.lastHit[h.i] = t;
      const e = clamp(h.speed / 2500, 0, 1);
      juice.burst(h.x, h.y, 2 + 6 * e, { speed: 200 + 400 * e, dir: Math.atan2(CENTER.y - h.y, CENTER.x - h.x), spread: 1.6, u: h.i / n, life: 0.4 });
      if (st.rimHits.length < 64) st.rimHits.push({ x: h.x, y: h.y, t });
      if (st.splitT < 0) juice.shake(2.5 * e);
    }
    st.rimHits = st.rimHits.filter(r => t - r.t < 0.35);
    const sp = spread(S, s1);
    if (st.splitT < 0 && sp > 6) { st.splitT = t; juice.flash(0.35, [200, 230, 255]); juice.pop('counter', 1); }
    if (st.doneT < 0 && t >= +P.duration - 2) { st.doneT = t; juice.flash(0.45); juice.pop('counter', 1); }
    juice.update(1 / fps);
  }

  function draw(ctx: Ctx) {
    const t = st.frame / fps, s = warp.sim(st.frame);
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const aT = Math.min(1, 0.9 * T.trail.alpha * Math.max(st.together, 0.15));
    for (let i = 0; i < n; i++) trails.draw(ctx, i, st.frame * SUB + SUB, trailSec * fps * SUB, css[i].join(','), aT, 4 * T.trail.width);
    for (const r of st.rimHits) drawSprite(ctx, hitGlow, r.x, r.y, 1 - (t - r.t) / 0.35, 0.8);
    for (let i = 0; i < n; i++) { const [x, y, vx, vy] = posAt(S, i, s); drawComet(ctx, comets[i], x, y, vx, vy, 0.8); }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = n - 1; i >= 0; i--) {
      const [x, y, vx, vy] = posAt(S, i, s), v = Math.hypot(vx, vy);
      const sq = juice.squash(v / 2600, t - st.lastHit[i]);
      drawSquashed(ctx, balls[i], x, y, Math.atan2(vy, vx), sq.sx, sq.sy);
    }
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const gap = spread(S, s);
    const counter = st.doneT >= 0 ? [{ text: String(P.answer), color: T.color.accent }]
      : [{ text: 'gap: ', color: T.color.text }, { text: formatGap(Math.max(gap, 1e-15)) + ' px', color: T.color.accent }];
    drawHeader(ctx, W, { title: String(P.title), counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('gravity-bounce: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), trails: trails.snapshot(), layers: [copyLayer(env, haze)] }),
    restore(x: any) { st = structuredClone(x.st); juice.restore(x.juice); trails.restore(x.trails); restoreLayer(haze, x.layers[0]); },
    diagnostics: () => ({ bounces: S.hits.length, maxEnergyDriftRel: S.maxEnergyDriftRel, maxRadiusErrPx: S.maxRadiusErrPx, gapNowPx: spread(S, warp.sim(st.frame)) }),
    stateVector: () => { const v: number[] = []; for (let i = 0; i < n; i++) v.push(...posAt(S, i, warp.sim(st.frame))); return v; },
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
