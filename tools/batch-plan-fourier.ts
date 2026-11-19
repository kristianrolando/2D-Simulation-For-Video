// Batch plan for the third channel, Fourier Loom: a third partner for every Photon Lab batch video, with the Main-3 look, parameters that differ
// from ALL 490 Photon + Plasma videos and from each other (same concept, same scene), its own on-screen title and handle @FourierLoom, in another order.
// Writes data/batch-fourier/plan.json. It renders NOTHING and never touches data/batch/ or data/batch-plasma/.
//   node tools/batch-plan-fourier.ts             writes the plan and prints a summary (per scene: possible vs target)
//   node tools/batch-plan-fourier.ts --check     prints the summary only
// Deterministic: the same files in presets/, style-presets/ and this file give the same plan, in the same order.
// The channel is run by the owner's friend and is NOT connected to the studio: the videos are only rendered, then handed over as files.
// Run the plan:  node tools/batch-run.ts --dir data/batch-fourier --limit 10
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneById } from '../packages/scenes/index.ts';
import { validate } from '../packages/core/schema.ts';
import { sanitizeStylePreset, serializeStylePreset } from '../packages/theme/index.ts';
import { hash32, rng } from '../packages/publish/copywriter.ts';
import { buildPlan, type PlanItem } from './batch-plan.ts';
import { buildPlasmaPlan, signature } from './batch-plan-plasma.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FOURIER_DIR = path.join(ROOT, 'data/batch-fourier');
export const FOURIER_PLAN_FILE = path.join(FOURIER_DIR, 'plan.json');
export const FOURIER_HANDLE = '@FourierLoom';
export const FOURIER_CHANNEL = 'Fourier Loom';
const PRESET_ID = 'main-3';
const ATTEMPTS = 300;

export interface FourierItem extends PlanItem { pairOf: string }

function loadMain3(): { style: string; value: string } {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-presets', PRESET_ID + '.json'), 'utf8'));
  const { preset, warnings } = sanitizeStylePreset(raw);
  if (!preset) throw new Error('Main-3 is not usable: ' + warnings.join('; '));
  return { style: String(raw.basedOn ?? 'classic'), value: serializeStylePreset(preset) };
}

// ---------------- parameter variation (same rules as the Plasma partner, other seeds, so the result differs) ----------------
type R = () => number;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => { const d = (String(step).split('.')[1] ?? '').length; return +(Math.round(v / step) * step).toFixed(d); };
const jit = (r: R, base: number, frac: number, step: number, lo: number, hi: number) => snap(clampTo(base * (1 + (r() * 2 - 1) * frac), lo, hi), step);
const pick = <T,>(r: R, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
function near(r: R, base: number, lo: number, hi: number, spread: number): number {
  const opts: number[] = []; for (let d = -spread; d <= spread; d++) if (d !== 0 && base + d >= lo && base + d <= hi) opts.push(base + d);
  return opts.length ? pick(r, opts) : base;
}
const TIMING: Record<string, string[]> = {
  'galton-board': ['finalAt'], 'focal-reflection': ['finalAt'], 'rosette-orbit': ['closeAt'], 'pendulum-wave': ['alignAt'], 'resonance-orbits': ['closeAt'], billiard: ['endAt'],
};
const STEPS: Record<string, number> = { finalAt: 0.01, closeAt: 0.01, alignAt: 0.01, endAt: 0.1 };

/** the overrides that make the Fourier Loom partner of a Photon video (same scene, same concept) */
function vary(sceneId: string, B: Record<string, any>, r: R): Record<string, unknown> {
  const o: Record<string, unknown> = { palette: 'theme' };    // the colours come from Main-3, never from a Photon-only palette
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

// ---------------- on-screen texts (English, US spelling, nothing the parameters do not say; none equal to a Photon or Plasma title) ----------------
const RATIO_WORD: Record<string, string> = { pi: 'π', sqrt2: '√2', golden: 'φ', e: 'e', '7/3': '7/3', '5/2': '5/2', '8/5': '8/5' };
export const FOURIER_POOL = {
  'hammer:split': ['{k} balls from every hit\nHow long till it overflows?', 'Each smash splits into {k}\nCan the {shape} hold them?', 'Hammer swings, {k} balls appear\nWho runs out of room?', 'Split after split after split\nHow big does the crowd get?', 'A hit turns one ball into {k}\nWhere does it stop?', 'Smash, split, repeat\nWhat gives out first?'],
  'hammer:box': ['Walls close in around the balls\nHow many fit inside?', 'Trapped balls keep multiplying\nWhen does the box give?', 'A box made by hammers\nCount the balls as they grow', 'Bounce inside, add a ball\nHow long can the box last?', 'Seal the balls in a box\nDoes the crowd win?', 'Hammers build the walls\nBalls inside multiply'],
  'hammer:survive': ['Crushed balls are gone for good\nWill the crowd last?', 'Start with {n0}, lose them all?\nOr grow a huge crowd?', 'Lucky bounce = one more ball\nUnlucky = gone', 'Can a crowd outlive a hammer?\nIt starts with {n0} balls', 'Hammer vs. {n0} little balls\nWho comes out ahead?', 'No lucky bounce, no ball\nHow long can they last?'],
  'sync:orbits': ['{n} dots, one start line\nWhen do they line up again?', 'Fast dots, slow dots, one track\nAll {n} home at the same time?', 'Everyone starts together\nWho is back first?', 'A perfect line, then chaos\nWill the line come back?', 'Spread out, then regroup?\nWatch all {n} dots', 'Same start, {n} different speeds\nWho laps whom?'],
  'sync:lid': ['{n} balls, each its own rhythm\nOne hit, all together?', 'Will the balls ever strike\nthe lid at the same moment?', 'Watch the lid: {n} beats\nWhen do they all agree?', 'Separate beats, one lid\nDo they ever coincide?', '{n} rhythms, one moment\nCan they meet?', 'Every ball taps in its own time\nWill they ever tap as one?'],
  'sync:slider': ['Straight lines, nothing curved\nSo why does a curve show up?', 'Every dot slides in a line\nWhat do they trace?', 'Lines add up to a curve\nCan you see it coming?', 'A shape built from lines\nWatch it appear', 'Dots on straight rails\nWhat is the shape?'],
  'sync:close': ['Two arms, one pen\nWill it draw a closed loop?', 'Round and round: does the pen\ncome back to the start?', 'Spinning arms trace a path\nWill it ever close?'],
  'sync:close:ratio': ['Arm speeds differ by {r}\nWill the loop close?', 'Ratio {r}: does it close?\nTwo arms, one pen', 'The speed ratio is {r}\nCan the pen come home?'],
} as const;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export function texts(sceneId: string, P: Record<string, any>, r: R): { title: string; answer?: string } {
  const one = <T,>(list: readonly T[]) => pick(r, list);
  switch (sceneId) {
    case 'hammer-smash': return { title: fill(one(FOURIER_POOL[`hammer:${P.rule}` as 'hammer:split']), { k: String(P.splitInto), shape: String(P.container), n0: String(P.startBalls) }) };
    case 'sync-lines': {
      const mode = String(P.mode), v = { n: String(Math.round(P.count)) };
      if (mode === 'close') { const w = RATIO_WORD[String(P.ratio)]; return { title: w ? fill(one(FOURIER_POOL['sync:close:ratio']), { r: w }) : one(FOURIER_POOL['sync:close']) }; }
      return { title: fill(one(FOURIER_POOL[`sync:${mode}` as 'sync:orbits']), v) };
    }
    case 'focal-reflection': return ({
      ellipse: { title: 'One focus, one launch:\nwhere does each ball end up?', answer: 'All {n} balls reach the other focus!' },
      peanut: { title: 'Two ellipses share a focus:\nwhere do the balls meet?', answer: 'All {n} balls meet at the shared focus!' },
      parabola: { title: 'Balls fall from all over:\ndo they reach the focus?', answer: 'All {n} balls hit the focus!' },
      corner: { title: 'A corner mirror in the way:\nwhere do the balls go?', answer: 'All {n} balls came straight back!' },
      cassegrain: { title: 'Two mirrors, one gap:\nwhere do the balls pass?', answer: 'All {n} balls pass through the gap!' },
      gregorian: { title: 'Two mirrors, two foci:\nhow often do paths meet?', answer: 'All {n} balls cross at F1, then meet at F2!' },
    } as Record<string, { title: string; answer: string }>)[String(P.layout)];
    case 'billiard': return { title: ({ circle: 'A ball in a round table:\nwill the path repeat?', square: 'A ball in a square table:\nwhen does it retrace itself?', triangle: 'One shot inside a triangle:\nwill the loop ever close?' } as Record<string, string>)[String(P.table)] };
    case 'galton-board': return Math.abs(P.p - 0.5) > 0.01 ? { title: 'A board tilted to one side:\nwhere do the balls pile up?', answer: 'A lopsided pile of {n} balls!' } : { title: 'Random balls falling one by one\nWhat shape do they form?', answer: 'The {n} balls form a bell curve!' };
    case 'gravity-bounce': return { title: 'A tiny nudge at the start:\nwill they stay together?', answer: 'They end up far apart.' };
    case 'harmonograph': return { title: 'Two pendulums guide one pen\nWhat shape does it draw?', answer: 'Ratio {n}: the pattern keeps shifting.' };
    case 'resonance-orbits': return { title: 'Lines between two orbits\nWhat do they add up to?', answer: 'A {n}-petal flower from two orbits!' };
    case 'rosette-orbit': return { title: 'An orbit that keeps turning\nWill it ever close up?' };
    case 'pendulum-wave': return { title: 'Pendulums, each a bit longer\nWill they line up again?' };
  }
  throw new Error('no texts for ' + sceneId);
}

// ---------------- the plan ----------------
/** items = the partners that could be made (up to one per Photon video); short = Photon videos for which no distinct partner exists */
export function buildFourierPlanFull(): { items: FourierItem[]; short: { key: string; sceneId: string }[] } {
  const look = loadMain3();
  const photon = buildPlan(), plasma = buildPlasmaPlan();
  const taken = new Set([...photon, ...plasma].map(i => signature(i.sceneId, i.params)));
  const out: FourierItem[] = [], short: { key: string; sceneId: string }[] = [];
  for (const src of photon) {
    const scene = sceneById(src.sceneId)!;
    const B = validate(scene.schema, src.params).params as Record<string, any>;
    let item: FourierItem | null = null;
    for (let attempt = 0; attempt < ATTEMPTS && !item; attempt++) {
      const r = rng(hash32(`fourier:${src.key}:${attempt}`));
      const over = vary(src.sceneId, B, r);
      const merged = { ...src.params, ...over };
      const { params: full, errors } = validate(scene.schema, merged);
      if (errors.length) continue;
      const t = texts(src.sceneId, full, r);
      const params = { ...merged, title: t.title, ...(t.answer ? { answer: t.answer } : {}), handle: FOURIER_HANDLE, style: look.style, bgSettings: '', stylePreset: look.value };
      const sig = signature(src.sceneId, params);
      if (taken.has(sig)) continue;
      taken.add(sig);
      item = { key: 'fourier:' + src.key, sceneId: src.sceneId, heavy: src.heavy, origin: src.origin, params, pairOf: src.key };
    }
    if (item) out.push(item); else short.push({ key: src.key, sceneId: src.sceneId });
  }
  // another order: one of each scene first, then a seeded shuffle of the light videos with the heavy ones (hammer-smash) spread out, never side by side
  const rr = rng(hash32('fourier:order'));
  const firsts: FourierItem[] = [];
  for (const sc of [...new Set(out.map(i => i.sceneId))]) { const i = out.find(x => x.sceneId === sc && !firsts.includes(x)); if (i) firsts.push(i); }
  const rest = out.filter(i => !firsts.includes(i)), shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const light = shuffle(rest.filter(i => !i.heavy)), heavy = shuffle(rest.filter(i => i.heavy)), ordered: FourierItem[] = [...firsts];
  const every = Math.max(1, Math.floor(light.length / Math.max(1, heavy.length)));
  let h = 0;
  light.forEach((it, i) => { ordered.push(it); if ((i + 1) % every === 0 && h < heavy.length) ordered.push(heavy[h++]); });
  while (h < heavy.length) ordered.push(heavy[h++]);
  return { items: ordered, short };
}
export const buildFourierPlan = (): FourierItem[] => buildFourierPlanFull().items;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { items: plan, short } = buildFourierPlanFull(), photon = buildPlan();
  const count = (list: { sceneId: string }[]) => { const m: Record<string, number> = {}; for (const i of list) m[i.sceneId] = (m[i.sceneId] ?? 0) + 1; return m; };
  const want = count(photon), got = count(plan);
  console.log('photon videos:', photon.length, '· fourier partners possible:', plan.length, '· short:', short.length);
  for (const s of Object.keys(want)) console.log(`  ${s.padEnd(18)} target ${String(want[s]).padStart(3)} · possible ${String(got[s] ?? 0).padStart(3)}`);
  console.log('heavy (hammer-smash):', plan.filter(i => i.heavy).length);
  const keys = new Set(plan.map(i => i.key)); if (keys.size !== plan.length) throw new Error('duplicate keys in the plan');
  const sigs = new Set(plan.map(i => signature(i.sceneId, i.params))); if (sigs.size !== plan.length) throw new Error('two Fourier videos are the same video');
  console.log('first 10 in order:', plan.slice(0, 10).map(i => i.sceneId).join(', '));
  if (!process.argv.includes('--check')) {
    fs.mkdirSync(FOURIER_DIR, { recursive: true });
    fs.writeFileSync(FOURIER_PLAN_FILE, JSON.stringify({ version: 1, styleDescription: 'classic + style preset Main-3 (Fourier Loom)', createdBy: 'tools/batch-plan-fourier.ts', count: plan.length, items: plan }, null, 1));
    console.log('written:', path.relative(ROOT, FOURIER_PLAN_FILE));
  }
}
