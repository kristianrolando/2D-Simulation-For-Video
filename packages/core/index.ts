// @sim/core — environment-agnostic, deterministic building blocks shared by every scene.
// Rule: simulation code (scenes/*/sim.ts) may only use these helpers and IEEE-exact operators
// (+ - * / Math.sqrt Math.abs Math.floor Math.min Math.max). Never Math.sin/cos/exp/pow/atan2/random/Date.

export * from './dmath.ts';
export * from './schema.ts';
export * from './scene.ts';
export * from './timewarp.ts';
export * from './color.ts';
export * from './ease.ts';

export const TAU = Math.PI * 2;
export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function formatThousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** FNV-1a over the bytes of a float64 array (cross-runtime state parity checks). */
export function hashFloats(arr: ArrayLike<number>): string {
  const bytes = new Uint8Array(new Float64Array(Array.from(arr)).buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Number sequences used for "how many balls in wave n" style escalation. */
export function sequence(kind: string, n: number, opts: { start?: number; step?: number; custom?: string } = {}): number[] {
  const out: number[] = [];
  if (kind === 'fibonacci') { let a = 1, b = 2; out.push(1); while (out.length < n) { out.push(b); [a, b] = [b, a + b]; } }
  else if (kind === 'double') { let v = opts.start ?? 1; while (out.length < n) { out.push(v); v *= 2; } }
  else if (kind === 'linear') { let v = opts.start ?? 1; while (out.length < n) { out.push(v); v += opts.step ?? 1; } }
  else if (kind === 'gentle') { // slow escalation, then +6 per wave
    const base = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 24, 29, 34, 40, 46, 52];
    for (let i = 0; out.length < n; i++) out.push(i < base.length ? base[i] : 52 + 6 * (i - base.length + 1)); }
  else if (kind === 'custom') { for (const t of (opts.custom ?? '').split(/[ ,]+/)) if (t) out.push(Math.max(1, parseInt(t, 10) || 1)); }
  return out.slice(0, n);
}
