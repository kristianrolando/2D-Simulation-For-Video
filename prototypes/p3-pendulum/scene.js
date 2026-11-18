// P3 view: pendulum wave in perspective with motion-blur ribbons.
import { createSim, DEFAULTS as SIM } from './sim.js';
import { makeCamera } from './camera.js';
import { TimeWarp, samplePalette, clamp, smoothstep } from '../lib/core.js';
import { makeBackground, makeNeonLayer, makeBallSprite, drawSpriteCentered, drawHeader } from '../lib/fx.js';
import { createMix, pluck, master } from '../lib/audio.js';
import { dexp } from '../lib/dmath.js';

export const meta = { id: 'p3-pendulum', width: 1080, height: 1920, fps: 60, loudness: -16.6, duration: 25.05 };

export const schema = {
  title:   { type: 'string', default: 'Can this mess sort itself out?' },
  handle:  { type: 'string', default: '' },
  count:   { type: 'integer', default: SIM.count, min: 4, max: 30 },
  nMax:    { type: 'integer', default: SIM.nMax, min: 10, max: 80, label: 'swings of the shortest pendulum per cycle' },
  cycle:   { type: 'number', default: SIM.cycle, min: 10, max: 120, step: 1, label: 'cycle length (sim s)' },
  X0:      { type: 'number', default: SIM.X0, min: 0.05, max: 0.35, step: 0.01, label: 'release displacement (m)' },
  alignAt: { type: 'number', default: 23.47, min: 5, max: 25, step: 0.01, label: 'video time of realignment (s)' },
  growth:  { type: 'number', default: 0.06, min: 0, max: 0.3, step: 0.005, label: 'time-warp exponential growth /s' },
  easeOut: { type: 'number', default: 1.3, min: 0.1, max: 5, step: 0.1, label: 'slow-motion landing (s)' },
  blur:    { type: 'number', default: 0.3, min: 0.02, max: 0.6, step: 0.01, label: 'ribbon length (video s)' },
};
export function defaults() { return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])); }

const CAM = { d: 0.03504, Cy: 0.79037, Cz: -0.58785, alpha: 0.97647, F: 1549.9 }; // tools/fit-camera.mjs
const COLORS = ['#9be36b', '#ffd23f', '#ff9a3d', '#ff6f6f', '#ff6fb5', '#e86cf0', '#9b6bff', '#4f8dff', '#38e1e6'];
const PENTA = [0, 2, 4, 7, 9];

function makeWarp(P, frames, fps) {
  return new TimeWarp({
    fps, frames,
    rateAt: (t) => (t >= P.alignAt ? 0 : dexp(P.growth * t) * (1 - smoothstep(P.alignAt - P.easeOut, P.alignAt, t))),
    anchorFrame: Math.round(P.alignAt * fps), anchorSim: P.cycle,
  });
}

/** inverse of the warp table: sim time -> fractional video time */
function videoTimeOf(warp, simT, fps) {
  const tab = warp.tab; let lo = 0, hi = tab.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] < simT) lo = m; else hi = m; }
  const f = tab[hi] > tab[lo] ? (simT - tab[lo]) / (tab[hi] - tab[lo]) : 0;
  return (lo + f) / fps;
}

export function computeEvents(params = {}) {
  const P = { ...defaults(), ...params };
  const sim = createSim(P);
  const warp = makeWarp(P, Math.round(meta.duration * meta.fps), meta.fps);
  const events = sim.extremes.map(e => ({ type: 'turn', i: e.i, t: e.t, video: videoTimeOf(warp, e.t, meta.fps) }));
  events.push({ type: 'align', t: P.cycle, video: P.alignAt });
  return { events, sim, warp };
}

export function renderAudio(params = {}) {
  const P = { ...defaults(), ...params };
  const { events, sim } = computeEvents(P);
  const mix = createMix(meta.duration);
  const N = sim.pend.length;
  const freq = (i) => { const deg = N - 1 - i; const o = Math.floor(deg / 5), s = PENTA[deg % 5]; return 196 * Math.pow(2, o + s / 12); };
  for (const e of events) {
    if (e.type === 'turn') pluck(mix, e.video, { freq: freq(e.i), gain: 0.07, decay: 1.4, pan: (e.i / (N - 1)) * 0.6 - 0.3 });
    if (e.type === 'align') for (let i = 0; i < N; i += 2) pluck(mix, e.video, { freq: freq(i), gain: 0.06, decay: 2.5 });
  }
  return master(mix);
}

export function create(env, params = {}) {
  const P = { ...defaults(), ...params };
  const { width: W, height: H, fps } = meta;
  const frames = Math.round(meta.duration * fps);
  const sim = createSim(P);
  const warp = makeWarp(P, frames, fps);
  const cam = makeCamera(CAM);
  const N = sim.pend.length;
  const z = (i) => (N - 1 - i) * CAM.d;
  const bobPos = (i, t) => { const p = sim.pend[i], th = sim.theta(i, t); return cam(p.L * Math.sin(th), -p.L * Math.cos(th), z(i)); };

  const bg = makeBackground(env, W, H);
  const p0 = cam(0, 0, z(0)), p1 = cam(0, 0, z(N - 1));
  const rail = makeNeonLayer(env, W, H, (g) => { g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); }, { width: 4, blur: 8 });
  const cols = Array.from({ length: N }, (_, i) => samplePalette(COLORS, i / (N - 1), false));
  const sprites = cols.map((c, i) => makeBallSprite(env, c, 22 * cam(0, -sim.pend[i].L, z(i))[2] / cam(0, -sim.pend[0].L, z(0))[2], { halo: 2.0 }));
  const K = 18; // ribbon samples
  const sRef = cam(0, -sim.pend[0].L, z(0))[2]; // perspective scale of the top bob = 1

  let frame = 0;
  function draw(ctx) {
    const t = frame / fps;
    const now = warp.sim(frame);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bg, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(rail, 0, 0);
    // pivots
    ctx.fillStyle = 'rgba(160,230,255,0.9)';
    for (let i = 0; i < N; i++) { const [x, y] = cam(0, 0, z(i)); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
    // strings
    ctx.lineWidth = 1.3;
    for (let i = 0; i < N; i++) {
      const [px, py] = cam(0, 0, z(i)), [bx, by] = bobPos(i, now);
      const [r, g, b] = cols[i].map(v => Math.round(v * 0.5 + 100));
      ctx.strokeStyle = `rgba(${r},${g},${b},0.33)`;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
    }
    // motion-blur ribbons over the last `blur` seconds of *video* time
    const fBack = Math.max(0, frame - P.blur * fps);
    const tBack = warp.sim(Math.floor(fBack)) + (warp.sim(Math.ceil(fBack)) - warp.sim(Math.floor(fBack))) * (fBack % 1);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (let i = N - 1; i >= 0; i--) {
      const [r, g, b] = cols[i].map(Math.round);
      const pts = [];
      for (let k = 0; k <= K; k++) pts.push(bobPos(i, tBack + (now - tBack) * (k / K)));
      const [x0, y0] = pts[0], [x1, y1] = pts[K];
      if (Math.hypot(x1 - x0, y1 - y0) < 2) continue;
      const sc = pts[K][2] / sRef;
      // one path per layer with a gradient from the oldest (transparent) to the newest sample: no overlap beads
      for (const [w, a, tint] of [[42, 0.24, 0], [22, 0.8, 0.1], [6, 0.5, 0.6]]) {
        const gr = ctx.createLinearGradient(x0, y0, x1, y1);
        const c = [r, g, b].map(v => Math.round(v + (255 - v) * tint));
        gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(0.55, `rgba(${c},${a * 0.6})`); gr.addColorStop(1, `rgba(${c},${a})`);
        ctx.strokeStyle = gr; ctx.lineWidth = w * sc;
        ctx.beginPath(); ctx.moveTo(x0, y0); for (let k = 1; k <= K; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < N; i++) { const [x, y] = bobPos(i, now); drawSpriteCentered(ctx, sprites[i], x, y, 1); }
    drawHeader(ctx, W, { title: P.title, titleY: 218, counter: null, handle: P.handle, handleY: 280 });
  }

  return {
    meta, frames, sim, warp,
    // state is a pure function of the frame index: any order works (seekable)
    renderFrame(ctx, i) { frame = i; draw(ctx); },
    report: () => ({ physics: sim.diagnostics() }),
  };
}
