// Shared, environment-agnostic helpers (no DOM, no Node APIs).
// Everything here is deterministic: no Date, no Math.random.

export const TAU = Math.PI * 2;
export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Rainbow palette sampled from the references (cyan -> blue -> purple -> pink -> orange -> yellow -> green).
export const RAINBOW = ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff6f9a', '#ff8a3d', '#ffd23f', '#9be36b'];

export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
export function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/** Sample a palette at u in [0,1). cyclic=true wraps the last stop back to the first. */
export function samplePalette(stops, u, cyclic = true) {
  const n = cyclic ? stops.length : stops.length - 1;
  let x = (cyclic ? ((u % 1) + 1) % 1 : clamp(u, 0, 1)) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  return mixRgb(hexToRgb(stops[i % stops.length]), hexToRgb(stops[(i + 1) % stops.length]), f);
}

export function formatThousands(n) {
  const s = String(Math.trunc(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * TimeWarp: maps video frame index -> simulation time.
 * rateAt(tVideo) gives a relative speed shape; the table is the deterministic cumulative
 * sum at frame resolution, then scaled so that simTime(frameAnchor) === simAnchor exactly.
 */
export class TimeWarp {
  constructor({ fps, frames, rateAt, anchorFrame, anchorSim }) {
    this.fps = fps;
    const tab = new Float64Array(frames + 1);
    let acc = 0;
    for (let f = 1; f <= frames; f++) {
      // midpoint rule on each frame interval
      acc += rateAt((f - 0.5) / fps) / fps;
      tab[f] = acc;
    }
    const scale = anchorSim / tab[anchorFrame];
    for (let f = 0; f <= frames; f++) tab[f] *= scale;
    tab[anchorFrame] = anchorSim; // exact, avoids 1-ulp drift
    this.tab = tab;
    this.scale = scale;
  }
  sim(frame) { return this.tab[Math.min(frame, this.tab.length - 1)]; }
}

/** Cheap FNV-1a 32-bit over a Float64 state snapshot (for cross-runtime state parity checks). */
export function hashFloats(arr) {
  const buf = new Float64Array(arr);
  const bytes = new Uint8Array(buf.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
