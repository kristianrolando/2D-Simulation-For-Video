// P3 — pendulum wave. Pure simulation core.
// Pendulum i must complete n_i = nMax - i full swings in one cycle of `cycle` seconds.
// All bobs start with the same horizontal displacement X0, so amplitudes differ (15°–40°) and the
// small-angle period formula is not good enough. The exact large-amplitude period is
//   T = 4 sqrt(L/g) K(sin(theta0/2))   (K = complete elliptic integral of the 1st kind)
// and L, theta0 = asin(X0/L) are solved together by fixed-point iteration.
// The nonlinear ODE theta'' = -(g/L) sin(theta) is then integrated with fixed-step RK4 and
// stored, so the state at any sim time is a pure lookup (seekable).

import { dsin, dasin } from '../../core/index.ts';

export const DEFAULTS = { count: 18, nMax: 47, cycle: 60, g: 9.81, X0: 0.26, hz: 2400 };

export function ellipticK(k: number): number {
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16; i++) { const an = (a + b) / 2; b = Math.sqrt(a * b); a = an; }
  return Math.PI / (2 * a);
}

export function solveLength(T: number, X0: number, g: number) {
  let L = g * (T / (2 * Math.PI)) ** 2;
  for (let it = 0; it < 100; it++) {
    const th = dasin(Math.min(0.999, X0 / L));
    const Ln = g * (T / (4 * ellipticK(dsin(th / 2)))) ** 2;
    if (Math.abs(Ln - L) < 1e-15) { L = Ln; break; }
    L = Ln;
  }
  return { L, theta0: dasin(X0 / L) };
}

export interface PendulumParams { count: number; nMax: number; cycle: number; g: number; X0: number; hz: number }
export interface Pend { i: number; n: number; T: number; L: number; theta0: number; Lsmall: number }

export function createSim(p: Partial<PendulumParams> = {}) {
  const P = { ...DEFAULTS, ...p };
  const dt = 1 / P.hz;
  const steps = Math.round(P.cycle * P.hz);
  const pend: Pend[] = [];
  for (let i = 0; i < P.count; i++) {
    const n = P.nMax - i;
    const T = P.cycle / n;
    const { L, theta0 } = solveLength(T, P.X0, P.g);
    pend.push({ i, n, T, L, theta0, Lsmall: P.g * (T / (2 * Math.PI)) ** 2 });
  }
  // integrate theta, omega with RK4; store theta at every step
  const hist = pend.map(() => new Float64Array(steps + 1));
  const extremes: { i: number; t: number }[] = []; // right-side turning points
  pend.forEach((pd, i) => {
    const w2 = P.g / pd.L;
    let th = pd.theta0, om = 0;
    const H = hist[i]; H[0] = th;
    let prevOm = 0;
    for (let s = 1; s <= steps; s++) {
      const f = (t: number) => -w2 * dsin(t); // deterministic sin: bit-identical in every JS engine
      const k1t = om, k1o = f(th);
      const k2t = om + 0.5 * dt * k1o, k2o = f(th + 0.5 * dt * k1t);
      const k3t = om + 0.5 * dt * k2o, k3o = f(th + 0.5 * dt * k2t);
      const k4t = om + dt * k3o, k4o = f(th + dt * k3t);
      th += (dt / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      om += (dt / 6) * (k1o + 2 * k2o + 2 * k3o + k4o);
      H[s] = th;
      if (prevOm > 0 && om <= 0) {
        // right turning point between s-1 and s: linear interpolation of omega's zero crossing
        extremes.push({ i, t: (s - 1 + prevOm / (prevOm - om)) * dt });
      }
      prevOm = om;
    }
  });
  extremes.sort((a, b) => a.t - b.t || a.i - b.i);

  /** theta of pendulum i at sim time t (linear interpolation of the RK4 samples). */
  function theta(i: number, t: number): number {
    const x = Math.min(Math.max(t, 0), P.cycle) * P.hz;
    const s = Math.min(Math.floor(x), steps - 1), f = x - s;
    return hist[i][s] * (1 - f) + hist[i][s + 1] * f;
  }

  function diagnostics() {
    // realignment: at t = cycle every pendulum should be back at +theta0
    let maxDeg = 0, maxX = 0;
    pend.forEach((pd, i) => {
      const th = hist[i][steps];
      maxDeg = Math.max(maxDeg, Math.abs(th - pd.theta0) * 180 / Math.PI);
      maxX = Math.max(maxX, Math.abs(pd.L * Math.sin(th) - P.X0));
    });
    // what the small-angle lengths would have done (analytic estimate of phase error at t = cycle):
    let naiveMaxDeg = 0;
    for (const pd of pend) {
      const Ttrue = 4 * Math.sqrt(pd.Lsmall / P.g) * ellipticK(Math.sin(Math.asin(Math.min(0.999, P.X0 / pd.Lsmall)) / 2));
      const phaseErr = (P.cycle / Ttrue - pd.n) * 360; // degrees of oscillation phase
      naiveMaxDeg = Math.max(naiveMaxDeg, Math.abs(((phaseErr + 180) % 360 + 360) % 360 - 180));
    }
    return { realignMaxErrDeg: maxDeg, realignMaxErrMeters: maxX, smallAngleLengthsPhaseErrDeg: naiveMaxDeg,
      amplitudesDeg: [pend[0].theta0 * 180 / Math.PI, pend[pend.length - 1].theta0 * 180 / Math.PI] };
  }

  return { params: P, pend, theta, extremes, diagnostics, steps, dt };
}
