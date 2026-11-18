// Scene: a precessing (rosette) orbit drawn over hundreds of thousands of years.
import { TimeWarp, commonSchema, samplePalette, PALETTES, formatThousands, clamp, dexp, frameCount, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { STYLE, createLayer, drawLayer, copyLayer, restoreLayer, makeBackground, makeBallSprite, makeCometSprite, makeGlowSprite,
  drawSprite, drawComet, drawHeader, drawRipple, drawFocusRing } from '../../render2d/index.ts';
import { createMix, bell, master } from '../../audio/index.ts';
import { sfx, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom, drawSquashed } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbOf, rgbStr } from '../../theme/index.ts';
import { constants, initState, advance, diagnostics, type OrbitParams } from './sim.ts';

const meta = { id: 'rosette-orbit', name: 'Rosette orbit', family: 'orbits', description: 'A precessing elliptical orbit that closes after 360/precession turns.', width: 1080, height: 1920, fps: 60, loudness: -14.2 };

const schema: Schema = {
  ...commonSchema({ title: 'Does this orbit ever repeat?', duration: 31.56 }),
  counter: { type: 'text', default: 'years: ', group: 'Text', label: 'Counter label' },
  rApo: { type: 'number', default: 445, min: 150, max: 480, step: 1, unit: 'px', group: 'Orbit', label: 'Farthest distance', sim: true },
  rPeri: { type: 'number', default: 78, min: 20, max: 300, step: 1, unit: 'px', group: 'Orbit', label: 'Closest distance', sim: true },
  precessDeg: { type: 'number', default: 10, min: 2, max: 60, step: 0.5, unit: '°', group: 'Orbit', label: 'Precession per orbit', sim: true },
  periodYears: { type: 'number', default: 6250, min: 1, max: 1e6, step: 1, group: 'Orbit', label: 'Years per orbit', sim: true },
  closeAt: { type: 'number', default: 28.6, min: 3, max: 88, step: 0.01, unit: 's', group: 'Timing', label: 'Orbit closes at', sim: true },
  rampA: { type: 'number', default: 0.00674, min: 0, max: 0.3, step: 0.0001, group: 'Timing', label: 'Speed-up (linear)', sim: true },
  rampB: { type: 'number', default: 0.002168, min: 0, max: 0.05, step: 0.0001, group: 'Timing', label: 'Speed-up (quadratic)', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.5, burst: 0.8, squash: 0.8 }),
};

const SUN = { x: 540, y: 960 };
const orbitParams = (P: Params): OrbitParams => ({ rApo: +P.rApo, rPeri: Math.min(+P.rPeri, +P.rApo - 1), precessDeg: +P.precessDeg, periodYears: +P.periodYears, startAngleDeg: 90, stepsPerOrbit: 20000 });

function warpFor(P: Params, closeYears: number) {
  const frames = frameCount(P, meta.fps), closeAt = Math.min(+P.closeAt, +P.duration - 0.1);
  const r = (t: number) => dexp(+P.rampA * t + +P.rampB * t * t);
  return new TimeWarp({ fps: meta.fps, frames, anchorFrame: Math.round(closeAt * meta.fps), anchorSim: closeYears,
    rateAt: t => (t <= closeAt ? r(t) : Math.max(1, r(closeAt) * dexp(-(t - closeAt) / 0.3))) });
}

function audio(P: Params) {
  const K = constants(orbitParams(P)), S = initState(K), warp = warpFor(P, K.closeYears);
  const frames = frameCount(P, meta.fps), mix = createMix(frames / meta.fps + 0.5, themeOf(P).audio);
  for (let f = 1; f <= frames; f++) for (const e of advance(K, S, warp.sim(f), 1e9).events) {
    const vt = warp.videoTime(e.t);
    if (e.type === 'peri') sfx(mix, vt, 'ping', { gain: 0.3, pitch: scaleStep((e.k * 2) % 10) - 5, pan: 0.15, seed: e.k });
    else { sfx(mix, vt, 'boom', { gain: 0.45 }); sfx(mix, vt + 0.04, 'success', { gain: 0.55 }); }
  }
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const W = meta.width, H = meta.height, fps = meta.fps;
  const K = constants(orbitParams(P)), warp = warpFor(P, K.closeYears), frames = frameCount(P, fps);
  const toScreen = (x: number, y: number): [number, number] => [SUN.x + x, SUN.y - y];
  const T = themeOf(P);
  const bg = makeBackground(env, W, H, T);
  const trail = createLayer(env, W, H), haze = createLayer(env, W, H, 0.25);
  const ghost = createLayer(env, W, H);
  { const g = ghost.ctx; g.strokeStyle = `rgba(${rgbStr(T.color.guide)},0.22)`; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 720; i++) { const ph = (i / 720) * Math.PI * 2, r = K.pLat / (1 + K.e * Math.cos(ph - Math.PI / 2 + Math.PI)); const [x, y] = toScreen(r * Math.cos(ph), r * Math.sin(ph)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); }
  const pal = paletteFor(T, P.palette, 'timeline');
  const N = 64, cols = Array.from({ length: N }, (_, i) => samplePalette(pal, i / (N - 1), false));
  const balls = cols.map(c => makeBallSprite(env, c, 10, {}, T)), comets = cols.map(c => makeCometSprite(env, c, 60, 6, T));
  const sunGlow = makeGlowSprite(env, rgbOf(T.color.sunHalo), 70, { core: 0.25 }, T), sunCore = makeGlowSprite(env, rgbOf(T.color.sunCore), 26, { core: 0.55 }, T);
  const dot = makeGlowSprite(env, classicOr(T, [255, 225, 77], rgbOf(T.color.accent)), 9, { core: 0.55 }, T);
  const disc = classicOr(T, '0,0,4', rgbStr(T.color.bg[Math.min(1, T.color.bg.length - 1)]));

  const juice = new Juice(env, juiceFrom(P), { capacity: 300, seed: 4, gravity: 0, drag: 2.5, palette: classicOr(T, ['#ffe14d', '#ffffff', '#ff9a3d'], T.palettes.sparks), theme: T });
  let S = initState(K);
  let st = { frame: 0, years: 0, display: K.start.slice(), last: toScreen(K.start[0], K.start[1]), peris: [] as [number, number][], closedAt: -1 };
  const colIndex = () => clamp(Math.floor((st.years / K.closeYears) * (N - 1)), 0, N - 1);

  function step() {
    st.frame++;
    const target = warp.sim(st.frame);
    const { points, events, display } = advance(K, S, target);
    st.display = display; st.years = target;
    for (const e of events) {
      if (e.type === 'peri') { const p = toScreen(e.x, e.y); st.peris.push(p); juice.burst(p[0], p[1], 7, { speed: 200, life: 0.5 }); juice.pop('counter', 0.6); }
      else { st.closedAt = st.frame / fps; const p = toScreen(e.x, e.y); juice.flash(0.6, [255, 230, 170]); juice.shake(10); juice.burst(p[0], p[1], 70, { speed: 600, life: 0.9 }); juice.pop('counter', 1.3); }
    }
    juice.update(1 / fps);
    const [r, g, b] = cols[colIndex()].map(Math.round);
    for (const [l, a, w] of [[trail, Math.min(1, 0.5 * T.trail.alpha), 1.6 * T.trail.width], [haze, 0.05 * T.trail.haze, 10]] as const) {
      if (a <= 0) continue;
      const c = l.ctx; c.globalCompositeOperation = T.blend; c.strokeStyle = `rgba(${r},${g},${b},${a})`; c.lineWidth = w;
      c.beginPath(); c.moveTo(st.last[0], st.last[1]);
      for (let i = 0; i < points.length; i += 2) { const [x, y] = toScreen(points[i], points[i + 1]); c.lineTo(x, y); }
      c.stroke();
    }
    st.last = toScreen(display[0], display[1]);
  }

  function draw(ctx: Ctx) {
    const t = st.frame / fps;
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    if (t < 3) { ctx.globalAlpha = clamp(1 - t / 3, 0, 1); drawLayer(ctx, ghost); ctx.globalAlpha = 1; }
    ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze); drawLayer(ctx, trail);
    ctx.globalCompositeOperation = 'source-over';
    const dg = ctx.createRadialGradient(SUN.x, SUN.y, 20, SUN.x, SUN.y, 62);
    dg.addColorStop(0, `rgba(${disc},1)`); dg.addColorStop(0.7, `rgba(${disc},0.85)`); dg.addColorStop(1, `rgba(${disc},0)`);
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 62, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = T.juice.blend;
    for (const [x, y] of st.peris) drawSprite(ctx, dot, x, y);
    drawSprite(ctx, sunGlow, SUN.x, SUN.y); drawSprite(ctx, sunCore, SUN.x, SUN.y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = T.color.sunDisc; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${rgbStr(T.color.sunRing)},0.9)`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 22, 0, Math.PI * 2); ctx.stroke();
    const [sx, sy] = toScreen(K.start[0], K.start[1]);
    drawFocusRing(ctx, sx, sy, st.closedAt >= 0 ? Math.max(0, 1 - (t - st.closedAt) / 2.5) : 0, T);
    if (st.closedAt >= 0) drawRipple(ctx, sx, sy, t - st.closedAt, { r1: 110, dur: 1.6 }, T);
    const [bx, by] = toScreen(st.display[0], st.display[1]);
    ctx.globalCompositeOperation = T.blend; drawComet(ctx, comets[colIndex()], bx, by, st.display[2], -st.display[3], 0.9);
    ctx.globalCompositeOperation = 'source-over';
    const v = Math.hypot(st.display[2], st.display[3]), sq = juice.squash(clamp(v / (K.L / Math.max(1, +P.rPeri)), 0, 1));
    drawSquashed(ctx, balls[colIndex()], bx, by, Math.atan2(-st.display[3], st.display[2]), sq.sx, sq.sy);
    juice.drawParticles(ctx); juice.endWorld(ctx); juice.drawFlash(ctx, W, H);
    const shown = st.closedAt >= 0 ? K.closeYears : Math.floor(st.years / 100) * 100;
    drawHeader(ctx, W, { title: String(P.title), counter: [{ text: String(P.counter), color: T.color.text }, { text: formatThousands(shown), color: T.color.accent }], counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('rosette-orbit: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ S: structuredClone(S), st: structuredClone(st), juice: juice.snapshot(), layers: [copyLayer(env, trail), copyLayer(env, haze)] }),
    restore(s: any) { S = structuredClone(s.S); st = structuredClone(s.st); juice.restore(s.juice); restoreLayer(trail, s.layers[0]); restoreLayer(haze, s.layers[1]); },
    diagnostics: () => diagnostics(S),
    stateVector: () => S.s.slice(),
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
