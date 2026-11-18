// Fit the P3 camera so the projected rig lands where the reference draws it.
import { createSim } from '../prototypes/p3-pendulum/sim.js';
import { makeCamera } from '../prototypes/p3-pendulum/camera.js';
const sim = createSim({ hz: 200 });
const P = sim.pend, N = P.length;
const targets = [ // [what, i, x, y]
  ['pivot', 0, 540, 325], ['pivot', N - 1, 540, 890],
  ['rest', 0, 540, 640], ['rest', N - 1, 540, 1400],
  ['init', 0, 800, 583], ['init', N - 1, 770, 1383]];
function err(v) {
  const [d, Cy, Cz, alpha, F] = v;
  if (alpha < 0.2 || alpha > 1.55 || d <= 0 || F <= 0) return 1e12;
  const cam = makeCamera({ alpha, Cy, Cz, F });
  let e = 0;
  for (const [w, i, tx, ty] of targets) {
    const z = (N - 1 - i) * d, p = P[i];
    const pt = w === 'pivot' ? [0, 0, z] : w === 'rest' ? [0, -p.L, z] : [p.L * Math.sin(p.theta0), -p.L * Math.cos(p.theta0), z];
    const [x, y, s] = cam(...pt);
    if (!(s > 0)) return 1e12;
    e += (x - tx) ** 2 + (y - ty) ** 2;
  }
  return e;
}
// Nelder-Mead
function nm(f, x0, steps, iters = 6000) {
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => v + (i === j ? steps[j] : 0)))].map(x => [x, f(x)]);
  for (let k = 0; k < iters; k++) {
    S.sort((a, b) => a[1] - b[1]);
    const n = x0.length, c = x0.map((_, j) => S.slice(0, n).reduce((s, p) => s + p[0][j], 0) / n);
    const w = S[n][0], xr = c.map((v, j) => v + (v - w[j])), fr = f(xr);
    if (fr < S[0][1]) { const xe = c.map((v, j) => v + 2 * (v - w[j])), fe = f(xe); S[n] = fe < fr ? [xe, fe] : [xr, fr]; }
    else if (fr < S[n - 1][1]) S[n] = [xr, fr];
    else { const xc = c.map((v, j) => v + 0.5 * (w[j] - v)), fc = f(xc); if (fc < S[n][1]) S[n] = [xc, fc]; else S = S.map((p, i) => i ? [p[0].map((v, j) => S[0][0][j] + 0.5 * (v - S[0][0][j])), 0] : p).map(p => [p[0], f(p[0])]); }
  }
  S.sort((a, b) => a[1] - b[1]); return S[0];
}
let best = null;
for (const a0 of [0.5, 0.8, 1.1, 1.3]) for (const cz of [-3, -1.5]) {
  const r = nm(err, [0.08, 2, cz, a0, 1500], [0.02, 0.5, 0.5, 0.1, 300]);
  if (!best || r[1] < best[1]) best = r;
}
const [d, Cy, Cz, alpha, F] = best[0];
console.log(JSON.stringify({ d, Cy, Cz, alpha, F, rmsPx: Math.sqrt(best[1] / targets.length) }));
