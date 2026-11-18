// Scene: one ball on a billiard table (circle, triangle, square). Rational directions close into a
// periodic orbit; an irrational step (e.g. 1/φ² of a turn in the circle) never closes and fills a ring.
import { TimeWarp, commonSchema, samplePalette, PALETTES, frameCount, clamp, dcos, dsin, PHI, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { STYLE, bakeStatic, createLayer, drawLayer, copyLayer, restoreLayer, makeBackground, makeNeon, makeBallSprite, makeCometSprite, drawComet, drawHeader, drawFocusRing, drawRipple, TrailHistory } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom, drawSquashed } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, rgbStr } from '../../theme/index.ts';
import { ellipse, segment, intersect, normalAt, type Conic } from '../focal-reflection/geometry.ts';

const meta = { id: 'billiard', name: 'Billiard paths', family: 'geometry', description: 'A single ball bouncing in a circle, triangle or square — does its path ever close?', width: 1080, height: 1920, fps: 60, loudness: -20 };

const schema: Schema = {
  table: { type: 'enum', default: 'triangle', options: ['triangle', 'circle', 'square'], group: 'Table', label: 'Table shape', sim: true },
  ...commonSchema({ title: 'Will this path ever close?', duration: 33, answer: '' }),
  turn: { type: 'number', default: 1 / (PHI * PHI), min: 0.01, max: 0.5, step: 0.0001, group: 'Table', label: 'Circle: turn per bounce', help: '1/φ² ≈ 0.381966 never closes; 2/7 closes after 7', sim: true },
  dirA: { type: 'integer', default: 13, min: 1, max: 40, group: 'Table', label: 'Triangle/square: direction a', sim: true },
  dirB: { type: 'integer', default: 5, min: 0, max: 40, group: 'Table', label: 'Triangle/square: direction b', sim: true },
  start: { type: 'number', default: 0.37, min: 0.05, max: 0.95, step: 0.01, group: 'Table', label: 'Start point along the edge', sim: true },
  maxBounces: { type: 'integer', default: 220, min: 10, max: 2000, group: 'Table', label: 'Stop after (if it never closes)', sim: true },
  endAt: { type: 'number', default: 31, min: 3, max: 88, step: 0.1, unit: 's', group: 'Timing', label: 'Last bounce at', sim: true },
  speedUp: { type: 'number', default: 3, min: 1, max: 8, step: 0.1, group: 'Timing', label: 'Speed at end ÷ start', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.3, burst: 0.7 }),
};

const C = { x: 540, y: 980 };
interface Path { walls: Conic[]; pts: number[]; cum: number[]; closedAt: number; start: [number, number] }

function build(P: Params): Path {
  const kind = String(P.table);
  let walls: Conic[], x: number, y: number, dx: number, dy: number;
  if (kind === 'circle') {
    const R = 440; walls = [ellipse(C.x, C.y, R, R)];
    const a0 = Math.PI / 2 + 0.3, a1 = a0 + 2 * Math.PI * +P.turn;
    x = C.x + R * dcos(a0); y = C.y + R * dsin(a0);
    const x1 = C.x + R * dcos(a1), y1 = C.y + R * dsin(a1), l = Math.hypot(x1 - x, y1 - y); dx = (x1 - x) / l; dy = (y1 - y) / l;
  } else if (kind === 'square') {
    const h = 430; walls = [segment(C.x - h, C.y - h, C.x + h, C.y - h), segment(C.x + h, C.y - h, C.x + h, C.y + h), segment(C.x + h, C.y + h, C.x - h, C.y + h), segment(C.x - h, C.y + h, C.x - h, C.y - h)];
    x = C.x - h + 2 * h * +P.start; y = C.y + h; const l = Math.hypot(+P.dirA, +P.dirB || 0.0001); dx = +P.dirA / l; dy = -(+P.dirB || 0.0001) / l;
  } else {
    const s = 880, hh = (s * Math.sqrt(3)) / 2, top: [number, number] = [C.x, C.y - hh / 2 - 60], bl: [number, number] = [C.x - s / 2, C.y + hh / 2 - 60], br: [number, number] = [C.x + s / 2, C.y + hh / 2 - 60];
    walls = [segment(bl[0], bl[1], br[0], br[1]), segment(br[0], br[1], top[0], top[1]), segment(top[0], top[1], bl[0], bl[1])];
    // direction a·e1 + b·e2 on the triangular lattice (e1 = (1,0), e2 = (1/2, √3/2)): rational => periodic
    const vx = +P.dirA + 0.5 * +P.dirB, vy = (Math.sqrt(3) / 2) * +P.dirB, l = Math.hypot(vx, vy);
    x = bl[0] + s * +P.start; y = bl[1]; dx = vx / l; dy = -vy / l;
  }
  const pts = [x, y], cum = [0], start: [number, number] = [x, y];
  const d0x = dx, d0y = dy;
  let closedAt = -1;
  for (let k = 1; k <= +P.maxBounces; k++) {
    let best = Infinity, w = -1;
    for (let i = 0; i < walls.length; i++) { const s = intersect(walls[i], x, y, dx, dy); if (s < best) { best = s; w = i; } }
    if (w < 0) break;
    x += dx * best; y += dy * best;
    const [nx, ny] = normalAt(walls[w], x, y), dot = dx * nx + dy * ny;
    dx -= 2 * dot * nx; dy -= 2 * dot * ny; const l = Math.sqrt(dx * dx + dy * dy); dx /= l; dy /= l;
    pts.push(x, y); cum.push(cum[cum.length - 1] + best);
    if (Math.hypot(x - start[0], y - start[1]) < 1e-6 && Math.abs(dx - d0x) < 1e-6 && Math.abs(dy - d0y) < 1e-6) { closedAt = k; break; }
  }
  return { walls, pts, cum, closedAt, start };
}

const cache = new Map<string, Path>();
function pathFor(P: Params) {
  const key = ['table', 'turn', 'dirA', 'dirB', 'start', 'maxBounces'].map(k => P[k]).join('|');
  let p = cache.get(key); if (!p) { p = build(P); cache.clear(); cache.set(key, p); } return p;
}
function warpFor(P: Params, path: Path) {
  const end = Math.min(+P.endAt, +P.duration - 0.3), k = +P.speedUp - 1;
  return new TimeWarp({ fps: meta.fps, frames: frameCount(P, meta.fps), anchorFrame: Math.round(end * meta.fps), anchorSim: path.cum[path.cum.length - 1],
    rateAt: t => (t > end ? 0 : 1 + k * Math.min(1, t / end) ** 2) });
}
/** position at path length s */
function at(path: Path, s: number): [number, number, number, number, number] {
  const c = path.cum; let lo = 0, hi = c.length - 1;
  if (s >= c[hi]) { const n = path.pts.length; return [path.pts[n - 2], path.pts[n - 1], 1, 0, hi]; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const u = (s - c[lo]) / (c[hi] - c[lo]), x0 = path.pts[2 * lo], y0 = path.pts[2 * lo + 1], x1 = path.pts[2 * hi], y1 = path.pts[2 * hi + 1];
  return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, x1 - x0, y1 - y0, lo];
}
const answerFor = (P: Params, path: Path) => String(P.answer) || (path.closedAt > 0 ? `Yes! Closed after ${path.closedAt} bounces` : `Never — ${path.cum.length - 1} bounces and counting`);

function audio(P: Params) {
  const path = pathFor(P), warp = warpFor(P, path), mix = createMix(frameCount(P, meta.fps) / meta.fps + 0.5, themeOf(P).audio), lim = new VoiceLimiter(0.04, 2);
  for (let k = 1; k < path.cum.length; k++) {
    const t = warp.videoTime(path.cum[k]), x = path.pts[2 * k];
    sfx(mix, t, 'bounce', { gain: 0.2, pitch: scaleStep((k * 3) % 11) - 4, pan: (x - 540) / 600, seed: k }, lim);
  }
  sfx(mix, warp.videoTime(path.cum[path.cum.length - 1]) + 0.02, path.closedAt > 0 ? 'success' : 'chime', { gain: 0.5 });
  return master(mix);
}

function create(env: Env, P: Params): SceneInstance {
  const path = pathFor(P), warp = warpFor(P, path), frames = frameCount(P, meta.fps), W = meta.width, H = meta.height, fps = meta.fps;
  const T = themeOf(P);
  const juice = new Juice(env, juiceFrom(P), { capacity: 300, seed: 9, theme: T });
  const bg = makeBackground(env, W, H, T);
  const table = makeNeon(env, W, H, g => { for (const w of path.walls) w.draw.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (String(P.table) !== 'circle') g.closePath(); }, {}, T);
  bakeStatic(bg, table);
  const ink = createLayer(env, W, H), haze = createLayer(env, W, H, 0.25);
  const pal = paletteFor(T, P.palette, 'timeline'), N = 64, head = rgbStr(T.color.highlight);
  const cols = Array.from({ length: N }, (_, i) => samplePalette(pal, i / (N - 1), false));
  const balls = cols.map(c => makeBallSprite(env, c, 15, {}, T)), comets = cols.map(c => makeCometSprite(env, c, 80, 10, T));
  const total = path.cum[path.cum.length - 1];
  const trail = new TrailHistory(1, 200);
  const nb = path.cum.length - 1;
  let st = { frame: 0, s: 0, bounce: 0, lastHitT: -9, doneT: -1 };
  const ci = () => clamp(Math.floor((st.s / total) * (N - 1)), 0, N - 1);

  function step() {
    const f = ++st.frame, t = f / fps, s0 = st.s, s1 = warp.sim(f);
    const [r, g, b] = cols[ci()].map(Math.round);
    const pts: number[] = [];
    const p0 = at(path, s0); pts.push(p0[0], p0[1]);
    for (let k = p0[4] + 1; k < path.cum.length && path.cum[k] <= s1; k++) {
      pts.push(path.pts[2 * k], path.pts[2 * k + 1]); st.bounce = k; st.lastHitT = t;
      juice.burst(path.pts[2 * k], path.pts[2 * k + 1], 5, { speed: 260, u: k / nb, life: 0.4 }); juice.pop('counter', 0.35);
    }
    const p1 = at(path, s1); pts.push(p1[0], p1[1]);
    for (const [l, a, w] of [[ink, Math.min(1, 0.5 * T.trail.alpha), 1.6 * T.trail.width], [haze, 0.05 * T.trail.haze, 10]] as const) {
      if (a <= 0) continue;
      const c = l.ctx; c.globalCompositeOperation = T.blend; c.strokeStyle = `rgba(${r},${g},${b},${a})`; c.lineWidth = w; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke();
    }
    for (let i = 2; i < pts.length; i += 2) trail.push(0, pts[i], pts[i + 1], f);
    st.s = s1;
    if (st.doneT < 0 && s1 >= total) { st.doneT = t; juice.flash(0.55, [255, 232, 170]); juice.shake(7); juice.burst(p1[0], p1[1], 50, { speed: 560 }); juice.pop('counter', 1.2); }
    juice.update(1 / fps);
  }

  function draw(ctx: Ctx) {
    const t = st.frame / fps;
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    ctx.globalCompositeOperation = T.blend;
    ctx.imageSmoothingEnabled = true; drawLayer(ctx, haze); drawLayer(ctx, ink);
    ctx.lineCap = 'round'; trail.draw(ctx, 0, st.frame, 18, head, 0.85, 5 * T.trail.width);
    const [x, y, dx, dy] = at(path, st.s);
    drawComet(ctx, comets[ci()], x, y, dx, dy, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    drawFocusRing(ctx, path.start[0], path.start[1], st.doneT >= 0 && path.closedAt > 0 ? 1 : 0, T);
    if (st.doneT >= 0) drawRipple(ctx, x, y, t - st.doneT, { r1: 150, dur: 1.4 }, T);
    const sq = juice.squash(0.4, t - st.lastHitT);
    drawSquashed(ctx, balls[ci()], x, y, Math.atan2(dy, dx), sq.sx, sq.sy);
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    const counter = st.doneT >= 0 ? [{ text: answerFor(P, path), color: T.color.accent }] : [{ text: 'bounces: ', color: T.color.text }, { text: String(st.bounce), color: T.color.accent }];
    drawHeader(ctx, W, { title: String(P.title), counter, counterScale: juice.popScale('counter'), handle: String(P.handle), t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('billiard: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), trail: trail.snapshot(), layers: [copyLayer(env, ink), copyLayer(env, haze)] }),
    restore(x: any) { st = structuredClone(x.st); juice.restore(x.juice); trail.restore(x.trail); restoreLayer(ink, x.layers[0]); restoreLayer(haze, x.layers[1]); },
    diagnostics: () => ({ bounces: path.cum.length - 1, closedAt: path.closedAt, pathLengthPx: total }),
    stateVector: () => at(path, st.s).slice(0, 4),
  };
}

export const billiardPath = build;
export default { meta, schema, create, audio } satisfies SceneModule;
