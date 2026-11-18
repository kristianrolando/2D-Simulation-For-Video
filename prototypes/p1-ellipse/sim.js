// P1 — focal reflection in an ellipse. Pure simulation core: no drawing, no DOM.
// Balls move in straight lines at constant speed and reflect off the ellipse.
// Every path focus->wall->other focus has length 2A, so a wave launched together
// arrives together. Each arrival adds new balls (Fibonacci total) at that focus.

import { TAU } from '../lib/core.js';
import { dsin, dcos } from '../lib/dmath.js';

export const DEFAULTS = {
  cx: 540, cy: 930,       // ellipse centre (px)
  A: 508, B: 348,         // semi-axes: A vertical (major), B horizontal (px)
  period: 2.583,          // sim-seconds between focus arrivals (sets speed = 2A/period)
  counts: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377],
  theta0: 0.45,           // first launch direction (rad, screen coords, y down)
};

export function createSim(p = {}) {
  const P = { ...DEFAULTS, ...p };
  const c = Math.sqrt(P.A * P.A - P.B * P.B);
  const foci = [{ x: P.cx, y: P.cy + c }, { x: P.cx, y: P.cy - c }]; // [bottom, top]
  const speed = (2 * P.A) / P.period;
  const finalWave = P.counts.length; // arrival index at which everyone has arrived
  const balls = [];
  let tau = 0, arrivals = 0, finished = false, maxFocusMiss = 0;

  function wallHit(b) {
    const X = b.x0 - P.cx, Y = b.y0 - P.cy, iB2 = 1 / (P.B * P.B), iA2 = 1 / (P.A * P.A);
    const a2 = b.dx * b.dx * iB2 + b.dy * b.dy * iA2;
    const b2 = 2 * (X * b.dx * iB2 + Y * b.dy * iA2);
    const c2 = X * X * iB2 + Y * Y * iA2 - 1;
    const s = (-b2 + Math.sqrt(b2 * b2 - 4 * a2 * c2)) / (2 * a2);
    return b.s0 + s / speed;
  }
  // Ball k of a wave with n balls leaves the focus at angle theta0 + k*2pi/n. Because every ball of a
  // wave is at the focus at the same instant, re-launching the whole wave with a uniform fan is seamless.
  function launch(k, n, focus, at) {
    const th = P.theta0 + (k * TAU) / n;
    const b = { k, x0: focus.x, y0: focus.y, dx: dcos(th), dy: dsin(th), s0: at, hue: k / n, hit: 0, born: at };
    b.hit = wallHit(b);
    balls[k] = b;
    return b;
  }
  const posAt = (b, t) => [b.x0 + b.dx * speed * (t - b.s0), b.y0 + b.dy * speed * (t - b.s0)];

  launch(0, 1, foci[0], 0);

  /**
   * Advance to sim time `target`. Returns { paths: Map(k -> [x,y,...]), events: [{t, type, ...}] }.
   * Event times are in sim seconds.
   */
  function advance(target) {
    const paths = new Map();
    const events = [];
    for (const b of balls) { const [x, y] = posAt(b, Math.max(tau, b.s0)); paths.set(b.k, [x, y]); }
    while (!finished) {
      const nextArrival = (arrivals + 1) * P.period;
      const stop = Math.min(target, nextArrival);
      // move every ball up to `stop`, reflecting at walls
      for (const b of balls) {
        const path = paths.get(b.k);
        while (b.hit <= stop) {
          const [hx, hy] = posAt(b, b.hit);
          const nx = (hx - P.cx) / (P.B * P.B), ny = (hy - P.cy) / (P.A * P.A);
          const nl = Math.hypot(nx, ny);
          const ux = nx / nl, uy = ny / nl;
          const dot = b.dx * ux + b.dy * uy;
          b.dx -= 2 * dot * ux; b.dy -= 2 * dot * uy;
          b.x0 = hx; b.y0 = hy; b.s0 = b.hit;
          b.hit = wallHit(b);
          path.push(hx, hy);
          events.push({ t: b.s0, type: 'wall', k: b.k, x: hx, y: hy, hue: b.hue });
        }
      }
      if (stop < nextArrival) break;
      // arrival: every ball should be at focus F = foci[arrivals+1 odd -> top]
      arrivals++;
      const F = foci[arrivals % 2];
      for (const b of balls) {
        const [x, y] = posAt(b, nextArrival);
        maxFocusMiss = Math.max(maxFocusMiss, Math.hypot(x - F.x, y - F.y));
        // snap to the exact focus to keep the analytic invariant (miss is logged above)
        b.x0 = F.x; b.y0 = F.y; b.s0 = nextArrival; b.hit = wallHit(b);
        paths.get(b.k).push(F.x, F.y);
      }
      if (arrivals >= finalWave) {
        finished = true;
        events.push({ t: nextArrival, type: 'final', focus: arrivals % 2, count: balls.length });
        break;
      }
      const total = P.counts[arrivals];
      const before = balls.length;
      for (let k = 0; k < total; k++) { launch(k, total, F, nextArrival); if (!paths.has(k)) paths.set(k, [F.x, F.y]); }
      events.push({ t: nextArrival, type: 'arrive', n: arrivals, focus: arrivals % 2, count: total, added: total - before });
    }
    tau = finished ? Math.max(tau, arrivals * P.period) : target;
    for (const b of balls) { const [x, y] = finished ? [foci[arrivals % 2].x, foci[arrivals % 2].y] : posAt(b, tau); paths.get(b.k).push(x, y); }
    events.sort((a, b) => a.t - b.t || (a.k ?? -1) - (b.k ?? -1));
    return { paths, events };
  }

  return {
    params: P, foci, speed,
    get balls() { return balls; },
    get tau() { return tau; },
    get arrivals() { return arrivals; },
    get finished() { return finished; },
    get maxFocusMiss() { return maxFocusMiss; },
    count: () => balls.length,
    posAt, advance,
    /** state snapshot for cross-runtime parity checks */
    snapshot: () => balls.flatMap(b => [b.x0, b.y0, b.dx, b.dy, b.s0]),
  };
}
