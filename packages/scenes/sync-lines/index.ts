// Scene template: Sync & close — things with different rhythms that come back together, and lines that
// may or may not close. Modes (rules): orbits, lid, slider, close. Containers: circle, square, triangle, ring.
// Every mode ends where it started, so the video loops.
import { commonSchema, samplePalette, frameCount, clamp, ease, dsin, dcos, dexp, dlog, type Params, type Schema, type SceneModule, type SceneInstance, type Env, type Ctx } from '../../core/index.ts';
import { bakeStatic, createLayer, drawLayer, fadeLayer, copyLayer, restoreLayer, makeBackground, makeNeon, makeShapeSprite, makeGlowSprite, drawSprite, drawHeader, drawRipple, fontOf, SHAPE_KINDS, type Sprite, type ShapeKind, type Layer } from '../../render2d/index.ts';
import { createMix, master } from '../../audio/index.ts';
import { sfx, VoiceLimiter, scaleStep } from '../../audio/bank.ts';
import { Juice, juiceSchema, juiceFrom } from '../../juice/index.ts';
import { themeOf, paletteFor, PALETTE_OPTIONS, rgbOf, rgbaOf, rgbStr } from '../../theme/index.ts';
import { makeContainer, pathPoint, type Container, type ContainerKind } from '../../sim/shapes.ts';
import { MODES, LAP_RULES, HIDDEN, RATIOS, HIDDEN_M, lapsFor, cycle, lidHeight, ratioFor, pen, gapAfter, slide, type Mode, type LapRule, type Hidden, type RatioName, type Ratio } from './model.ts';

const meta = { id: 'sync-lines', name: 'Sync & close', family: 'sync', description: 'Different rhythms that line up again, hit the lid together, hide a shape — or a line that never closes.', width: 1080, height: 1920, fps: 60, loudness: -16 };

const CONTAINERS: ContainerKind[] = ['circle', 'square', 'triangle', 'ring'];
const schema: Schema = {
  ...commonSchema({ title: '', duration: 40, answer: '' }),
  counter: { type: 'text', default: '', group: 'Text', label: 'Counter label (empty = automatic)' },
  mode: { type: 'enum', default: 'orbits', options: MODES, group: 'Setup', label: 'Rule', sim: true, help: 'orbits: different laps, back in line at the end · lid: different bounce rhythms, one shared hit · slider: a new line every few seconds hides a shape · close: a two-arm pen that may never close' },
  container: { type: 'enum', default: 'circle', options: CONTAINERS, group: 'Setup', label: 'Shape', sim: true },
  objects: { type: 'enum', default: 'ball', options: [...SHAPE_KINDS, 'mixed'], group: 'Setup', label: 'Objects' },
  count: { type: 'integer', default: 12, min: 3, max: 40, group: 'Setup', label: 'How many', sim: true },
  seed: { type: 'integer', default: 7, min: 1, max: 99999, group: 'Setup', label: 'Seed', sim: true, help: 'Colours, the seeded lap set and the seeded ratio. Same seed = same video.' },
  laps: { type: 'enum', default: 'consecutive', options: LAP_RULES, group: 'Rules', label: 'Laps per object (orbits, lid)', sim: true },
  lapBase: { type: 'integer', default: 3, min: 1, max: 20, group: 'Rules', label: 'Laps of the slowest', sim: true },
  direction: { type: 'enum', default: 'same', options: ['same', 'alternate'], group: 'Rules', label: 'Direction (orbits)', sim: true },
  motion: { type: 'enum', default: 'gravity', options: ['linear', 'gravity', 'piston'], group: 'Rules', label: 'Bounce motion (lid)', sim: true },
  hidden: { type: 'enum', default: 'circle', options: HIDDEN, group: 'Rules', label: 'Hidden shape (slider)', sim: true },
  period: { type: 'number', default: 2.5, min: 0.8, max: 8, step: 0.1, unit: 's', group: 'Rules', label: 'Back-and-forth time (slider)', sim: true },
  ratio: { type: 'enum', default: 'pi', options: [...RATIOS], group: 'Rules', label: 'Fast arm ÷ slow arm (close)', sim: true },
  slowEnds: { type: 'number', default: 0.85, min: 0, max: 1, step: 0.05, group: 'Timing', label: 'Slow start and finish', sim: true },
  hold: { type: 'number', default: 3, min: 1.5, max: 8, step: 0.1, unit: 's', group: 'Timing', label: 'Ending hold (loops back)', sim: true },
  palette: { type: 'enum', default: 'theme', options: PALETTE_OPTIONS, group: 'Style', label: 'Colours' },
  ...juiceSchema({ shake: 0.4, burst: 0.7 }),
};

// ---------------- texts ----------------
const HOOKS: Record<Mode, string[]> = {
  orbits: ['{n} dots, {n} different speeds\nWill they ever line up again?', 'They all start in one line\nHow long until it happens again?', 'Each one laps at its own pace\nOne more perfect line?'],
  lid: ['{n} balls, {n} rhythms\nCan they all hit the lid at once?', 'Every ball has its own beat\nWatch the lid…', 'Different bounces, one lid\nSame moment?'],
  slider: ['Each dot only slides back and forth\nWhat are they drawing?', 'A new line every {d} seconds\nWhat shape is hiding here?', 'Straight lines only\nSo where does the curve come from?'],
  close: ['Two arms. One spins {r}× faster\nDoes the line ever close?', 'Will the pen ever find its start?', 'Fast arm ÷ slow arm = {r}\nClosed loop or never?'],
};
const ANSWER_HIDDEN: Record<Hidden, string> = { circle: 'A rolling circle all along!', flower4: 'A hidden four-petal flower!', flower3: 'A hidden three-petal flower!', pulse: 'A breathing circle!' };

// ---------------- the run, derived from params (pure) ----------------
interface Run {
  mode: Mode; N: number; fps: number; frames: number; tEnd: number; hold: number; slow: number;
  C: Container; cx: number; cy: number;
  laps: number[]; sign: number[];
  // orbits
  sides: number; radius: number[];
  // lid
  columns: boolean; floorD: number[]; lidD: number[]; ax: number[]; ay: number[]; colX: number[]; floorY: number; lidY: number;
  // slider
  omega: number; m: number; phi: number[]; cphi: number[]; sphi: number[]; lineT: number[]; reveal: number; Rs: number;
  // close
  ratio: Ratio; kEnd: number; kappa: number; armA: number; armB: number;
  objR: number;
}

function build(P: Params): Run {
  const mode = String(P.mode) as Mode, N = Math.round(+P.count), fps = meta.fps, frames = frameCount(P, fps);
  const hold = Math.min(+P.hold, +P.duration * 0.4), tEnd = +P.duration - hold;
  const kind = String(P.container) as ContainerKind, C = makeContainer(kind, 540, 1010, 960, 960, 0.26);
  const run: Run = { mode, N, fps, frames, tEnd, hold, slow: +P.slowEnds, C, cx: C.cx, cy: C.cy, laps: [], sign: [], sides: 0, radius: [],
    columns: false, floorD: [], lidD: [], ax: [], ay: [], colX: [], floorY: 0, lidY: 0, omega: 0, m: 1, phi: [], cphi: [], sphi: [], lineT: [], reveal: 0, Rs: 0,
    ratio: ratioFor('pi', 1), kEnd: 1, kappa: 1, armA: 0, armB: 0, objR: 12 };
  run.laps = lapsFor(String(P.laps) as LapRule, N, +P.lapBase, +P.seed);
  run.sign = run.laps.map((_, k) => ((P.direction === 'alternate' || kind === 'ring') && mode === 'orbits' && k % 2 ? -1 : 1));
  const inR = C.inside(C.cx, C.cy); // inscribed radius
  if (mode === 'orbits') {
    run.sides = kind === 'square' ? 4 : kind === 'triangle' ? 3 : 0;
    const Rmax = (run.sides ? C.R : C.R) * 0.9, R0 = kind === 'ring' ? C.rin + 30 : Rmax * 0.16;
    run.radius = run.laps.map((_, k) => (N === 1 ? Rmax : R0 + ((Rmax - R0) * k) / (N - 1)));
    run.objR = clamp((0.4 * (Rmax - R0)) / Math.max(1, N - 1), 5, 24);
  } else if (mode === 'lid') {
    if (kind === 'square') {
      run.columns = true;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < C.verts.length; k += 2) { x0 = Math.min(x0, C.verts[k]); x1 = Math.max(x1, C.verts[k]); y0 = Math.min(y0, C.verts[k + 1]); y1 = Math.max(y1, C.verts[k + 1]); }
      run.colX = run.laps.map((_, k) => x0 + ((k + 0.5) * (x1 - x0)) / N);
      run.objR = clamp((0.36 * (x1 - x0)) / N, 5, 26);
      run.lidY = y0 + 46; run.floorY = y1;
    } else {
      const rf = kind === 'ring' ? C.rin : C.R * 0.17;
      run.objR = clamp(Math.min((0.42 * 2 * Math.PI * rf) / N, 22), 5, 22);
      for (let k = 0; k < N; k++) {
        const a = -Math.PI / 2 + (2 * Math.PI * k) / N, ux = dcos(a), uy = dsin(a);
        let L = rf; for (let d = rf; d < 1200; d += 1) { if (C.inside(C.cx + ux * d, C.cy + uy * d) < 0) { L = d; break; } }
        run.ax.push(ux); run.ay.push(uy); run.floorD.push(rf + run.objR); run.lidD.push(L - run.objR - 3);
      }
    }
  } else if (mode === 'slider') {
    // the dot period is snapped so the whole video is a whole number of periods (the loop closes exactly)
    const per = +P.duration / Math.max(1, Math.round(+P.duration / +P.period));
    run.omega = (2 * Math.PI) / per; run.m = HIDDEN_M[String(P.hidden) as Hidden] ?? 1;
    const phi0 = ((Math.round(+P.seed) % 4) * Math.PI) / 16;
    run.phi = Array.from({ length: N }, (_, j) => phi0 + (j * Math.PI) / N);
    run.cphi = run.phi.map(a => dcos(a)); run.sphi = run.phi.map(a => dsin(a));
    const every = (tEnd * 0.82) / N;
    run.lineT = run.phi.map((_, j) => j * every);
    run.reveal = N * every;
    run.Rs = (kind === 'ring' ? C.R : inR) * 0.92;
    run.objR = clamp(18 - N * 0.2, 8, 18);
  } else {
    run.ratio = ratioFor(String(P.ratio) as RatioName, +P.seed);
    const ms = run.ratio.milestones;
    run.kEnd = run.ratio.rational ? run.ratio.q : ms[ms.length - 1] + 0.7;
    run.kappa = Math.max(0.6, 0.9 * dlog(run.kEnd + 1));
    const Rr = (kind === 'ring' ? C.R : inR) * 0.95;
    run.armA = Rr * 0.56; run.armB = Rr * 0.44;
    run.objR = 10;
  }
  return run;
}

/** cycle position at time t (0..1 over the main part) */
const Uof = (R: Run, t: number) => cycle(t / R.tEnd, R.slow);
/** close mode: slow-arm turns at time t (exponential acceleration, exact kEnd at tEnd) */
function turnsAt(R: Run, t: number) {
  const u = clamp(t / R.tEnd, 0, 1);
  if (u >= 1) return R.kEnd;
  return (R.kEnd * (dexp(R.kappa * u) - 1)) / (dexp(R.kappa) - 1);
}

type EvFn = (type: string, k: number, x: number, y: number) => void;
const EPS = 1e-9;
/** events between t0 (exclusive) and t1 (inclusive) — shared by sound and picture */
function eventsBetween(R: Run, t0: number, t1: number, fn: EvFn) {
  const tc0 = Math.min(t0, R.tEnd), tc1 = Math.min(t1, R.tEnd);
  if (R.mode === 'orbits' || R.mode === 'lid') {
    if (tc1 <= tc0) return;
    const U0 = Uof(R, tc0), U1 = Uof(R, tc1);
    for (let k = 0; k < R.N; k++) {
      const m = R.laps[k];
      if (R.mode === 'orbits') {
        if (Math.floor(m * U1 + EPS) > Math.floor(m * U0 + EPS)) { const p = { x: 0, y: 0 }; pathPoint(R.cx, R.cy, R.radius[k], R.sides, 0, p); fn('pass', k, p.x, p.y); }
      } else {
        const q0 = U0 * (m + 0.5), q1 = U1 * (m + 0.5);
        const [x, y] = lidPoint(R, k, 1);
        if (Math.floor(q1 + 0.5 + EPS) > Math.floor(q0 + 0.5 + EPS)) fn('lid', k, x, y);
        if (Math.floor(q1 + EPS) > Math.floor(q0 + EPS)) { const [fx, fy] = lidPoint(R, k, 0); fn('floor', k, fx, fy); }
      }
    }
    if (R.mode === 'orbits' && U0 < 0.5 && U1 >= 0.5) fn('line', 0, R.cx, R.cy);
  } else if (R.mode === 'slider') {
    for (let j = 0; j < R.N; j++) {
      if (R.lineT[j] > t0 && R.lineT[j] <= t1 && j > 0) fn('newline', j, R.cx, R.cy);
      if (t1 <= R.lineT[j] || t0 >= R.tEnd) continue;
      const a = Math.max(t0, R.lineT[j]);
      const p0 = R.omega * a - R.m * R.phi[j], p1 = R.omega * Math.min(t1, R.tEnd) - R.m * R.phi[j];
      if (Math.floor(p1 / Math.PI + EPS) > Math.floor(p0 / Math.PI + EPS)) {
        const s = Math.round(p1 / Math.PI) % 2 ? -1 : 1;
        fn('cap', j, R.cx + s * R.Rs * R.cphi[j], R.cy + s * R.Rs * R.sphi[j]);
      }
    }
    if (R.reveal > t0 && R.reveal <= t1) fn('reveal', 0, R.cx, R.cy);
  } else {
    if (tc1 <= tc0) return;
    const k0 = turnsAt(R, tc0), k1 = turnsAt(R, tc1);
    if (Math.floor(k1 + EPS) > Math.floor(k0 + EPS)) fn('turn', Math.floor(k1 + EPS), R.cx, R.cy - R.armA - R.armB);
    R.ratio.milestones.forEach((q, i) => { if (k0 < q - EPS && k1 >= q - EPS) fn('milestone', i, R.cx, R.cy - R.armA - R.armB); });
  }
  if (t0 < R.tEnd && t1 >= R.tEnd) fn('final', 0, R.cx, R.cy);
}

/** lid mode: position of object k at height h (0 floor, 1 lid) */
function lidPoint(R: Run, k: number, h: number): [number, number] {
  if (R.columns) { const y = R.floorY - R.objR - h * (R.floorY - R.lidY - 2 * R.objR); return [R.colX[k], y]; }
  const d = R.floorD[k] + h * (R.lidD[k] - R.floorD[k]);
  return [R.cx + R.ax[k] * d, R.cy + R.ay[k] * d];
}
/** lid mode height at time t, including the fall back to the floor during the hold */
function lidH(R: Run, k: number, t: number, motion: string) {
  if (t <= R.tEnd) return lidHeight(Uof(R, t), R.laps[k], motion);
  const s = clamp((t - R.tEnd) / (R.hold * 0.65), 0, 1);
  return 1 - s * s; // all fall together (gravity-like)
}

const runCache = new Map<string, Run>();
function runFor(P: Params) {
  const key = JSON.stringify(['mode', 'count', 'container', 'laps', 'lapBase', 'direction', 'hidden', 'period', 'ratio', 'seed', 'slowEnds', 'hold', 'duration'].map(k => P[k]));
  let r = runCache.get(key); if (!r) { r = build(P); runCache.clear(); runCache.set(key, r); }
  return r;
}

function hook(P: Params) {
  const R = runFor(P), mode = String(P.mode) as Mode, list = HOOKS[mode] ?? HOOKS.orbits;
  const every = R.N ? R.reveal / R.N : 0;
  return list[Math.abs(Math.round(+P.seed)) % list.length].replaceAll('{n}', String(R.N)).replace('{d}', every.toFixed(1)).replace('{r}', mode === 'close' ? R.ratio.name : '');
}
const titleOf = (P: Params) => (String(P.title).trim() ? String(P.title) : hook(P));
function labelOf(P: Params, R: Run) {
  if (String(P.counter)) return String(P.counter);
  return R.mode === 'orbits' ? 'In line: ' : R.mode === 'lid' ? 'Lid hits: ' : R.mode === 'slider' ? 'Lines: ' : 'Slow-arm turns: ';
}
function answerOf(P: Params, R: Run) {
  if (String(P.answer).trim()) return String(P.answer).replace('{n}', String(R.N));
  switch (R.mode) {
    case 'orbits': return `All ${R.N} back in line!`;
    case 'lid': return `All ${R.N} at the same moment!`;
    case 'slider': return ANSWER_HIDDEN[String(P.hidden) as Hidden] ?? ANSWER_HIDDEN.circle;
    default: return R.ratio.rational ? `Closed after ${R.ratio.q} turns!` : `It never closes: ${R.ratio.label}.`;
  }
}

// ---------------- audio ----------------
function audio(P: Params) {
  const R = runFor(P), T = themeOf(P), mix = createMix(R.frames / R.fps + 0.6, T.audio), lim = new VoiceLimiter(0.02, 4);
  for (let f = 1; f < R.frames; f++) {
    const t0 = (f - 1) / R.fps, t1 = f / R.fps;
    eventsBetween(R, t0, t1, (type, k, x) => {
      const pan = (x - R.cx) / 600;
      switch (type) {
        case 'pass': sfx(mix, t1, 'ping', { gain: 0.1 + 0.08 * (t1 / R.tEnd), pitch: scaleStep(k) - 4, pan, seed: f + k }, lim); break;
        case 'line': sfx(mix, t1, 'chime', { gain: 0.3 }); break;
        case 'lid': sfx(mix, t1, 'clang', { gain: 0.12 + 0.1 * (t1 / R.tEnd), pitch: scaleStep(k) - 3, pan, seed: f + k }, lim); break;
        case 'floor': sfx(mix, t1, 'tick', { gain: 0.05, pitch: scaleStep(k) - 6, pan, seed: f * 3 + k }, lim); break;
        case 'newline': sfx(mix, t1, 'pop', { gain: 0.22, pitch: scaleStep(k) - 2, seed: k }); sfx(mix, t1, 'whoosh', { gain: 0.06, seed: k }); break;
        case 'cap': sfx(mix, t1, 'tick', { gain: 0.05 + 0.12 * (k / R.N), pitch: scaleStep(k) - 1, pan, seed: f + k * 17 }, lim); break;
        case 'reveal': sfx(mix, t1, 'success', { gain: 0.5 }); sfx(mix, t1, 'boom', { gain: 0.25 }); break;
        case 'turn': sfx(mix, t1, 'ping', { gain: 0.1, pitch: scaleStep(k % 15) - 6, seed: k }, lim); break;
        case 'milestone': sfx(mix, t1, 'chime', { gain: 0.38, pitch: 2 * k }); sfx(mix, t1 - 0.4, 'whoosh', { gain: 0.15, seed: k }); break;
        case 'final':
          if (R.mode === 'orbits' || R.mode === 'lid') for (let q = 0; q < Math.min(R.N, 8); q++) sfx(mix, t1, R.mode === 'lid' ? 'clang' : 'ping', { gain: 0.16, pitch: scaleStep(q * 2) - 3, seed: q });
          sfx(mix, t1 + 0.02, R.mode === 'close' && !R.ratio.rational ? 'boom' : 'success', { gain: 0.5 });
          if (R.mode !== 'close' || R.ratio.rational) sfx(mix, t1, 'boom', { gain: 0.35 });
          break;
      }
    });
  }
  // a quiet clock from the first second (never a silent opening); its pitch creeps up toward the finish
  if (R.mode === 'orbits' || R.mode === 'lid') {
    for (let t = 0.25, n = 0; t < R.tEnd - 7.4; t += 0.7, n++) sfx(mix, t, 'tick', { gain: 0.04 + 0.03 * (t / R.tEnd), pitch: -10 + 6 * (t / R.tEnd) + (n % 2 ? 2 : 0), seed: 900 + n });
  }
  // suspense before the finish: a heartbeat that quickens and climbs over the last seconds, then a riser
  if (R.mode !== 'slider') {
    let t = Math.max(0, R.tEnd - 7), n = 0;
    while (t < R.tEnd - 0.25) { const u = 1 - (R.tEnd - t) / 7; sfx(mix, t, 'tick', { gain: 0.05 + 0.12 * u, pitch: scaleStep(Math.floor(u * 8)) - 8, seed: n++ }); t += 0.62 - 0.4 * u; }
    sfx(mix, R.tEnd - 0.9, 'whoosh', { gain: 0.32, seed: 11 });
  }
  if (R.mode === 'close') {
    // the fast arm clicks once per turn of its own, quietly, so the drawing is never silent
    const total = R.kEnd * R.ratio.value; let last = 0;
    for (let f = 1; f < R.frames && f / R.fps <= R.tEnd; f++) { const k = Math.floor(turnsAt(R, f / R.fps) * R.ratio.value); if (k > last) { last = k; sfx(mix, f / R.fps, 'tick', { gain: 0.045, pitch: scaleStep(k % 5) + 2 * (k / total), seed: k }, lim); } }
  }
  // the loop back to the start
  sfx(mix, R.tEnd + R.hold * 0.55, 'whoosh', { gain: 0.2, seed: 5 });
  return master(mix);
}

// ---------------- picture ----------------
function create(env: Env, P: Params): SceneInstance {
  const R = runFor(P), T = themeOf(P), { frames, fps, N, C } = R, W = meta.width, H = meta.height;
  const juice = new Juice(env, juiceFrom(P), { capacity: 500, seed: +P.seed, gravity: 700, theme: T });
  const bg = makeBackground(env, W, H, T);
  const kind = String(P.container) as ContainerKind;
  // static line art: the container (except in orbits mode, where the outer track is the frame) + guides
  const art = makeNeon(env, W, H, g => {
    if (R.mode === 'orbits') { const p = { x: 0, y: 0 }; for (let s = 0; s <= 240; s++) { pathPoint(R.cx, R.cy, R.radius[N - 1] + 34, R.sides, s / 240, p); s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.closePath(); if (kind === 'ring') { g.moveTo(R.cx + R.radius[0] - 30, R.cy); g.arc(R.cx, R.cy, R.radius[0] - 30, 0, Math.PI * 2); } }
    else C.path(g as any);
    if (R.mode === 'lid' && R.columns) { g.moveTo(R.colX[0] - 60, R.lidY - 10); g.lineTo(R.colX[N - 1] + 60, R.lidY - 10); }
  }, { width: 6, blur: 14 }, T);
  const guides = createLayer(env, W, H);
  { const g = guides.ctx; g.strokeStyle = rgbaOf(T.color.guide, 0.5); g.lineWidth = 1.5;
    if (R.mode === 'orbits') { const p = { x: 0, y: 0 }; for (let k = 0; k < N; k++) { g.beginPath(); for (let s = 0; s <= 160; s++) { pathPoint(R.cx, R.cy, R.radius[k], R.sides, s / 160, p); s ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke(); }
      g.setLineDash([6, 8]); g.beginPath(); g.moveTo(R.cx, R.cy); g.lineTo(R.cx, R.cy - R.radius[N - 1] - 40); g.stroke(); g.setLineDash([]); }
    if (R.mode === 'lid') for (let k = 0; k < N; k++) { const [x0, y0] = lidPoint(R, k, 0), [x1, y1] = lidPoint(R, k, 1); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    if (R.mode === 'close') { g.setLineDash([4, 8]); g.beginPath(); g.arc(R.cx, R.cy, R.armA + R.armB, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); } }
  bakeStatic(bg, art, guides);
  const pal = paletteFor(T, P.palette, 'spectrum'), off = (Math.round(+P.seed) % 12) / 12;
  const cols = Array.from({ length: N }, (_, k) => samplePalette(pal, (off + k / N) % 1, true));
  const kinds: ShapeKind[] = P.objects === 'mixed' ? SHAPE_KINDS : [String(P.objects) as ShapeKind];
  const sprites: Sprite[] = cols.map((c, k) => makeShapeSprite(env, c, R.objR, kinds[k % kinds.length], T, 1.6));
  const glows: Sprite[] = cols.map(c => makeGlowSprite(env, c, R.objR * 3, { core: 0.2 }, T));
  const accent = T.color.accent;
  const lineCol = `rgba(${rgbStr(T.color.highlight)},0.85)`;
  // close mode: the trace accumulates in a layer (and fades out during the loop back)
  const trace: Layer | null = R.mode === 'close' ? createLayer(env, W, H) : null;
  const penP = { x: 0, y: 0, jx: 0, jy: 0 }, tmp = { x: 0, y: 0 };

  let st = { frame: 0, lastHit: new Array(N).fill(-9) as number[], lineAt: -9, revealAt: -9, finalAt: -9, milestone: -1, milestoneAt: -9, hits: 0, kPrev: 0 };

  function step() {
    const f = ++st.frame, t0 = (f - 1) / fps, t1 = f / fps;
    eventsBetween(R, t0, t1, (type, k, x, y) => {
      switch (type) {
        case 'pass': st.lastHit[k] = t1; juice.burst(x, y, 2, { speed: 120, u: k / N, life: 0.3, size: 0.5 }); break;
        case 'lid': st.lastHit[k] = t1; st.hits++; juice.pop('counter', 0.18); juice.burst(x, y, 3, { speed: 200, u: k / N, life: 0.35, size: 0.6 }); break;
        case 'line': st.lineAt = t1; juice.flash(0.25); juice.pop('counter', 0.8); break;
        case 'newline': juice.pop('counter', 0.6); juice.burst(x, y, 6, { speed: 220, u: k / N }); break;
        case 'cap': st.lastHit[k] = t1; break;
        case 'reveal': st.revealAt = t1; juice.flash(0.5); juice.shake(6); juice.pop('counter', 1.2); break;
        case 'milestone': st.milestone = k; st.milestoneAt = t1; juice.flash(0.35); juice.pop('counter', 1); break;
        case 'final': st.finalAt = t1; juice.flash(0.6); juice.shake(R.mode === 'lid' ? 14 : 6); juice.pop('counter', 1.4);
          if (R.mode === 'orbits' || R.mode === 'lid') for (let q = 0; q < N; q++) { const p = posOf(q, t1); juice.burst(p[0], p[1], 6, { speed: 380, u: q / N }); }
          break;
      }
    });
    if (trace) {
      if (t1 <= R.tEnd + 1e-9) {
        // draw the new piece of the curve (sub-stepped so fast turns stay smooth)
        const k0 = st.kPrev, k1 = turnsAt(R, t1), g = trace.ctx;
        const steps = Math.min(400, Math.max(2, Math.ceil(((k1 - k0) * 2 * Math.PI * (R.armA + R.armB * R.ratio.value)) / 5)));
        g.globalCompositeOperation = T.blend; g.lineWidth = 2.2 * T.trail.width; g.lineCap = 'round';
        const c = samplePalette(pal, (k1 / Math.max(1, R.kEnd)) % 1, true);
        g.strokeStyle = `rgba(${c.map(Math.round).join(',')},${0.55 * T.trail.alpha})`;
        g.beginPath(); pen(2 * Math.PI * k0, R.armA, R.armB, R.ratio.value, penP); g.moveTo(R.cx + penP.x, R.cy + penP.y);
        for (let s = 1; s <= steps; s++) { pen(2 * Math.PI * (k0 + ((k1 - k0) * s) / steps), R.armA, R.armB, R.ratio.value, penP); g.lineTo(R.cx + penP.x, R.cy + penP.y); }
        g.stroke(); g.globalCompositeOperation = 'source-over';
        st.kPrev = k1;
      } else if (f >= frames - 1) trace.ctx.clearRect(0, 0, W, H);
      else fadeLayer(trace, 0.9);
    }
    juice.update(1 / fps);
  }

  /** position of object k at time t (orbits / lid / slider) */
  function posOf(k: number, t: number): [number, number] {
    if (R.mode === 'orbits') {
      const U = t <= R.tEnd ? Uof(R, t) : 1;
      pathPoint(R.cx, R.cy, R.radius[k], R.sides, R.sign[k] * R.laps[k] * U, tmp); return [tmp.x, tmp.y];
    }
    if (R.mode === 'lid') return lidPoint(R, k, lidH(R, k, t, String(P.motion)));
    const s = R.Rs * slide(t, R.omega, R.m, R.phi[k]);
    return [R.cx + s * R.cphi[k], R.cy + s * R.sphi[k]];
  }

  /** close mode: slow-arm turns shown at time t (during the loop back the arms rewind to the start) */
  function turnsShown(t: number) {
    const back = t > R.tEnd ? ease.inOutSine(clamp((t - R.tEnd - R.hold * 0.3) / (R.hold * 0.6), 0, 1)) : 0;
    return turnsAt(R, Math.min(t, R.tEnd)) * (1 - back);
  }

  function drawObjects(ctx: Ctx, t: number, alphaOf: (k: number) => number) {
    // short motion trails: the same pure function sampled slightly in the past
    ctx.globalCompositeOperation = T.blend; ctx.lineCap = 'round';
    for (let k = 0; k < N; k++) {
      const a = alphaOf(k); if (a <= 0) continue;
      const c = cols[k].map(Math.round).join(',');
      ctx.lineWidth = R.objR * 0.9 * T.trail.width; let [px, py] = posOf(k, t);
      for (let s = 1; s <= 8; s++) { const [x, y] = posOf(k, Math.max(0, t - s * 0.022)); ctx.strokeStyle = `rgba(${c},${0.32 * T.trail.alpha * a * (1 - s / 9)})`; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); px = x; py = y; }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < N; k++) {
      const a = alphaOf(k); if (a <= 0) continue;
      const [x, y] = posOf(k, t), age = t - st.lastHit[k];
      if (age >= 0 && age < 0.35) { ctx.globalCompositeOperation = T.juice.blend; drawSprite(ctx, glows[k], x, y, (1 - age / 0.35) * a); ctx.globalCompositeOperation = 'source-over'; }
      drawSprite(ctx, sprites[k], x, y, a, age >= 0 && age < 0.2 ? 1 + 0.35 * (1 - age / 0.2) : 1);
    }
  }

  function draw(ctx: Ctx) {
    const f = st.frame, t = f / fps;
    ctx.globalCompositeOperation = 'source-over'; drawLayer(ctx, bg);
    juice.beginWorld(ctx);
    let counter: { text: string; color: string }[];
    const ended = st.finalAt >= 0 && t < frames / fps - R.hold * 0.25;
    if (R.mode === 'orbits') {
      // the connecting line through every object, from the centre outward
      ctx.strokeStyle = lineCol; ctx.lineWidth = 2.5 * T.line.width; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(R.cx, R.cy); for (let k = 0; k < N; k++) { const [x, y] = posOf(k, t); ctx.lineTo(x, y); } ctx.stroke();
      const lineAge = t - st.lineAt;
      if (lineAge >= 0 && lineAge < 1.2) { ctx.font = fontOf(T, 44); ctx.fillStyle = rgbaOf(accent, 1 - lineAge / 1.2); ctx.textAlign = 'center'; ctx.fillText('a straight line… but not yet', W / 2, 1560); ctx.textAlign = 'left'; }
      drawObjects(ctx, t, () => 1);
      let inLine = 0; const U = t <= R.tEnd ? Uof(R, t) : 1;
      for (let k = 0; k < N; k++) { const fr = R.laps[k] * U; if (Math.abs(fr - Math.round(fr)) < 0.012) inLine++; }
      counter = [{ text: labelOf(P, R), color: T.color.text }, { text: `${inLine} / ${N}`, color: accent }];
    } else if (R.mode === 'lid') {
      // the lid glows where it was just hit
      for (let k = 0; k < N; k++) { const age = t - st.lastHit[k]; if (age >= 0 && age < 0.6) { const [x, y] = lidPoint(R, k, 1); drawRipple(ctx, x, y, age, { r0: R.objR, r1: R.objR * 3.5, dur: 0.6, color: cols[k].map(Math.round).join(',') }, T); } }
      if (R.columns) { const fa = st.finalAt >= 0 ? clamp(1 - (t - st.finalAt) / 1, 0, 1) : 0; ctx.fillStyle = rgbaOf(accent, 0.35 + 0.65 * fa); ctx.fillRect(R.colX[0] - 60, R.lidY - 16, R.colX[N - 1] - R.colX[0] + 120, 10); }
      drawObjects(ctx, t, () => 1);
      counter = [{ text: labelOf(P, R), color: T.color.text }, { text: (t > R.tEnd + R.hold * 0.7 ? 0 : st.hits).toLocaleString('en-US'), color: accent }];
    } else if (R.mode === 'slider') {
      const fadeOut = clamp((t - (R.tEnd + R.hold * 0.35)) / (R.hold * 0.5), 0, 1);
      const lineA = (j: number) => (j === 0 ? 1 : t < R.lineT[j] ? 0 : clamp((t - R.lineT[j]) / 0.3, 0, 1) * (1 - fadeOut));
      ctx.lineCap = 'round';
      for (let j = 0; j < N; j++) {
        const a = lineA(j); if (a <= 0) continue;
        const L = R.Rs * (j === 0 ? 1 : ease.outCubic(clamp((t - R.lineT[j]) / 0.3, 0, 1)));
        const c = cols[j].map(Math.round).join(','), dx = Math.cos(R.phi[j]) * L, dy = Math.sin(R.phi[j]) * L;
        ctx.strokeStyle = `rgba(${c},${0.55 * a})`; ctx.lineWidth = 2.5 * T.line.width; ctx.beginPath(); ctx.moveTo(R.cx - dx, R.cy - dy); ctx.lineTo(R.cx + dx, R.cy + dy); ctx.stroke();
        ctx.fillStyle = `rgba(${c},${a})`; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(R.cx + s * dx, R.cy + s * dy, 5, 0, Math.PI * 2); ctx.fill(); }
      }
      // the hidden curve, revealed once every line is in
      if (st.revealAt >= 0) {
        const a = clamp((t - st.revealAt) / 0.8, 0, 1) * (1 - fadeOut);
        if (a > 0) {
          ctx.strokeStyle = rgbaOf(accent, 0.9 * a); ctx.lineWidth = 4 * T.line.width; ctx.beginPath();
          for (let s = 0; s <= 360; s++) { const ph = (s / 360) * Math.PI * (R.m === 0 ? 2 : 1) + R.phi[0], r = R.Rs * slide(t, R.omega, R.m, ph); const x = R.cx + r * Math.cos(ph), y = R.cy + r * Math.sin(ph); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke();
        }
      }
      drawObjects(ctx, t, lineA);
      let shown = 0; for (let j = 0; j < N; j++) if (t >= R.lineT[j]) shown++;
      if (fadeOut > 0.5) shown = 1;
      counter = [{ text: labelOf(P, R), color: T.color.text }, { text: `${shown} / ${N}`, color: accent }];
      // segment bar
      const bw = Math.min(26, 720 / N), x0 = W / 2 - (bw * N) / 2;
      for (let j = 0; j < N; j++) { ctx.fillStyle = j < shown ? `rgba(${cols[j].map(Math.round).join(',')},0.95)` : rgbaOf(T.color.muted, 0.35); ctx.fillRect(x0 + j * bw + 2, 1690, bw - 4, 14); }
    } else {
      if (trace) { ctx.globalCompositeOperation = trace.op ?? (T.dark ? 'lighter' : 'source-over'); drawLayer(ctx, trace); ctx.globalCompositeOperation = 'source-over'; }
      // arms: during the loop back they rewind to the start angle
      const k = turnsShown(t);
      pen(2 * Math.PI * k, R.armA, R.armB, R.ratio.value, penP);
      ctx.strokeStyle = rgbaOf(T.color.text, 0.9); ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(R.cx, R.cy); ctx.lineTo(R.cx + penP.jx, R.cy + penP.jy); ctx.lineTo(R.cx + penP.x, R.cy + penP.y); ctx.stroke();
      for (const [x, y] of [[R.cx, R.cy], [R.cx + penP.jx, R.cy + penP.jy]]) { ctx.fillStyle = T.color.pivot; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); }
      drawSprite(ctx, glows[0], R.cx + penP.x, R.cy + penP.y, 1); drawSprite(ctx, sprites[0], R.cx + penP.x, R.cy + penP.y);
      // start marker
      const sx = R.cx, sy = R.cy - R.armA - R.armB;
      ctx.strokeStyle = rgbaOf(T.color.text, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.font = fontOf(T, 26); ctx.fillStyle = rgbaOf(T.color.text, 0.8); ctx.textAlign = 'center'; ctx.fillText('START', sx, sy - 22); ctx.textAlign = 'left';
      // magnifier near the start after each "almost" moment and at the end
      const lensA = st.milestoneAt >= 0 && t - st.milestoneAt < 2.2 ? clamp(Math.min((t - st.milestoneAt) / 0.25, (2.2 - (t - st.milestoneAt)) / 0.3), 0, 1)
        : st.finalAt >= 0 && t < R.tEnd + R.hold * 0.4 ? clamp((t - st.finalAt) / 0.25, 0, 1) : 0;
      if (lensA > 0 && trace) {
        const lx = W - 190, ly = 1440, lr = 150, zoom = 9, k2 = (trace.canvas.width as number) / W, sw = (2 * lr) / zoom;
        ctx.save(); ctx.globalAlpha = lensA; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fillStyle = T.color.bg[T.color.bg.length - 1]; ctx.fill(); ctx.clip();
        ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = T.dark ? 'lighter' : 'source-over';
        ctx.drawImage(trace.canvas as CanvasImageSource, (sx - sw / 2) * k2, (sy - sw / 2) * k2, sw * k2, sw * k2, lx - lr, ly - lr, 2 * lr, 2 * lr);
        ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = rgbaOf(T.color.text, 0.7); ctx.beginPath(); ctx.arc(lx, ly, 12 * zoom * 0.1 + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore(); ctx.globalAlpha = lensA;
        ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.stroke();
        const q = st.finalAt >= 0 ? R.ratio.milestones[R.ratio.milestones.length - 1] : R.ratio.milestones[Math.max(0, st.milestone)];
        const gap = R.ratio.rational && st.finalAt >= 0 ? 0 : gapAfter(q, R.armB, R.ratio.value);
        ctx.font = fontOf(T, 30); ctx.fillStyle = accent; ctx.textAlign = 'center';
        ctx.fillText(R.ratio.rational && st.finalAt >= 0 ? 'gap: 0 — closed' : `${q} turns · gap ${gap < 0.1 ? gap.toFixed(3) : gap.toFixed(1)} px`, lx - 60, ly - lr - 18);
        ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      }
      counter = [{ text: labelOf(P, R), color: T.color.text }, { text: k.toFixed(1), color: accent }];
      if (st.milestoneAt >= 0 && t - st.milestoneAt < 2.2 && st.finalAt < 0 && !R.ratio.rational) counter = [{ text: `${R.ratio.milestones[st.milestone]} turns… almost closed!`, color: accent }];
    }
    juice.drawParticles(ctx);
    juice.endWorld(ctx);
    juice.drawFlash(ctx, W, H);
    if (ended) counter = [{ text: answerOf(P, R), color: accent }];
    drawHeader(ctx, W, { title: titleOf(P), titleY: 255, counter, counterY: 1650, counterScale: juice.popScale('counter'), handle: String(P.handle), handleY: 1760, t }, T);
  }

  return {
    frames, seekable: false,
    get frame() { return st.frame; },
    renderFrame(ctx, i) { if (i < st.frame) throw new Error('sync-lines: render forward only'); while (st.frame < i) step(); draw(ctx); },
    snapshot: () => ({ st: structuredClone(st), juice: juice.snapshot(), trace: trace ? copyLayer(env, trace) : null }),
    restore(s: any) { st = structuredClone(s.st); juice.restore(s.juice); if (trace && s.trace) restoreLayer(trace, s.trace); },
    diagnostics: () => ({ mode: R.mode, objects: N, laps: R.mode === 'orbits' || R.mode === 'lid' ? R.laps : undefined, seed: +P.seed, alignedAt: +R.tEnd.toFixed(3),
      ...(R.mode === 'close' ? { ratio: R.ratio.name, turnsAtEnd: R.kEnd, gaps: R.ratio.milestones.map(q => +gapAfter(q, R.armB, R.ratio.value).toPrecision(3)) } : {}),
      ...(R.mode === 'slider' ? { lineEvery: +(R.reveal / N).toFixed(3), revealAt: +R.reveal.toFixed(3), period: +((2 * Math.PI) / R.omega).toFixed(3) } : {}) }),
    stateVector: () => {
      const t = st.frame / fps, v: number[] = [];
      if (R.mode === 'close') { const k = turnsShown(t); pen(2 * Math.PI * k, R.armA, R.armB, R.ratio.value, penP); v.push(penP.x, penP.y, k); }
      else for (let k = 0; k < N; k++) { const [x, y] = posOf(k, t); v.push(x, y); }
      return v;
    },
  };
}

export default { meta, schema, create, audio, hook } satisfies SceneModule;
