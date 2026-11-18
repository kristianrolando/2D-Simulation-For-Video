// Sync & close — the analytic part (pure functions of time; dmath only, no state).
//  orbits: object k goes m_k laps around its own track; all are back on the start line at the end.
//  lid:    object k bounces floor→lid with (m_k + ½) round trips; all hit the lid at the same instant.
//  slider: a new line every few seconds; each dot only slides along its line, together they draw a hidden curve.
//  close:  a two-arm pen (slow arm + arm turning `ratio` times faster) — closes after q turns if ratio = p/q.
import { dsin, dcos, mulberry32 } from '../../core/index.ts';

export type Mode = 'orbits' | 'lid' | 'slider' | 'close';
export const MODES: Mode[] = ['orbits', 'lid', 'slider', 'close'];
export type LapRule = 'consecutive' | 'odd' | 'primes' | 'seeded';
export const LAP_RULES: LapRule[] = ['consecutive', 'odd', 'primes', 'seeded'];
export type Hidden = 'circle' | 'flower4' | 'flower3' | 'pulse';
export const HIDDEN: Hidden[] = ['circle', 'flower4', 'flower3', 'pulse'];
export const RATIOS = ['pi', 'sqrt2', 'golden', 'e', '7/3', '5/2', '8/5', 'seeded'] as const;
export type RatioName = (typeof RATIOS)[number];

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173];

/** laps per object, by rule; 'seeded' = distinct values drawn with the seed, in a seeded order */
export function lapsFor(rule: LapRule, n: number, base: number, seed: number): number[] {
  base = Math.max(1, Math.round(base));
  switch (rule) {
    case 'odd': return Array.from({ length: n }, (_, k) => 2 * (base + k) - 1);
    case 'primes': { const i0 = Math.max(0, PRIMES.findIndex(p => p >= base)); return Array.from({ length: n }, (_, k) => PRIMES[Math.min(PRIMES.length - 1, i0 + k)]); }
    case 'seeded': {
      const rnd = mulberry32(seed * 7919 + 13), pool: number[] = [];
      for (let v = base; pool.length < n; v++) if (rnd() < 0.6) pool.push(v);
      // shuffle (Fisher–Yates, seeded): neighbouring tracks no longer have neighbouring speeds
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      return pool;
    }
    default: return Array.from({ length: n }, (_, k) => base + k);
  }
}

/** cycle progress with slow ends: U(0)=0, U(1)=1, speed 0 at both ends when slow = 1 */
export function cycle(u: number, slow: number) {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x - (slow * dsin(2 * Math.PI * x)) / (2 * Math.PI);
}

/** lid height profile in [0,1] for a half-trip position x in [0,1] (0 floor, 1 lid) */
export function lift(x: number, motion: string) {
  if (motion === 'gravity') return x * 1.8 - 0.8 * x * x;          // decelerates on the way up, still moving at the lid
  if (motion === 'piston') return 0.5 - 0.5 * dcos(Math.PI * x);    // eases in and out at both ends
  return x;                                                          // constant speed
}
/** lid mode: height of object with m laps at cycle position U (round trips = m + ½) */
export function lidHeight(U: number, m: number, motion: string) {
  const q = U * (m + 0.5), f = q - Math.floor(q), x = f < 0.5 ? 2 * f : 2 - 2 * f;
  return lift(x, motion);
}

export interface Ratio { value: number; name: string; label: string; rational: boolean; p: number; q: number; milestones: number[] }
/** pen ratio and the turn counts at which it comes back close to the start (continued-fraction denominators) */
export function ratioFor(name: RatioName, seed: number): Ratio {
  switch (name) {
    case 'pi': return { value: Math.PI, name: 'π', label: 'π is irrational', rational: false, p: 0, q: 0, milestones: [7, 113] };
    case 'sqrt2': return { value: Math.SQRT2, name: '√2', label: '√2 is irrational', rational: false, p: 0, q: 0, milestones: [5, 12, 29, 70] };
    case 'golden': return { value: (1 + Math.sqrt(5)) / 2, name: 'φ', label: 'the golden ratio is irrational', rational: false, p: 0, q: 0, milestones: [8, 21, 55] };
    case 'e': return { value: Math.E, name: 'e', label: 'e is irrational', rational: false, p: 0, q: 0, milestones: [7, 32, 71] };
    case 'seeded': {
      const rnd = mulberry32(seed * 104729 + 7); let p = 0, q = 0;
      do { q = 5 + Math.floor(rnd() * 12); p = q + 1 + Math.floor(rnd() * (2 * q)); } while (gcd(p, q) !== 1);
      return { value: p / q, name: `${p}/${q}`, label: `${p}/${q} is a fraction`, rational: true, p, q, milestones: [q] };
    }
    default: { const [p, q] = name.split('/').map(Number); return { value: p / q, name, label: `${name} is a fraction`, rational: true, p, q, milestones: [q] }; }
  }
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

/** pen position for slow-arm angle th: a·e^{iθ} + b·e^{iρθ}, both arms starting straight up */
export function pen(th: number, a: number, b: number, rho: number, out: { x: number; y: number; jx: number; jy: number }) {
  const a1 = th - Math.PI / 2, a2 = rho * th - Math.PI / 2;
  out.jx = a * dcos(a1); out.jy = a * dsin(a1);
  out.x = out.jx + b * dcos(a2); out.y = out.jy + b * dsin(a2);
  return out;
}
/** distance between the pen after q full turns and its start */
export function gapAfter(q: number, b: number, rho: number) { return 2 * b * Math.abs(dsin(Math.PI * rho * q)); }

/** slider: signed position of the dot on line j (angle φ_j) at time t; m = 1 circle, 2/3 flowers, 0 pulse */
export const HIDDEN_M: Record<Hidden, number> = { circle: 1, flower4: 2, flower3: 3, pulse: 0 };
export function slide(t: number, omega: number, m: number, phi: number) { return dcos(omega * t - m * phi); }
