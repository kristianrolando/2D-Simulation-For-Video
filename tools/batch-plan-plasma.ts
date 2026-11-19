// Batch plan for the second channel, Plasma Pendulum: one partner for every Photon Lab batch video, with the Main-2 look, a different
// parameter set (same concept, same scene), its own on-screen title and handle, in another order. Writes data/batch-plasma/plan.json.
// It renders NOTHING and never touches data/batch/ (Photon Lab's plan and state).
//   node tools/batch-plan-plasma.ts             writes the plan and prints a summary
//   node tools/batch-plan-plasma.ts --check     prints the summary only
//   node tools/batch-plan-plasma.ts --verify    also runs the simulations of the hammer-smash videos and checks the ending (slow, ~1 min)
// Deterministic: the same files in presets/, style-presets/ and this file give the same plan, in the same order.
// Run the plan:  node tools/batch-run.ts --dir data/batch-plasma --limit 10   (see "Plasma Pendulum batch" in the README)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneById } from '../packages/scenes/index.ts';
import { validate } from '../packages/core/schema.ts';
import { sanitizeStylePreset, serializeStylePreset } from '../packages/theme/index.ts';
import { hash32, rng } from '../packages/publish/copywriter.ts';
import { buildPlan, type PlanItem } from './batch-plan.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLASMA_DIR = path.join(ROOT, 'data/batch-plasma');
export const PLASMA_PLAN_FILE = path.join(PLASMA_DIR, 'plan.json');
export const PLASMA_HANDLE = '@PlasmaPendulum';
const PRESET_ID = 'main-2';

export interface PlasmaItem extends PlanItem { pairOf: string }

function loadMain2(): { style: string; value: string } {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-presets', PRESET_ID + '.json'), 'utf8'));
  const { preset, warnings } = sanitizeStylePreset(raw);
  if (!preset) throw new Error('Main-2 is not usable: ' + warnings.join('; '));
  return { style: String(raw.basedOn ?? 'classic'), value: serializeStylePreset(preset) };
}

// ---------------- what makes two videos "the same video" ----------------
/** keys that do not change what the video shows (texts, look); everything else is part of the signature */
const NOT_VISUAL = new Set(['title', 'answer', 'handle', 'stylePreset', 'bgSettings', 'style']);
export function signature(sceneId: string, params: Record<string, unknown>): string {
  const scene = sceneById(sceneId); if (!scene) throw new Error('unknown scene ' + sceneId);
  const full = validate(scene.schema, params).params as Record<string, unknown>;
  return sceneId + JSON.stringify(Object.keys(full).filter(k => !NOT_VISUAL.has(k)).sort().map(k => [k, full[k]]));
}

// ---------------- parameter variation ----------------
type R = () => number;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => { const d = (String(step).split('.')[1] ?? '').length; return +(Math.round(v / step) * step).toFixed(d); };
/** base × (1 ± frac), on the schema's step, inside its range */
const jit = (r: R, base: number, frac: number, step: number, lo: number, hi: number) => snap(clampTo(base * (1 + (r() * 2 - 1) * frac), lo, hi), step);
const pick = <T,>(r: R, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
/** an integer near `base` that is not `base` (so the video really changes), inside [lo, hi] */
function near(r: R, base: number, lo: number, hi: number, spread: number): number {
  const opts: number[] = []; for (let d = -spread; d <= spread; d++) if (d !== 0 && base + d >= lo && base + d <= hi) opts.push(base + d);
  return opts.length ? pick(r, opts) : base;
}
const TIMING: Record<string, string[]> = { // keys that are moments inside the video: they move with the duration, so the ending keeps its place
  'galton-board': ['finalAt'], 'focal-reflection': ['finalAt'], 'rosette-orbit': ['closeAt'], 'pendulum-wave': ['alignAt'], 'resonance-orbits': ['closeAt'], billiard: ['endAt'],
};
const STEPS: Record<string, number> = { finalAt: 0.01, closeAt: 0.01, alignAt: 0.01, endAt: 0.1 };

/** the overrides that make the Plasma partner of a Photon video (same scene, same concept) */
function vary(sceneId: string, B: Record<string, any>, r: R): Record<string, unknown> {
  const o: Record<string, unknown> = { palette: 'theme' };    // the colours come from Main-2, never from a Photon-only palette
  // a slightly different length; the moments inside the video move with it
  const f = 0.93 + r() * 0.14, dur = snap(clampTo(B.duration * f, 5, 90), 0.1); o.duration = dur;
  for (const k of TIMING[sceneId] ?? []) o[k] = snap(clampTo(B[k] * (dur / B.duration), 3, Math.min(88, dur - 0.5)), STEPS[k]);
  switch (sceneId) {
    case 'sync-lines': {
      const mode = String(B.mode);
      o.slowEnds = jit(r, B.slowEnds, 0.12, 0.05, 0, 1); o.hold = jit(r, B.hold, 0.25, 0.1, 1.5, 8);
      if (mode === 'orbits' || mode === 'lid') { o.count = near(r, B.count, 6, 20, 4); o.lapBase = near(r, B.lapBase, 1, 6, 2); if (B.laps === 'seeded') o.seed = 1 + Math.floor(r() * 9000); }
      if (mode === 'slider') { o.count = near(r, B.count, 14, 32, 8); o.period = jit(r, B.period, 0.25, 0.1, 1.6, 4); o.seed = 1 + Math.floor(r() * 9000); }
      if (mode === 'close' && B.ratio === 'seeded') o.seed = 1 + Math.floor(r() * 9000);
      break;
    }
    case 'hammer-smash': {
      o.seed = 1 + Math.floor(r() * 9000);
      o.capacity = snap(clampTo(B.capacity * (0.75 + r() * 0.6), 300, 2000), 10);
      o.ballScale = jit(r, B.ballScale, 0.15, 0.05, 0.75, 1.3); o.speed = jit(r, B.speed, 0.15, 10, 250, 560);
      o.interval = jit(r, B.interval, 0.15, 0.1, 3, 7);
      // survive: a bigger crowd with a stronger lucky-bounce bonus and a lower cap, so the crowd really takes off (the Photon defaults often stall)
      if (B.rule === 'survive') { o.startBalls = 6 + Math.floor(r() * 5); o.bonus = snap(0.5 + r() * 0.15, 0.05); o.capacity = snap(500 + r() * 300, 10); }
      // a ring leaves the hammers little to hit: more balls to begin with and a shorter interval keep it lively
      else if (B.container === 'ring' && B.rule === 'split') { o.startBalls = 6 + Math.floor(r() * 4); o.interval = snap(2.8 + r(), 0.1); o.capacity = snap(600 + r() * 300, 10); }
      else if (B.rule === 'split' && r() < 0.4) o.startBalls = near(r, B.startBalls, 1, 6, 2);
      if (B.rule === 'box') o.boxSize = jit(r, B.boxSize, 0.2, 0.05, 0.35, 0.7);
      if (B.gravity > 0) o.gravity = snap(clampTo(B.gravity * (0.7 + r() * 0.6), 300, 2000), 50);
      break;
    }
    case 'focal-reflection':
      o.ballRadius = jit(r, B.ballRadius, 0.25, 0.5, 8, 16); o.trailHalfLife = jit(r, B.trailHalfLife, 0.3, 0.1, 0.9, 2.2); o.speedUp = jit(r, B.speedUp, 0.1, 0.01, 1.1, 1.8);
      if (['ellipse', 'peanut'].includes(String(B.layout))) { o.ellipseRx = jit(r, B.ellipseRx, 0.07, 1, 300, 400); o.ellipseRy = jit(r, B.ellipseRy, 0.06, 1, 460, 560); }
      if (r() < 0.5) o.sequence = pick(r, ['gentle', 'fibonacci']);
      break;
    case 'billiard':
      o.start = jit(r, B.start, 0.4, 0.01, 0.1, 0.9); o.speedUp = jit(r, B.speedUp, 0.15, 0.1, 2.2, 4);
      break;
    case 'galton-board':
      o.seed = 1 + Math.floor(r() * 9000); o.balls = snap(clampTo(B.balls * (0.8 + r() * 0.4), 300, 1200), 10); o.rows = near(r, B.rows, 10, 15, 2); o.speedUp = jit(r, B.speedUp, 0.15, 0.1, 2.2, 4);
      if (Math.abs(B.p - 0.5) > 0.01) o.p = pick(r, [0.2, 0.25, 0.7, 0.75]); // a tilted board stays tilted, on the other side or by another amount
      break;
    case 'gravity-bounce':
      o.balls = near(r, B.balls, 16, 72, 6); o.offsetExp = pick(r, [-8, -9, -10, -11, -12].filter(e => e !== B.offsetExp)); o.gravity = snap(clampTo(B.gravity * (0.8 + r() * 0.4), 1200, 2600), 10);
      o.startX = near(r, B.startX, 60, 220, 40); o.ballR = jit(r, B.ballR, 0.2, 0.5, 8, 18); o.trailHalfLife = jit(r, B.trailHalfLife, 0.3, 0.05, 0.25, 0.9);
      break;
    case 'harmonograph': {
      const pairs: [number, number][] = [[4, 3], [5, 3], [5, 2], [7, 4], [3, 1], [4, 1], [7, 5], [5, 4], [3, 2]].filter(([a, b]) => !(a === B.ratioX && b === B.ratioY)) as [number, number][];
      const [a, b] = pick(r, pairs.filter(p => p[0] !== 5 || p[1] !== 4 || B.ratioX !== 5)); o.ratioX = a; o.ratioY = b;
      o.phase = jit(r, B.phase || 1, 0.5, 0.01, 0.2, 3); o.detune = jit(r, B.detune, 0.3, 0.0005, 0.002, 0.008); o.size = jit(r, B.size, 0.08, 1, 360, 470);
      o.cycles = jit(r, B.cycles, 0.15, 1, 20, 40);
      break;
    }
    case 'resonance-orbits': {
      const pairs: [number, number][] = [[11, 7], [7, 4], [9, 5], [13, 8], [7, 3], [8, 5], [9, 4], [11, 6]];
      const ok = pairs.filter(([i, ou]) => !(i === B.inner && ou === B.outer));
      const [i, ou] = pick(r, ok); o.inner = i; o.outer = ou;
      o.lines = snap(clampTo(B.lines * (0.8 + r() * 0.4), 300, 900), 10); o.rInner = jit(r, B.rInner, 0.08, 1, 230, 310); o.speedUp = jit(r, B.speedUp, 0.1, 0.1, 1.8, 3);
      break;
    }
    case 'rosette-orbit':
      o.precessDeg = pick(r, [8, 9, 11, 12, 14].filter(d => d !== B.precessDeg)); o.rApo = jit(r, B.rApo, 0.06, 1, 410, 470); o.rPeri = jit(r, B.rPeri, 0.2, 1, 60, 100);
      o.periodYears = near(r, B.periodYears, 3000, 9000, 2500) + Math.floor(r() * 400);
      break;
    case 'pendulum-wave':
      o.count = near(r, B.count, 12, 26, 5); o.nMax = near(r, B.nMax, 36, 60, 8); o.growth = jit(r, B.growth, 0.2, 0.005, 0.04, 0.09); o.blur = jit(r, B.blur, 0.3, 0.01, 0.15, 0.5);
      break;
    default: throw new Error('no variation rule for ' + sceneId);
  }
  return o;
}

// ---------------- on-screen texts (English, US spelling, nothing the parameters do not say) ----------------
const RATIO_WORD: Record<string, string> = { pi: 'π', sqrt2: '√2', golden: 'φ', e: 'e', '7/3': '7/3', '5/2': '5/2', '8/5': '8/5' };
export const POOL = {
  'hammer:split': ['Every hit makes {k} balls\nHow fast does it fill up?', 'Smash one, get {k} more\nBalls or walls: who wins?', '{k} new balls per smash\nCan the {shape} take it?', 'Hit. Split. Repeat.\nWhen does it burst?', 'One smash = {k} balls\nHow full can the {shape} get?', 'Crush a ball, get {k}\nWhere does it end?'],
  'hammer:box': ['Balls inside the box breed\nHow many can it hold?', 'The hammers close a box\nTrapped balls start multiplying', 'Each bounce inside = a new ball\nHow long do the walls last?', 'Build a box, trap the balls\nWatch the count explode', 'A closed box and bouncing balls\nWho runs out of room first?', 'Every box bounce adds one\nWhen does it all burst?'],
  'hammer:survive': ['Crush them and they vanish\nCan the balls keep up?', 'Only lucky bounces make more\nCan they beat the hammer?', 'Balls vs hammer\nStarting with {n0}: who wins?', 'Every crush is final\nCan the crowd survive?', 'The hammer never stops\nDo the balls survive?', 'Win a bounce, grow the crowd\nLose one, and you are gone'],
  'sync:orbits': ['All {n} leave together\nWhen do they meet again?', '{n} runners on one track\nHow long until they line up?', 'Different speeds, one start line\nCan {n} dots ever regroup?', 'Every dot laps at its own rate\nWatch for the perfect line', 'A lineup that breaks apart\nWill it ever re-form?', 'Start in a line, then spread out\nHow long to line up again?'],
  'sync:lid': ['One lid, {n} beats\nWill they all hit together?', 'Each ball keeps its own beat\nWhen do they hit as one?', '{n} balls under a lid\nOne perfect hit: when?', 'Watch the lid: {n} rhythms clash\nDo they ever sync?', 'Out of sync, then together?\nAll {n} hit the lid at once', 'Different tempos, one target\nCan they all meet it together?'],
  'sync:slider': ['Dots sliding on straight paths\nWhat curve appears?', 'Only straight lines, one by one\nWhat shape do they hide?', 'One more line at a time\nWhat is taking shape?', 'Lines only, no curves drawn\nWhat shape shows up?', 'Dots move only in straight lines\nWhat do they trace together?'],
  'sync:close': ['A pen on two spinning arms\nDoes the path come back?', 'Two spinning arms, one pen\nWhere does it end up?', 'Will this pen find its way home?\nIt all depends on the speeds'],
  'sync:close:ratio': ['Fast arm: {r}× the slow one\nWill the loop ever close?', 'Speed ratio of the arms: {r}\nDoes the path come back?', 'Will this pen come home?\nIt all depends on {r}'],
} as const;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

/** title and answer for the on-screen text of one Plasma video. A scene without a rule here keeps the scene's own (true) answer. */
export function texts(sceneId: string, P: Record<string, any>, r: R): { title: string; answer?: string } {
  const one = <T,>(list: readonly T[]) => pick(r, list);
  switch (sceneId) {
    case 'hammer-smash': return { title: fill(one(POOL[`hammer:${P.rule}` as 'hammer:split']), { k: String(P.splitInto), shape: String(P.container), n0: String(P.startBalls) }) };
    case 'sync-lines': {
      const mode = String(P.mode), v = { n: String(Math.round(P.count)) };
      if (mode === 'close') { const w = RATIO_WORD[String(P.ratio)]; return { title: w ? fill(one(POOL['sync:close:ratio']), { r: w }) : one(POOL['sync:close']) }; }
      return { title: fill(one(POOL[`sync:${mode}` as 'sync:orbits']), v) };
    }
    case 'focal-reflection': return ({
      ellipse: { title: 'Fired from one focus:\nwhere do they all go?', answer: 'All {n} meet at the other focus!' },
      peanut: { title: 'Two ellipses, one shared focus:\nwhere do they cross?', answer: 'All {n} cross at the shared focus!' },
      parabola: { title: 'Dropped from different spots:\nwill they meet at the focus?', answer: 'All {n} reach the focus together!' },
      corner: { title: 'A corner mirror sends them back:\ndoes every ball return?', answer: 'All {n} bounced straight back!' },
      cassegrain: { title: 'A mirror above a mirror:\nwhere does everything go?', answer: 'All {n} pass through the gap!' },
      gregorian: { title: 'Two mirrors, one crossing:\ndo the paths meet twice?', answer: 'All {n} cross at F1, then meet at F2!' },
    } as Record<string, { title: string; answer: string }>)[String(P.layout)];
    case 'billiard': return { title: ({ circle: 'A ball bounces in a circle:\ndoes the path ever repeat?', square: 'A ball in a square box:\ndoes it ever retrace its path?', triangle: 'One shot inside a triangle:\nwhen does the loop close?' } as Record<string, string>)[String(P.table)] };
    case 'galton-board': return Math.abs(P.p - 0.5) > 0.01 ? { title: 'Tilt the board:\nwhere does the pile go?', answer: 'A lopsided pile from {n} balls!' } : { title: 'Pure chance, no plan:\nwhat shape do the balls make?', answer: 'A bell curve from {n} random balls!' };
    case 'gravity-bounce': return { title: 'One tiny nudge at the start:\ndo they still agree?', answer: 'Totally different endings.' };
    case 'harmonograph': return { title: 'Two pendulums, one pen:\nwhat shape appears?', answer: 'Ratio {n}: the pattern keeps drifting.' };
    case 'resonance-orbits': return { title: 'Two orbits, one set of lines:\nwhat do they draw?', answer: 'A {n}-petal flower from two circles!' };
    case 'rosette-orbit': return { title: 'A slowly turning orbit:\nwill it ever close?' };
    case 'pendulum-wave': return { title: 'Pendulums of different lengths:\ndo they ever line up?' };
  }
  throw new Error('no texts for ' + sceneId);
}

// ---------------- the plan ----------------
export function buildPlasmaPlan(): PlasmaItem[] {
  const look = loadMain2();
  const photon = buildPlan();
  const taken = new Set(photon.map(i => signature(i.sceneId, i.params)));
  const out: PlasmaItem[] = [];
  for (const src of photon) {
    const scene = sceneById(src.sceneId)!;
    const B = validate(scene.schema, src.params).params as Record<string, any>;
    let item: PlasmaItem | null = null;
    for (let attempt = 0; attempt < 40 && !item; attempt++) {
      const r = rng(hash32(`plasma:${src.key}:${attempt}`));
      const over = vary(src.sceneId, B, r);
      const merged = { ...src.params, ...over };
      const { params: full, errors } = validate(scene.schema, merged);
      if (errors.length) continue;
      const t = texts(src.sceneId, full, r);
      const params = { ...merged, title: t.title, ...(t.answer ? { answer: t.answer } : {}), handle: PLASMA_HANDLE, style: look.style, bgSettings: '', stylePreset: look.value };
      const sig = signature(src.sceneId, params);
      if (taken.has(sig)) continue;
      taken.add(sig);
      item = { key: 'plasma:' + src.key, sceneId: src.sceneId, heavy: src.heavy, origin: src.origin, params, pairOf: src.key };
    }
    if (!item) throw new Error(`no distinct Plasma partner found for ${src.key}`);
    out.push(item);
  }
  // another order than Photon's: one of each scene first (so a small trial shows them all), then a seeded shuffle of the light videos with
  // the heavy ones (hammer-smash) spread out, never side by side
  const rr = rng(hash32('plasma:order'));
  const firsts: PlasmaItem[] = [];
  for (const sc of [...new Set(out.map(i => i.sceneId))].sort(() => 0)) { const i = out.find(x => x.sceneId === sc && !firsts.includes(x)); if (i) firsts.push(i); }
  const rest = out.filter(i => !firsts.includes(i)), shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const light = shuffle(rest.filter(i => !i.heavy)), heavy = shuffle(rest.filter(i => i.heavy)), ordered: PlasmaItem[] = [...firsts];
  const every = Math.max(1, Math.floor(light.length / Math.max(1, heavy.length)));
  let h = 0;
  light.forEach((it, i) => { ordered.push(it); if ((i + 1) % every === 0 && h < heavy.length) ordered.push(heavy[h++]); });
  while (h < heavy.length) ordered.push(heavy[h++]);
  return ordered;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const plan = buildPlasmaPlan(), photon = buildPlan();
  const by = (f: (i: PlasmaItem) => string) => { const m: Record<string, number> = {}; for (const i of plan) m[f(i)] = (m[f(i)] ?? 0) + 1; return m; };
  console.log('photon videos:', photon.length, '· plasma partners:', plan.length);
  console.log('by scene:', by(i => i.sceneId));
  console.log('heavy (hammer-smash):', plan.filter(i => i.heavy).length);
  const keys = new Set(plan.map(i => i.key)); if (keys.size !== plan.length) throw new Error('duplicate keys in the plan');
  const sigs = new Set(plan.map(i => signature(i.sceneId, i.params))); if (sigs.size !== plan.length) throw new Error('two Plasma videos are the same video');
  console.log('first 10 in order:', plan.slice(0, 10).map(i => i.sceneId).join(', '));
  if (process.argv.includes('--verify')) {
    const { HammerSim } = await import('../packages/scenes/hammer-smash/sim.ts');
    let bad = 0, n = 0;
    for (const i of plan.filter(x => x.sceneId === 'hammer-smash')) {
      const P = validate(sceneById('hammer-smash')!.schema, i.params).params as Record<string, any>;
      const frames = Math.round(P.duration * 60), end = Math.max(30, frames - 1 - Math.round(1.4 * 60) - Math.round(1.3 * 60));
      const s = new HammerSim({ rule: P.rule, container: P.container, hammers: +P.hammers, splitInto: +P.splitInto, capacity: +P.capacity, startBalls: +P.startBalls, ballScale: +P.ballScale, speed: +P.speed, gravity: +P.gravity, interval: +P.interval, speedUp: +P.speedUp, boxSize: +P.boxSize, bonus: +P.bonus, seed: +P.seed, fps: 60, endFrame: end } as any);
      s.ensure(end); n++;
      const ended = s.fullAt >= 0 || s.clearedAt >= 0;
      if (!ended) { bad++; console.log('  no ending (neither full nor cleared):', i.key, `rule ${P.rule} cap ${P.capacity} start ${P.startBalls} k ${P.splitInto}`); }
    }
    console.log(`hammer-smash simulations checked: ${n}, without an ending: ${bad}`);
  }
  if (!process.argv.includes('--check') && !process.argv.includes('--verify')) {
    fs.mkdirSync(PLASMA_DIR, { recursive: true });
    fs.writeFileSync(PLASMA_PLAN_FILE, JSON.stringify({ version: 1, styleDescription: 'classic + style preset Main-2 (Plasma Pendulum)', createdBy: 'tools/batch-plan-plasma.ts', count: plan.length, items: plan }, null, 1));
    console.log('written:', path.relative(ROOT, PLASMA_PLAN_FILE));
  }
}
