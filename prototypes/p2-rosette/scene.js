// P2 view: rosette orbit in the reference style.
import { createSim, DEFAULTS as SIM } from './sim.js';
import { TimeWarp, samplePalette, formatThousands, clamp } from '../lib/core.js';
import { STYLE, makeBackground, makeBallSprite, makeCometSprite, makeGlowSprite, drawSpriteCentered, drawComet,
  drawHeader, drawRipple, drawFocusRing, fadeLayer } from '../lib/fx.js';
import { createMix, bell, master } from '../lib/audio.js';
import { dexp } from '../lib/dmath.js';

export const meta = { id: 'p2-rosette', width: 1080, height: 1920, fps: 60, loudness: -14.2, duration: 31.56 };

export const schema = {
  title:       { type: 'string', default: 'Does this orbit ever repeat?' },
  handle:      { type: 'string', default: '' },
  rApo:        { type: 'number', default: SIM.rApo, min: 150, max: 480, step: 1 },
  rPeri:       { type: 'number', default: SIM.rPeri, min: 20, max: 300, step: 1 },
  precessDeg:  { type: 'number', default: SIM.precessDeg, min: 2, max: 60, step: 0.5, label: 'precession per orbit (deg)' },
  periodYears: { type: 'number', default: SIM.periodYears, min: 100, max: 100000, step: 50 },
  closeAt:     { type: 'number', default: 28.6, min: 5, max: 31, step: 0.1, label: 'video time when the orbit closes (s)' },
  rampA:       { type: 'number', default: 0.00674, min: 0, max: 0.2, step: 0.0001, label: 'time-warp: log-rate slope' },
  rampB:       { type: 'number', default: 0.002168, min: 0, max: 0.02, step: 0.0001, label: 'time-warp: log-rate curvature' },
};
export function defaults() { return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])); }

const SUN = { x: 540, y: 960 };
const TRAIL = ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff7a8a', '#ff9a3d', '#ffd23f', '#b6e36b'];

function makeWarp(P, sim, frames, fps) {
  // log(rate) = a t + b t^2, fitted to the reference's year counter (see docs/report.md)
  const r = (t) => dexp(P.rampA * t + P.rampB * t * t);
  return new TimeWarp({
    fps, frames,
    // after closing, time slows back down to the opening pace over ~0.3 s (counter freezes)
    rateAt: (t) => (t <= P.closeAt ? r(t) : Math.max(1, r(P.closeAt) * dexp(-(t - P.closeAt) / 0.3))),
    anchorFrame: Math.round(P.closeAt * fps), anchorSim: sim.closeYears,
  });
}

export function computeEvents(params = {}) {
  const P = { ...defaults(), ...params };
  const sim = createSim(P);
  const frames = Math.round(meta.duration * meta.fps);
  const warp = makeWarp(P, sim, frames, meta.fps);
  const out = [];
  for (let f = 1; f <= frames; f++) {
    const a = warp.sim(f - 1), b = warp.sim(f);
    for (const e of sim.advance(b).events) out.push({ ...e, video: (f - 1 + (e.t - a) / (b - a)) / meta.fps, frame: f });
  }
  return { events: out, sim, warp };
}

export function renderAudio(params = {}) {
  const { events } = computeEvents(params);
  const mix = createMix(meta.duration);
  for (const e of events) {
    if (e.type === 'peri') bell(mix, e.video, { freq: 784 * Math.pow(2, ((e.k * 2) % 7) / 12), gain: 0.18, decay: 0.7, pan: 0.15 });
    if (e.type === 'close') for (const m of [1, 1.5, 2, 2.52]) bell(mix, e.video, { freq: 392 * m, gain: 0.15, decay: 2.5 });
  }
  return master(mix);
}

export function create(env, params = {}) {
  const P = { ...defaults(), ...params };
  const { width: W, height: H, fps } = meta;
  const frames = Math.round(meta.duration * fps);
  const sim = createSim(P);
  const warp = makeWarp(P, sim, frames, fps);
  const toScreen = (x, y) => [SUN.x + x, SUN.y - y];

  const bg = makeBackground(env, W, H);
  const trail = env.createCanvas(W, H), tg = trail.getContext('2d');
  const HS = 4, haze = env.createCanvas(W / HS, H / HS), hg = haze.getContext('2d'); hg.scale(1 / HS, 1 / HS);
  for (const g of [tg, hg]) { g.lineCap = 'round'; g.lineJoin = 'round'; }
  // ghost of the first (unprecessed) orbit, shown at the start and faded out
  const ghost = env.createCanvas(W, H), gg = ghost.getContext('2d');
  gg.strokeStyle = 'rgba(150,170,210,0.22)'; gg.lineWidth = 2; gg.beginPath();
  for (let i = 0; i <= 720; i++) {
    const ph = (i / 720) * Math.PI * 2; const th0 = (SIM.startAngleDeg * Math.PI) / 180;
    const pl = (2 * P.rApo * P.rPeri) / (P.rApo + P.rPeri), e = sim.e;
    const r = pl / (1 + e * Math.cos(ph - (th0 - Math.PI)));
    const [x, y] = toScreen(r * Math.cos(ph), r * Math.sin(ph)); if (i) gg.lineTo(x, y); else gg.moveTo(x, y);
  }
  gg.stroke();
  const sunGlow = makeGlowSprite(env, [255, 150, 40], 70, { core: 0.25 });
  const sunCore = makeGlowSprite(env, [255, 255, 235], 26, { core: 0.55, intensity: 1 });
  const dot = makeGlowSprite(env, [255, 225, 77], 9, { core: 0.55 });
  const N = 64;
  const cols = Array.from({ length: N }, (_, i) => samplePalette(TRAIL, i / (N - 1), false));
  const balls = cols.map(c => makeBallSprite(env, c, 10));
  const comets = cols.map(c => makeCometSprite(env, c, 60, 6));

  let frame = 0, last = null, display = sim.start.slice(), years = 0, closedAt = null;
  const peris = [];
  const colIndex = () => clamp(Math.floor((years / sim.closeYears) * (N - 1)), 0, N - 1);
  last = toScreen(display[0], display[1]);

  function step() {
    frame++;
    const target = warp.sim(frame);
    const { points, events, display: d } = sim.advance(target);
    display = d; years = target;
    for (const e of events) {
      if (e.type === 'peri') peris.push(toScreen(e.x, e.y));
      if (e.type === 'close') closedAt = frame / fps;
    }
    const [r, g, b] = cols[colIndex()].map(Math.round);
    tg.globalCompositeOperation = 'lighter'; hg.globalCompositeOperation = 'lighter';
    for (const [ctx, a, w] of [[tg, 0.5, 1.6], [hg, 0.05, 10]]) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${a})`; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(last[0], last[1]);
      for (let i = 0; i < points.length; i += 2) { const [x, y] = toScreen(points[i], points[i + 1]); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    last = toScreen(display[0], display[1]);
  }

  function draw(ctx) {
    const t = frame / fps;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bg, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    if (t < 3) { ctx.globalAlpha = clamp(1 - t / 3, 0, 1); ctx.drawImage(ghost, 0, 0); ctx.globalAlpha = 1; }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(haze, 0, 0, W, H);
    ctx.drawImage(trail, 0, 0);
    // dark disc behind the sun hides the densest crossings, as in the reference
    ctx.globalCompositeOperation = 'source-over';
    const dg = ctx.createRadialGradient(SUN.x, SUN.y, 20, SUN.x, SUN.y, 62);
    dg.addColorStop(0, 'rgba(0,0,4,1)'); dg.addColorStop(0.7, 'rgba(0,0,4,0.85)'); dg.addColorStop(1, 'rgba(0,0,4,0)');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 62, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y] of peris) drawSpriteCentered(ctx, dot, x, y, 1);
    drawSpriteCentered(ctx, sunGlow, SUN.x, SUN.y, 1);
    drawSpriteCentered(ctx, sunCore, SUN.x, SUN.y, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,60,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(SUN.x, SUN.y, 22, 0, Math.PI * 2); ctx.stroke();
    // start marker + closing flash
    const [sx, sy] = toScreen(sim.start[0], sim.start[1]);
    drawFocusRing(ctx, sx, sy, closedAt ? Math.max(0, 1 - (t - closedAt) / 2.5) : 0);
    if (closedAt) drawRipple(ctx, sx, sy, t - closedAt, { r1: 110, dur: 1.6 });
    // planet
    const [bx, by] = toScreen(display[0], display[1]);
    ctx.globalCompositeOperation = 'lighter';
    drawComet(ctx, comets[colIndex()], bx, by, display[2], -display[3], 0.9);
    ctx.globalCompositeOperation = 'source-over';
    drawSpriteCentered(ctx, balls[colIndex()], bx, by, 1);
    const shown = closedAt ? sim.closeYears : Math.floor(years / 100) * 100;
    drawHeader(ctx, W, { title: P.title, counter: [{ text: 'years: ', color: STYLE.text }, { text: formatThousands(shown), color: STYLE.accent }], handle: P.handle });
  }

  return {
    meta, frames, sim, warp,
    renderFrame(ctx, i) {
      if (i < frame) throw new Error('p2: frames must be rendered in order');
      while (frame < i) step();
      draw(ctx);
    },
    report: () => ({ physics: sim.diagnostics() }),
  };
}
