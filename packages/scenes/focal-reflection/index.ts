// Scene: balls reflecting off conic mirrors, all meeting at a focus.
// Covers the reference family: ellipse, two-lobe "peanut", parabola, 90° retro-reflector,
// Cassegrain (parabola + hyperbola) and Gregorian (parabola + ellipse) telescopes.
import { TimeWarp, commonSchema, sequence, samplePalette, PALETTES, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx, frameCount } from '../../core/index.ts';
import { STYLE, bakeStatic, createLayer, drawLayer, fadeLayer, copyLayer, restoreLayer, makeBackground, makeNeon, makeBallSprite, makeCometSprite,
  makeGlowSprite, drawSprite, drawComet, drawHeader, drawRipple, drawFocusRing, type Layer } from '../../render2d/index.ts';
import { createMix, tock, bell, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, classicOr, rgbOf } from '../../theme/index.ts';
import { layout, LAYOUTS, type Layout } from './presets.ts';
import { simulate, trackPos, type SimResult } from './sim.ts';

const meta = {
  id: 'focal-reflection', name: 'Focal reflection', family: 'conic mirrors',
  description: 'Waves of balls reflect off conic mirrors and meet at a focus (ellipse, peanut, parabola, corner, Cassegrain, Gregorian).',
  width: 1080, height: 1920, fps: 60, loudness: -19.8,
};

const schema: Schema = {
  layout: { type: 'enum', default: 'ellipse', options: LAYOUTS, group: 'Geometry', label: 'Mirror layout', sim: true },
  ...commonSchema({ title: '', duration: 31.67, answer: '' }),
  counter: { type: 'text', default: 'balls: ', group: 'Text', label: 'Counter label' },
  ellipseRx: { type: 'number', default: 348, min: 150, max: 500, step: 1, unit: 'px', group: 'Geometry', label: 'Ellipse half-width', sim: true },
  ellipseRy: { type: 'number', default: 508, min: 200, max: 600, step: 1, unit: 'px', group: 'Geometry', label: 'Ellipse half-height', sim: true },
  sequence: { type: 'enum', default: 'auto', options: ['auto', 'fibonacci', 'gentle', 'double', 'linear', 'custom'], group: 'Waves', label: 'Balls per wave', help: 'auto = the layout default', sim: true },
  waves: { type: 'integer', default: 0, min: 0, max: 20, group: 'Waves', label: 'Number of waves (0 = layout default)', sim: true },
  customCounts: { type: 'text', default: '1 2 4 8 16 32', group: 'Waves', label: 'Custom counts', sim: true },
  finalAt: { type: 'number', default: 29.58, min: 3, max: 88, step: 0.01, unit: 's', group: 'Timing', label: 'Final arrival at', sim: true },
  speedUp: { type: 'number', default: 1.405, min: 1, max: 4, step: 0.01, group: 'Timing', label: 'Speed at end ÷ start', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  trailHalfLife: { type: 'number', default: 1.4, min: 0.1, max: 6, step: 0.1, unit: 's', group: 'Style', label: 'Trail half-life' },
  trailGain: { type: 'number', default: 1, min: 0.1, max: 4, step: 0.05, group: 'Style', label: 'Trail brightness' },
  ballRadius: { type: 'number', default: 12, min: 4, max: 30, step: 0.5, unit: 'px', group: 'Style' },
  arrivalChime: { type: 'boolean', default: false, group: 'Sound', label: 'Chime on every arrival' },
  ...juiceSchema({ shake: 0.6, burst: 0.6 }),
};

function counts(P: Params, L: Layout): number[] {
  const kind = P.sequence === 'auto' ? L.seq.kind : String(P.sequence);
  const n = Number(P.waves) > 0 ? Number(P.waves) : P.sequence === 'custom' ? 99 : L.seq.n;
  const c = sequence(kind, n, { custom: String(P.customCounts) });
  return c.length ? c : [1];
}

interface Prepared { P: Params; L: Layout; sim: SimResult; warp: TimeWarp; frames: number; title: string; answer: string }
const cache = new Map<string, Prepared>();
function prepare(params: Params): Prepared {
  const key = JSON.stringify(Object.keys(schema).filter(k => schema[k].sim).map(k => params[k]));
  const hit = cache.get(key);
  if (hit) return { ...hit, P: params, title: String(params.title) || hit.L.title, answer: String(params.answer) || hit.L.answer };
  const L = layout(String(params.layout), { ellipseRx: Number(params.ellipseRx), ellipseRy: Number(params.ellipseRy) });
  const sim = simulate(L, counts(params, L));
  const frames = frameCount(params, meta.fps);
  const finalAt = Math.min(Number(params.finalAt), Number(params.duration) - 0.2);
  const k = Number(params.speedUp) - 1;
  const warp = new TimeWarp({ fps: meta.fps, frames, rateAt: t => { const u = Math.min(1, t / finalAt); return 1 + k * u * u; },
    anchorFrame: Math.round(finalAt * meta.fps), anchorSim: sim.tFinal });
  const prep: Prepared = { P: params, L, sim, warp, frames, title: String(params.title) || L.title, answer: String(params.answer) || L.answer };
  cache.clear(); cache.set(key, prep);
  return prep;
}

function audio(params: Params) {
  const { sim, warp, frames } = prepare(params);
  const mix = createMix(frames / meta.fps + 0.5, themeOf(params).audio);
  const lim = new VoiceLimiter(0.016, 2);
  let k = 0;
  for (const e of sim.events) {
    const vt = warp.videoTime(e.t);
    if (e.type === 'wall') sfx(mix, vt, 'tick', { gain: 0.22, pitch: scaleStep(Math.round(e.c * 9)) - 4, pan: (e.x - 540) / 900, seed: ++k }, lim);
    else if (e.type === 'absorb' && e.target < 0) sfx(mix, vt, 'bounce', { gain: 0.2, pan: (e.x - 540) / 900, seed: ++k }, lim);
    else if (e.type === 'wave') { if (e.n > 0) sfx(mix, vt, 'ping', { gain: 0.16, pitch: scaleStep(e.n) - 7, seed: e.n }); }
    else if ((e.type === 'pass' || e.type === 'absorb') && params.arrivalChime) bell(mix, vt, { freq: 523.25, gain: 0.1, decay: 0.8 });
    else if (e.type === 'final') { sfx(mix, vt, 'boom', { gain: 0.5 }); sfx(mix, vt + 0.05, 'success', { gain: 0.55 }); }
  }
  return master(mix);
}

const BUCKETS = 48;

function create(env: Env, params: Params): SceneInstance {
  const { P, L, sim, warp, frames, title, answer } = prepare(params);
  const W = meta.width, H = meta.height, fps = meta.fps;
  const T = themeOf(P);
  const pal = paletteFor(T, P.palette, 'cyclic');
  const cyclic = L.mode === 'fan';
  const colors = Array.from({ length: BUCKETS + 1 }, (_, i) => samplePalette(pal, cyclic ? i / BUCKETS : 0.08 + 0.62 * (i / BUCKETS), cyclic));
  const css = colors.map(c => c.map(Math.round));
  const r = Number(P.ballRadius);
  const balls = colors.map(c => makeBallSprite(env, c, r, {}, T));
  const comets = colors.map(c => makeCometSprite(env, c, r * 4.8, r * 0.75, T));
  const flash = makeGlowSprite(env, rgbOf(T.color.highlight), 26, { core: 0.15 }, T);
  const bg = makeBackground(env, W, H, T);
  const neon = makeNeon(env, W, H, g => { for (const w of L.walls) { w.draw.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); } }, {}, T);
  const decor = L.decor?.length ? makeNeon(env, W, H, g => { for (const d of L.decor!) d.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); }, { core: T.color.wall2, glow: T.color.wall2Glow, width: 4, blur: 10 }, T) : null;
  bakeStatic(bg, neon); // walls never move: one blit for background + walls
  const fresh = createLayer(env, W, H), perm = createLayer(env, W, H), haze = createLayer(env, W, H, 0.25);
  const keep = Math.pow(0.5, 1 / (fps * Number(P.trailHalfLife)));
  const gain = Number(P.trailGain);
  const bucket = (c: number) => Math.max(0, Math.min(BUCKETS, Math.round(c * BUCKETS)));
  const juice = new Juice(env, juiceFrom(P), { capacity: 500, seed: 21, palette: pal, theme: T });

  // event cursor over sim.events in video order
  const ev = sim.events.map(e => ({ e, f: warp.videoTime(e.t) * fps }));
  let st = { frame: 0, evIdx: 0, impacts: [] as { x: number; y: number; t: number }[], lit: [] as { i: number; t: number }[],
    count: sim.waves[0]?.count ?? 1, finalT: -1, finalTarget: -1, homeFlash: -1 };

  function step() {
    const f = ++st.frame, t = f / fps;
    const t0 = warp.sim(f - 1), t1 = warp.sim(f);
    while (st.evIdx < ev.length && ev[st.evIdx].f <= f) {
      const { e } = ev[st.evIdx++];
      if (e.type === 'wall') { st.impacts.push({ x: e.x, y: e.y, t }); if (st.evIdx % 7 === 0) juice.burst(e.x, e.y, 2, { speed: 220, u: e.c, life: 0.35, size: 0.6 }); }
      else if (e.type === 'wave') { st.count = e.count; if (e.n > 0) { juice.pop('counter', 1); juice.shake(2 + Math.min(6, Math.log2(e.count))); } }
      else if (e.type === 'pass' || e.type === 'absorb') { if (e.target >= 0) st.lit.push({ i: e.target, t }); else st.homeFlash = t; }
      else if (e.type === 'final') {
        st.finalT = t; st.finalTarget = e.target; st.count = e.count;
        const Tg = L.targets[Math.max(0, e.target)] ?? { x: 540, y: 960 };
        juice.flash(0.7, [255, 236, 180]); juice.shake(14); juice.pop('counter', 1.4); juice.burst(Tg.x, Tg.y, 90, { speed: 700, life: 0.9 });
      }
    }
    if (st.impacts.length > 900) st.impacts.splice(0, st.impacts.length - 900);
    st.impacts = st.impacts.filter(im => t - im.t < 0.3);
    st.lit = st.lit.filter(l => t - l.t < 1.5);
    juice.update(1 / fps);
    // trails for the interval (t0, t1]
    fadeLayer(fresh, keep); fadeLayer(haze, keep);
    const alive = sim.tracks.filter(tr => tr.segs.length && tr.segs[0].t0 <= t1 && tr.end >= t0);
    const n = Math.max(1, st.count);
    const aFresh = Math.min(0.75, (L.mode === 'fan' ? 0.75 / Math.pow(n, 0.8) : 0.9 / Math.pow(n, 0.5)) * gain * T.trail.alpha);
    const aPerm = Math.min(0.08, (0.1 / Math.sqrt(n)) * gain * T.trail.alpha), aHaze = 0.011 * gain * T.trail.haze;
    const tw = T.trail.width;
    const byB = new Map<number, number[][]>();
    for (const tr of alive) {
      const a = Math.max(t0, tr.segs[0].t0), b = Math.min(t1, tr.end);
      const p0 = trackPos(tr, a, sim.speed); if (!p0) continue;
      const pts = [p0.x, p0.y]; let cb = bucket(p0.c);
      for (let k = p0.seg + 1; k < tr.segs.length && tr.segs[k].t0 <= b; k++) { pts.push(tr.segs[k].x, tr.segs[k].y); }
      const p1 = trackPos(tr, b, sim.speed); if (p1) { pts.push(p1.x, p1.y); cb = bucket(p1.c); }
      (byB.get(cb) ?? byB.set(cb, []).get(cb)!).push(pts);
    }
    for (const [k, list] of byB) {
      const [R, G, B] = css[k];
      for (const [l, a, w] of [[fresh, aFresh, 2 * tw], [perm, aPerm, 1.5 * tw], [haze, aHaze, 14]] as [Layer, number, number][]) {
        if (a <= 0) continue;
        const g = l.ctx; g.globalCompositeOperation = T.blend; g.strokeStyle = `rgba(${R},${G},${B},${a})`; g.lineWidth = w;
        g.beginPath(); for (const pts of list) { g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); } g.stroke();
      }
    }
  }

  function draw(ctx: Ctx) {
    const f = st.frame, t = f / fps, now = warp.sim(f);
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    drawLayer(ctx, perm); drawLayer(ctx, fresh); ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze);
    if (decor) ctx.globalCompositeOperation = decor.op ?? 'lighter';
    if (decor) { drawLayer(ctx, decor); if (st.homeFlash >= 0 && t - st.homeFlash < 0.25) { ctx.globalAlpha = 1 - (t - st.homeFlash) / 0.25; drawLayer(ctx, decor); ctx.globalAlpha = 1; } }
    ctx.globalCompositeOperation = T.juice.blend;
    for (const im of st.impacts) drawSprite(ctx, flash, im.x, im.y, 1 - (t - im.t) / 0.3, 0.8);
    ctx.globalCompositeOperation = 'source-over';
    L.targets.forEach((Tg, i) => {
      const last = st.lit.filter(l => l.i === i).at(-1);
      let lit = last ? Math.max(0, 1 - (t - last.t) / 0.5) : 0;
      if (st.finalT >= 0 && i === st.finalTarget) lit = Math.max(lit, 0.8);
      drawFocusRing(ctx, Tg.x, Tg.y, lit, T);
    });
    // balls
    const fadeAfterFinal = st.finalT >= 0 ? Math.max(0, 1 - (t - st.finalT) / 0.4) : 1;
    const pos: { x: number; y: number; dx: number; dy: number; k: number; a: number }[] = [];
    for (const tr of sim.tracks) {
      if (!tr.segs.length || tr.segs[0].t0 > now) continue;
      if (now > tr.end) {
        const age = t - warp.videoTime(tr.end);
        if (age < 0.15) pos.push({ x: tr.endX, y: tr.endY, dx: 0, dy: 1, k: bucket(tr.segs.at(-1)!.c), a: (1 - age / 0.15) * fadeAfterFinal });
        continue;
      }
      const p = trackPos(tr, now, sim.speed); if (p) pos.push({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, k: bucket(p.c), a: fadeAfterFinal });
    }
    ctx.globalCompositeOperation = T.blend;
    for (const p of pos) if (p.a > 0.5) drawComet(ctx, comets[p.k], p.x, p.y, p.dx, p.dy, 0.9 * p.a);
    ctx.globalCompositeOperation = 'source-over';
    for (const p of pos) drawSprite(ctx, balls[p.k], p.x, p.y, p.a);
    for (const l of st.lit) { const Tg = L.targets[l.i]; drawRipple(ctx, Tg.x, Tg.y, t - l.t, {}, T); }
    if (st.finalT >= 0 && st.finalTarget >= 0) { const Tg = L.targets[st.finalTarget]; drawRipple(ctx, Tg.x, Tg.y, t - st.finalT, { r1: 160, dur: 1.4 }, T); }
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const counter = st.finalT >= 0
      ? [{ text: answer.replace('{n}', String(st.count)), color: T.color.accent }]
      : [{ text: String(P.counter), color: T.color.text }, { text: String(st.count), color: T.color.accent }];
    drawHeader(ctx, W, { title, counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) {
      if (i < st.frame) throw new Error('focal-reflection: render forward only (use snapshot/restore to jump back)');
      while (st.frame < i) step();
      draw(ctx);
    },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), layers: [copyLayer(env, fresh), copyLayer(env, perm), copyLayer(env, haze)] }),
    restore(s: any) { st = structuredClone(s.st); juice.restore(s.juice); restoreLayer(fresh, s.layers[0]); restoreLayer(perm, s.layers[1]); restoreLayer(haze, s.layers[2]); },
    diagnostics: () => ({ lostBalls: sim.lost, maxFocusMissPx: sim.maxMissPx, maxArrivalSpreadSimS: sim.maxSyncSpread, waves: sim.waves.length, finalSimT: sim.tFinal, events: sim.events.length }),
    stateVector: () => { const now = warp.sim(st.frame); const v: number[] = []; for (const tr of sim.tracks) { const p = trackPos(tr, now, sim.speed); if (p) v.push(p.x, p.y, p.dx, p.dy); } return v; },
  };
}

export default { meta, schema, create, audio } satisfies SceneModule;
