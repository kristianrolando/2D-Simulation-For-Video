// Balls under gravity inside a circle, elastic bounces. Flight between bounces is an exact parabola;
// the bounce time is the first root of |p(t) − c|² = ρ², found by stepping then bisection (only
// + − × ÷, so the result is bit-identical in every JS engine). Tiny initial offsets grow
// exponentially: a visual demonstration of chaos.

export interface BounceParams { balls: number; radius: number; ballR: number; g: number; offset: number; startX: number; startY: number; vx0: number; tEnd: number }
export interface Seg { t0: number; x: number; y: number; vx: number; vy: number }
export interface Hit { t: number; i: number; x: number; y: number; speed: number }
export interface BounceSim { P: BounceParams; tracks: Seg[][]; hits: Hit[]; maxEnergyDriftRel: number; maxRadiusErrPx: number }

export const CENTER = { x: 540, y: 1000 };

export function simulate(P: BounceParams): BounceSim {
  const rho = P.radius - P.ballR, g = P.g, cx = CENTER.x, cy = CENTER.y;
  const tracks: Seg[][] = [], hits: Hit[] = [];
  let maxDrift = 0, maxRad = 0;
  for (let i = 0; i < P.balls; i++) {
    let s: Seg = { t0: 0, x: P.startX + i * P.offset, y: P.startY, vx: P.vx0, vy: 0 };
    const segs = [s];
    const E0 = 0.5 * (s.vx * s.vx + s.vy * s.vy) - g * (s.y - cy);
    const f = (tau: number) => { const x = s.x + s.vx * tau - cx, y = s.y + s.vy * tau + 0.5 * g * tau * tau - cy; return x * x + y * y - rho * rho; };
    let guard = 0;
    while (s.t0 < P.tEnd && guard++ < 200000) {
      // step until outside, then bisect the crossing
      const h = 0.002;
      let a = 1e-9, b = h;
      while (f(b) < 0) { a = b; b += h; if (b > 60) break; }
      for (let k = 0; k < 64; k++) { const m = 0.5 * (a + b); if (f(m) < 0) a = m; else b = m; }
      const tau = a;
      let x = s.x + s.vx * tau, y = s.y + s.vy * tau + 0.5 * g * tau * tau;
      let vx = s.vx, vy = s.vy + g * tau;
      // project exactly onto the circle (records the correction) and reflect about the normal
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy), nx = dx / d, ny = dy / d;
      maxRad = Math.max(maxRad, Math.abs(d - rho));
      x = cx + nx * rho; y = cy + ny * rho;
      const dot = vx * nx + vy * ny;
      vx -= 2 * dot * nx; vy -= 2 * dot * ny;
      const t = s.t0 + tau;
      hits.push({ t, i, x, y, speed: Math.abs(dot) });
      s = { t0: t, x, y, vx, vy }; segs.push(s);
      const E = 0.5 * (vx * vx + vy * vy) - g * (y - cy);
      maxDrift = Math.max(maxDrift, Math.abs((E - E0) / E0));
    }
    tracks.push(segs);
  }
  hits.sort((p, q) => p.t - q.t || p.i - q.i);
  return { P, tracks, hits, maxEnergyDriftRel: maxDrift, maxRadiusErrPx: maxRad };
}

/** position + velocity of ball i at time t */
export function posAt(S: BounceSim, i: number, t: number): [number, number, number, number] {
  const segs = S.tracks[i];
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].t0 <= t) lo = m; else hi = m - 1; }
  const s = segs[lo], tau = t - s.t0, g = S.P.g;
  return [s.x + s.vx * tau, s.y + s.vy * tau + 0.5 * g * tau * tau, s.vx, s.vy + g * tau];
}
