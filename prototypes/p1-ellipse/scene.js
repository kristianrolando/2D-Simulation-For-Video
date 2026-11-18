// P1 view: draws the ellipse simulation in the reference style. Shared by browser preview and Node render.
import { createSim, DEFAULTS as SIM_DEFAULTS } from './sim.js';
import { TimeWarp, samplePalette, RAINBOW, lerp } from '../lib/core.js';
import { STYLE, makeBackground, makeNeonLayer, makeBallSprite, makeCometSprite, makeGlowSprite,
  drawSpriteCentered, drawComet, drawHeader, drawRipple, drawFocusRing, fadeLayer } from '../lib/fx.js';
import { createMix, tock, bell, master } from '../lib/audio.js';

export const meta = { id: 'p1-ellipse', width: 1080, height: 1920, fps: 60, loudness: -19.8, duration: 31.67 };

// Parameter schema (drives the UI in the final system).
export const schema = {
  title:      { type: 'string', default: 'Will every ball find the same spot?' },
  answer:     { type: 'string', default: 'Every single one: {n}!' },
  handle:     { type: 'string', default: '' },
  A:          { type: 'number', default: SIM_DEFAULTS.A, min: 300, max: 560, step: 1, label: 'semi-major (px)' },
  B:          { type: 'number', default: SIM_DEFAULTS.B, min: 150, max: 500, step: 1, label: 'semi-minor (px)' },
  period:     { type: 'number', default: SIM_DEFAULTS.period, min: 1, max: 5, step: 0.05, label: 'sim seconds per crossing' },
  theta0:     { type: 'number', default: SIM_DEFAULTS.theta0, min: -3.14, max: 3.14, step: 0.01 },
  finalAt:    { type: 'number', default: 29.58, min: 10, max: 31, step: 0.1, label: 'video time of final arrival (s)' },
  speedUp:    { type: 'number', default: 1.405, min: 1, max: 3, step: 0.05, label: 'speed at end / speed at start' },
  trailHalfLife: { type: 'number', default: 1.4, min: 0.1, max: 5, step: 0.1 },
};

export function defaults() { return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])); }

const BUCKETS = 48;

function makeWarp(P, frames, fps) {
  const nWaves = SIM_DEFAULTS.counts.length;
  return new TimeWarp({
    fps, frames,
    rateAt: (t) => { const u = Math.min(1, t / P.finalAt); return 1 + (P.speedUp - 1) * u * u; }, // quadratic ramp fitted to the reference (13 arrivals, error < 0.15 s)
    anchorFrame: Math.round(P.finalAt * fps), anchorSim: nWaves * P.period,
  });
}

/** Video-time event list (used for audio and for timing reports). */
export function computeEvents(params = {}) {
  const P = { ...defaults(), ...params };
  const frames = Math.round(meta.duration * meta.fps);
  const warp = makeWarp(P, frames, meta.fps);
  const sim = createSim(P);
  const out = [];
  for (let f = 1; f <= frames; f++) {
    const t0 = warp.sim(f - 1), t1 = warp.sim(f);
    const { events } = sim.advance(t1);
    for (const e of events) out.push({ ...e, video: (f - 1 + (t1 > t0 ? (e.t - t0) / (t1 - t0) : 1)) / meta.fps, frame: f });
  }
  return { events: out, sim };
}

export function renderAudio(params = {}) {
  const { events } = computeEvents(params);
  const mix = createMix(meta.duration);
  // aggregate wall hits per frame -> one tock whose level grows with the number of hits
  const perFrame = new Map();
  for (const e of events) if (e.type === 'wall') { const a = perFrame.get(e.frame); if (a) a.n++; else perFrame.set(e.frame, { t: e.video, n: 1, x: e.x }); }
  for (const [f, a] of perFrame) tock(mix, a.t, { freq: 540 + 60 * Math.min(4, Math.log2(a.n)), gain: 0.16 * Math.min(1.8, 0.7 + 0.2 * Math.log2(a.n + 1)), pan: (a.x - 540) / 900, seed: f });
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568, 1760, 2093, 2349.3, 2637];
  for (const e of events) {
    if (e.type === 'arrive') bell(mix, e.video, { freq: scale[(e.n - 1) % scale.length] / 2, gain: 0.16, decay: 0.9 });
    if (e.type === 'final') { for (const m of [1, 1.25, 1.5, 2]) bell(mix, e.video, { freq: 392 * m, gain: 0.13, decay: 2.2 }); }
  }
  return master(mix);
}

export function create(env, params = {}) {
  const P = { ...defaults(), ...params };
  const { width: W, height: H, fps } = meta;
  const frames = Math.round(meta.duration * fps);
  const warp = makeWarp(P, frames, fps);
  const sim = createSim(P);

  // ---- static layers / sprites (built once) ----
  const bg = makeBackground(env, W, H);
  const neon = makeNeonLayer(env, W, H, (g) => g.ellipse(P.cx ?? SIM_DEFAULTS.cx, P.cy ?? SIM_DEFAULTS.cy, P.B, P.A, 0, 0, Math.PI * 2));
  const colors = Array.from({ length: BUCKETS }, (_, i) => samplePalette(RAINBOW, i / BUCKETS));
  const cssColors = colors.map(c => c.map(Math.round));
  const ballSprites = colors.map(c => makeBallSprite(env, c, 12));
  const cometSprites = colors.map(c => makeCometSprite(env, c, 58, 9));
  const flash = makeGlowSprite(env, [255, 255, 255], 26, { core: 0.15 });
  const fresh = env.createCanvas(W, H), fg = fresh.getContext('2d');
  const perm = env.createCanvas(W, H), pg = perm.getContext('2d');
  const HS = 4; // haze layer: quarter resolution, wide strokes, upscaled = cheap soft blur
  const haze = env.createCanvas(W / HS, H / HS), hg = haze.getContext('2d');
  hg.scale(1 / HS, 1 / HS);
  for (const g of [fg, pg, hg]) { g.lineCap = 'round'; g.lineJoin = 'round'; }
  const keep = Math.pow(0.5, 1 / (fps * P.trailHalfLife));

  const impacts = []; // {x,y,t}
  let lastArrival = null, finalAt = null, frame = 0, count = 1;
  const bucketOf = (b) => Math.floor(b.hue * BUCKETS) % BUCKETS;

  function step() {
    frame++;
    const tVideo = frame / fps;
    const { paths, events } = sim.advance(warp.sim(frame));
    for (const e of events) {
      if (e.type === 'wall') impacts.push({ x: e.x, y: e.y, t: tVideo });
      if (e.type === 'arrive') { lastArrival = { focus: e.focus, t: tVideo }; count = e.count; }
      if (e.type === 'final') { finalAt = tVideo; lastArrival = { focus: e.focus, t: tVideo }; }
    }
    // trails: one batched path per colour bucket per layer
    fadeLayer(fg, W, H, keep);
    hg.save(); hg.setTransform(1, 0, 0, 1, 0, 0); fadeLayer(hg, W / HS, H / HS, keep); hg.restore();
    const byBucket = new Map();
    for (const b of sim.balls) { const k = bucketOf(b); if (!byBucket.has(k)) byBucket.set(k, []); byBucket.get(k).push(paths.get(b.k)); }
    const n = sim.balls.length;
    const aFresh = Math.min(0.75, 0.75 / Math.pow(n, 0.8)), aPerm = Math.min(0.08, 0.1 / Math.sqrt(n));
    for (const [k, list] of byBucket) {
      const [r, g, bl] = cssColors[k];
      for (const [ctx, alpha, w] of [[fg, aFresh, 2], [pg, aPerm, 1.5], [hg, 0.011, 14]]) {
        ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`; ctx.lineWidth = w;
        ctx.beginPath();
        for (const pts of list) { ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); }
        ctx.stroke();
      }
    }
    while (impacts.length && tVideo - impacts[0].t > 0.3) impacts.shift();
  }

  function draw(ctx) {
    const tVideo = frame / fps;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bg, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(perm, 0, 0);
    ctx.drawImage(fresh, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(haze, 0, 0, W, H);
    ctx.drawImage(neon, 0, 0);
    for (const im of impacts) drawSpriteCentered(ctx, flash, im.x, im.y, 1 - (tVideo - im.t) / 0.3, 0.8);
    ctx.globalCompositeOperation = 'source-over';
    sim.foci.forEach((F, i) => {
      const lit = lastArrival && lastArrival.focus === i ? Math.max(0, 1 - (tVideo - lastArrival.t) / (finalAt ? 3 : 0.5)) : 0;
      drawFocusRing(ctx, F.x, F.y, finalAt && lastArrival.focus === i ? Math.max(lit, 0.8) : lit);
    });
    // balls
    const ballAlpha = finalAt ? Math.max(0, 1 - (tVideo - finalAt) / 0.4) : 1;
    if (ballAlpha > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of sim.balls) {
        if (finalAt) continue;
        const [x, y] = sim.posAt(b, sim.tau);
        drawComet(ctx, cometSprites[bucketOf(b)], x, y, b.dx, b.dy, 0.9);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const b of sim.balls) {
        const [x, y] = finalAt ? [sim.foci[lastArrival.focus].x, sim.foci[lastArrival.focus].y] : sim.posAt(b, sim.tau);
        drawSpriteCentered(ctx, ballSprites[bucketOf(b)], x, y, ballAlpha);
      }
    }
    if (lastArrival) {
      const F = sim.foci[lastArrival.focus];
      drawRipple(ctx, F.x, F.y, tVideo - lastArrival.t, finalAt ? { r1: 160, dur: 1.4 } : {});
    }
    const counter = finalAt
      ? [{ text: P.answer.replace('{n}', count === 377 ? '377' : String(sim.count())), color: STYLE.accent }]
      : [{ text: 'balls: ', color: STYLE.text }, { text: String(count), color: STYLE.accent }];
    drawHeader(ctx, W, { title: P.title, counter, handle: P.handle });
  }

  return {
    meta, frames, sim, warp,
    get frame() { return frame; },
    /** Render frame i into ctx. Frames must be requested in increasing order (sim is stateful). */
    renderFrame(ctx, i) {
      if (i < frame) throw new Error('p1: frames must be rendered in order (reset by re-creating the scene)');
      while (frame < i) step();
      draw(ctx);
    },
  };
}
