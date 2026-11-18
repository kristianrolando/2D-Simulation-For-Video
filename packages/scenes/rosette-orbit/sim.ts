// Rosette orbit: a = -(mu/r² + kappa/r³) r̂. Exact orbit r(φ) = p / (1 + e cos(γ(φ − φp))),
// apsides precess by 360/γ − 360 degrees per radial period. Fixed-step RK4, state is plain data
// (structuredClone-able) so the studio can checkpoint it.
import { dcos, dsin, datan2 } from '../../core/index.ts';

export interface OrbitParams { rApo: number; rPeri: number; precessDeg: number; periodYears: number; startAngleDeg: number; stepsPerOrbit: number }

export interface OrbitConst { e: number; pLat: number; gamma: number; mu: number; kappa: number; L: number; dt: number; closeYears: number; orbits: number; phiPeri0: number; start: number[] }

export interface OrbitState { s: number[]; n: number; phiU: number; lastPhi: number; prevR: number; prevDr: number; maxRadErr: number; maxE: number; maxL: number; periCount: number; firstPeriPhi: number; lastPeriPhi: number }

export function constants(P: OrbitParams): OrbitConst {
  const e = (P.rApo - P.rPeri) / (P.rApo + P.rPeri);
  const semi = (P.rApo + P.rPeri) / 2, pLat = (2 * P.rApo * P.rPeri) / (P.rApo + P.rPeri);
  const gamma = 360 / (360 + P.precessDeg);
  const mu = (4 * Math.PI * Math.PI * semi * semi * semi) / (P.periodYears * P.periodYears);
  const Leff2 = mu * pLat, L = Math.sqrt(Leff2) / gamma, kappa = L * L - Leff2;
  const orbits = Math.round(360 / P.precessDeg);
  const th0 = (P.startAngleDeg * Math.PI) / 180;
  const v = L / P.rApo;
  return { e, pLat, gamma, mu, kappa, L, dt: P.periodYears / P.stepsPerOrbit, closeYears: orbits * P.periodYears, orbits,
    phiPeri0: th0 - Math.PI / gamma, start: [P.rApo * dcos(th0), P.rApo * dsin(th0), -dsin(th0) * v, dcos(th0) * v] };
}

export function initState(K: OrbitConst): OrbitState {
  const ph = datan2(K.start[1], K.start[0]);
  return { s: K.start.slice(), n: 0, phiU: ph, lastPhi: ph, prevR: Math.hypot(K.start[0], K.start[1]), prevDr: -1, maxRadErr: 0, maxE: 0, maxL: 0, periCount: 0, firstPeriPhi: 0, lastPeriPhi: 0 };
}

function rk4(K: OrbitConst, st: number[], h: number): number[] {
  const acc = (x: number, y: number) => { const r2 = x * x + y * y, r = Math.sqrt(r2), k = -(K.mu / r2 + K.kappa / (r2 * r)) / r; return [k * x, k * y]; };
  const [x, y, vx, vy] = st;
  const [a1x, a1y] = acc(x, y);
  const [a2x, a2y] = acc(x + 0.5 * h * vx, y + 0.5 * h * vy);
  const v2x = vx + 0.5 * h * a1x, v2y = vy + 0.5 * h * a1y;
  const [a3x, a3y] = acc(x + 0.5 * h * v2x, y + 0.5 * h * v2y);
  const v3x = vx + 0.5 * h * a2x, v3y = vy + 0.5 * h * a2y;
  const [a4x, a4y] = acc(x + h * v3x, y + h * v3y);
  const v4x = vx + h * a3x, v4y = vy + h * a3y;
  return [x + (h / 6) * (vx + 2 * v2x + 2 * v3x + v4x), y + (h / 6) * (vy + 2 * v2y + 2 * v3y + v4y),
    vx + (h / 6) * (a1x + 2 * a2x + 2 * a3x + a4x), vy + (h / 6) * (a1y + 2 * a2y + 2 * a3y + a4y)];
}
const energy = (K: OrbitConst, s: number[]) => { const r = Math.hypot(s[0], s[1]); return 0.5 * (s[2] * s[2] + s[3] * s[3]) - K.mu / r - K.kappa / (2 * r * r); };
const angmom = (s: number[]) => s[0] * s[3] - s[1] * s[2];

export type OrbitEvent = { type: 'peri'; t: number; x: number; y: number; k: number } | { type: 'close'; t: number; x: number; y: number; miss: number };

/** advance state to `years`; returns decimated path points (incl. the display point) and events */
export function advance(K: OrbitConst, S: OrbitState, years: number, minSpacing = 2.5) {
  const points: number[] = [], events: OrbitEvent[] = [];
  const E0 = energy(K, K.start), L0 = angmom(K.start);
  let lx = NaN, ly = NaN;
  while ((S.n + 1) * K.dt <= years + 1e-9) {
    const prev = S.s; S.s = rk4(K, S.s, K.dt); S.n++;
    const s = S.s, r = Math.hypot(s[0], s[1]);
    // diagnostics (do not influence the state)
    const ph = datan2(s[1], s[0]); let d = ph - S.lastPhi; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    S.phiU += d; S.lastPhi = ph;
    const rA = K.pLat / (1 + K.e * dcos(K.gamma * (S.phiU - K.phiPeri0)));
    if (Math.abs(r - rA) > S.maxRadErr) S.maxRadErr = Math.abs(r - rA);
    if ((S.n & 63) === 0) { S.maxE = Math.max(S.maxE, Math.abs((energy(K, s) - E0) / E0)); S.maxL = Math.max(S.maxL, Math.abs((angmom(s) - L0) / L0)); }
    const dr = r - S.prevR;
    if (S.prevDr < 0 && dr >= 0) {
      S.periCount++; if (S.periCount === 1) S.firstPeriPhi = S.phiU - d; S.lastPeriPhi = S.phiU - d;
      events.push({ type: 'peri', t: (S.n - 1) * K.dt, x: prev[0], y: prev[1], k: S.periCount });
    }
    S.prevDr = dr; S.prevR = r;
    if (!(Math.hypot(s[0] - lx, s[1] - ly) < minSpacing)) { points.push(s[0], s[1]); lx = s[0]; ly = s[1]; }
    if (Math.abs(S.n * K.dt - K.closeYears) < K.dt / 2) events.push({ type: 'close', t: S.n * K.dt, x: s[0], y: s[1], miss: Math.hypot(s[0] - K.start[0], s[1] - K.start[1]) });
  }
  const h = years - S.n * K.dt;
  const display = h > 1e-12 ? rk4(K, S.s, h) : S.s.slice();
  points.push(display[0], display[1]);
  return { points, events, display };
}

export function diagnostics(S: OrbitState) {
  return { maxRadialErrorPx: S.maxRadErr, maxEnergyDriftRel: S.maxE, maxAngMomDriftRel: S.maxL, periapses: S.periCount,
    meanPrecessionDeg: S.periCount > 1 ? ((S.lastPeriPhi - S.firstPeriPhi) / (S.periCount - 1)) * 180 / Math.PI - 360 : null };
}
