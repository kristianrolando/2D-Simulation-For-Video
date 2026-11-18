// P2 — rosette orbit. Pure simulation core (math coords, y up, sun at origin, units: px and years).
//
// Force: a = -(mu/r^2 + kappa/r^3) r_hat. This central force has an exact closed-form orbit
//   r(phi) = p / (1 + e cos(gamma (phi - phi_p))),  gamma^2 = 1 - kappa / L^2
// i.e. a Kepler ellipse whose apsides precess by 360/gamma - 360 degrees per radial period.
// The integrator (fixed-step RK4) is therefore checkable against an analytic answer.

import { dsin, dcos } from '../lib/dmath.js';

export const DEFAULTS = {
  rApo: 445,             // apoapsis distance (px)
  rPeri: 78,             // periapsis distance (px)
  precessDeg: 10,        // prograde apsidal precession per orbit (deg) -> 360/10 = 36 orbits to close
  periodYears: 6250,     // radial period (years)
  startAngleDeg: 90,     // start at apoapsis, straight above the sun
  stepsPerOrbit: 20000,  // RK4 steps per radial period
};

export function createSim(p = {}) {
  const P = { ...DEFAULTS, ...p };
  const e = (P.rApo - P.rPeri) / (P.rApo + P.rPeri);
  const semi = (P.rApo + P.rPeri) / 2;
  const pLat = (2 * P.rApo * P.rPeri) / (P.rApo + P.rPeri);
  const gamma = 360 / (360 + P.precessDeg);
  const mu = (4 * Math.PI * Math.PI * semi ** 3) / (P.periodYears ** 2);
  const Leff2 = mu * pLat;                 // L^2 - kappa
  const L = Math.sqrt(Leff2) / gamma;      // L^2 gamma^2 = Leff2
  const kappa = L * L - Leff2;
  const orbitsToClose = Math.round(360 / P.precessDeg);
  const closeYears = orbitsToClose * P.periodYears;
  const dt = P.periodYears / P.stepsPerOrbit;

  const th0 = (P.startAngleDeg * Math.PI) / 180;
  // state: x, y, vx, vy (CCW motion; at apoapsis velocity is tangential)
  let s = [P.rApo * dcos(th0), P.rApo * dsin(th0), -dsin(th0) * (L / P.rApo), dcos(th0) * (L / P.rApo)];
  const s0 = s.slice();
  let n = 0;                 // grid steps taken
  const phiPeri0 = th0 - Math.PI / gamma; // analytic periapsis angle for the start configuration

  const acc = (x, y) => { const r2 = x * x + y * y, r = Math.sqrt(r2); const k = -(mu / r2 + kappa / (r2 * r)) / r; return [k * x, k * y]; };
  function rk4(st, h) {
    const [x, y, vx, vy] = st;
    const [a1x, a1y] = acc(x, y);
    const [a2x, a2y] = acc(x + 0.5 * h * vx, y + 0.5 * h * vy);
    const v2x = vx + 0.5 * h * a1x, v2y = vy + 0.5 * h * a1y;
    const [a3x, a3y] = acc(x + 0.5 * h * v2x, y + 0.5 * h * v2y);
    const v3x = vx + 0.5 * h * a2x, v3y = vy + 0.5 * h * a2y;
    const [a4x, a4y] = acc(x + h * v3x, y + h * v3y);
    const v4x = vx + h * a3x, v4y = vy + h * a3y;
    return [
      x + (h / 6) * (vx + 2 * v2x + 2 * v3x + v4x),
      y + (h / 6) * (vy + 2 * v2y + 2 * v3y + v4y),
      vx + (h / 6) * (a1x + 2 * a2x + 2 * a3x + a4x),
      vy + (h / 6) * (a1y + 2 * a2y + 2 * a3y + a4y),
    ];
  }
  const energy = (st) => { const r = Math.hypot(st[0], st[1]); return 0.5 * (st[2] ** 2 + st[3] ** 2) - mu / r - kappa / (2 * r * r); };
  const angmom = (st) => st[0] * st[3] - st[1] * st[2];
  const E0 = energy(s), L0 = angmom(s);

  // diagnostics
  let phiUnwrapped = th0, lastPhi = th0, maxRadErr = 0, maxEnergyRel = 0, maxLRel = 0;
  let prevR = Math.hypot(s[0], s[1]), prevDr = -1;
  const peris = [];

  /** Advance to sim time `years`. Returns {points:[x,y,...] (grid points, decimated), events, display:[x,y,vx,vy]} */
  function advance(years, { minSpacing = 2.5 } = {}) {
    const points = [];
    const events = [];
    let lx = NaN, ly = NaN;
    while ((n + 1) * dt <= years + 1e-9) {
      const prev = s;
      s = rk4(s, dt); n++;
      const r = Math.hypot(s[0], s[1]);
      const ph = Math.atan2(s[1], s[0]);
      let d = ph - lastPhi; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      phiUnwrapped += d; lastPhi = ph;
      const rA = pLat / (1 + e * Math.cos(gamma * (phiUnwrapped - phiPeri0)));
      maxRadErr = Math.max(maxRadErr, Math.abs(r - rA));
      if ((n & 63) === 0) {
        maxEnergyRel = Math.max(maxEnergyRel, Math.abs((energy(s) - E0) / E0));
        maxLRel = Math.max(maxLRel, Math.abs((angmom(s) - L0) / L0));
      }
      const dr = r - prevR;
      if (prevDr < 0 && dr >= 0) {
        // periapsis lies between prev and current grid point; record the previous grid point (error < 1 step)
        const pr = Math.hypot(prev[0], prev[1]);
        const pk = { t: (n - 1) * dt, x: prev[0], y: prev[1], r: pr, phi: phiUnwrapped - d };
        peris.push(pk);
        events.push({ type: 'peri', t: pk.t, x: pk.x, y: pk.y, k: peris.length });
      }
      prevDr = dr; prevR = r;
      if (!(Math.hypot(s[0] - lx, s[1] - ly) < minSpacing)) { points.push(s[0], s[1]); lx = s[0]; ly = s[1]; }
      if (Math.abs(n * dt - closeYears) < dt / 2) events.push({ type: 'close', t: n * dt, x: s[0], y: s[1], miss: Math.hypot(s[0] - s0[0], s[1] - s0[1]) });
    }
    const h = years - n * dt;
    const display = h > 1e-12 ? rk4(s, h) : s.slice();
    points.push(display[0], display[1]);
    return { points, events, display };
  }

  return {
    params: P, e, gamma, mu, kappa, L, dt, closeYears, orbitsToClose, start: s0,
    advance,
    get steps() { return n; },
    get peris() { return peris; },
    diagnostics: () => ({
      maxRadialErrorPx: maxRadErr, maxEnergyDriftRel: maxEnergyRel, maxAngMomDriftRel: maxLRel,
      periapsisCount: peris.length,
      meanPrecessionDeg: peris.length > 1 ? ((peris.at(-1).phi - peris[0].phi) / (peris.length - 1)) * 180 / Math.PI - 360 : null,
    }),
    snapshot: () => s.slice(),
  };
}
