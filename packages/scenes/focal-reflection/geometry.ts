// Conic mirrors as implicit quadrics  A x² + B xy + C y² + D x + E y + F = 0  (screen coords, y down).
// A ray p + s·d meets any conic where a quadratic in s vanishes, so ellipses, parabolas, hyperbolas
// and straight segments share one intersection routine. Bounds clip a conic to the drawn arc.

export interface Conic {
  A: number; B: number; C: number; D: number; E: number; F: number;
  xmin: number; xmax: number; ymin: number; ymax: number;
  /** polyline used for drawing */
  draw: [number, number][];
}

const INF = Number.POSITIVE_INFINITY;
const EPS_S = 1e-7;

export function evalConic(q: Conic, x: number, y: number) {
  return q.A * x * x + q.B * x * y + q.C * y * y + q.D * x + q.E * y + q.F;
}

/** smallest s > EPS with the hit point inside the bounds, or Infinity */
export function intersect(q: Conic, x: number, y: number, dx: number, dy: number): number {
  const a = q.A * dx * dx + q.B * dx * dy + q.C * dy * dy;
  const b = 2 * q.A * x * dx + q.B * (x * dy + y * dx) + 2 * q.C * y * dy + q.D * dx + q.E * dy;
  const c = evalConic(q, x, y);
  const roots: number[] = [];
  if (Math.abs(a) < 1e-14 * (Math.abs(b) + 1e-300)) { if (b !== 0) roots.push(-c / b); }
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return INF;
    const sq = Math.sqrt(disc);
    // numerically stable pair
    const qq = -0.5 * (b + (b >= 0 ? sq : -sq));
    roots.push(qq / a); if (qq !== 0) roots.push(c / qq);
  }
  let best = INF;
  for (const s of roots) {
    if (!(s > EPS_S) || s >= best) continue;
    const hx = x + s * dx, hy = y + s * dy;
    // bounds are inclusive with a tiny slack: a hit exactly on an arc's extreme point must not be lost to rounding
    if (hx < q.xmin - 1e-7 || hx > q.xmax + 1e-7 || hy < q.ymin - 1e-7 || hy > q.ymax + 1e-7) continue;
    best = s;
  }
  return best;
}

export function normalAt(q: Conic, x: number, y: number): [number, number] {
  const nx = 2 * q.A * x + q.B * y + q.D, ny = q.B * x + 2 * q.C * y + q.E;
  const l = Math.sqrt(nx * nx + ny * ny);
  return [nx / l, ny / l];
}

const box = (xmin: number, xmax: number, ymin: number, ymax: number) => ({ xmin, xmax, ymin, ymax });

function sample(fn: (u: number) => [number, number], n = 240): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push(fn(i / n));
  return out;
}

/** ellipse ((x-cx)/rx)² + ((y-cy)/ry)² = 1, clipped to a y-range */
export function ellipse(cx: number, cy: number, rx: number, ry: number, ymin = -INF, ymax = INF): Conic {
  const a = 1 / (rx * rx), c = 1 / (ry * ry);
  const yl = Math.max(ymin, cy - ry), yh = Math.min(ymax, cy + ry);
  // draw: parametrise by angle and keep points in range (split arcs are drawn as separate polylines by the caller)
  const pts = sample(u => [cx + rx * Math.cos(u * Math.PI * 2), cy + ry * Math.sin(u * Math.PI * 2)], 720).filter(([, y]) => y >= yl - 1e-9 && y <= yh + 1e-9);
  return { A: a, B: 0, C: c, D: -2 * cx * a, E: -2 * cy * c, F: cx * cx * a + cy * cy * c - 1, ...box(cx - rx - 1, cx + rx + 1, yl, yh), draw: orderArc(pts) };
}

/** parabola opening upward on screen with vertex (cx, vy) and focal length f: focus at (cx, vy - f) */
export function parabolaUp(cx: number, vy: number, f: number, xmin: number, xmax: number): Conic {
  const k = 1 / (4 * f);
  const y = (x: number) => vy - (x - cx) * (x - cx) * k;
  return { A: k, B: 0, C: 0, D: -2 * cx * k, E: 1, F: cx * cx * k - vy, ...box(xmin, xmax, -INF, INF), draw: sample(u => { const x = xmin + (xmax - xmin) * u; return [x, y(x)]; }) };
}

/** hyperbola ((y-cy)/a)² − ((x-cx)/b)² = 1, upper (screen) branch, clipped to |x-cx| <= half */
export function hyperbolaUpper(cx: number, cy: number, a: number, b: number, half: number): Conic {
  const ia = 1 / (a * a), ib = 1 / (b * b);
  const y = (x: number) => cy - a * Math.sqrt(1 + ((x - cx) * (x - cx)) * ib);
  return { A: -ib, B: 0, C: ia, D: 2 * cx * ib, E: -2 * cy * ia, F: cy * cy * ia - cx * cx * ib - 1,
    ...box(cx - half, cx + half, -INF, cy), draw: sample(u => { const x = cx - half + 2 * half * u; return [x, y(x)]; }) };
}

/** upper (screen) arc of an ellipse, |x-cx| <= half, used as a concave secondary mirror */
export function ellipseCap(cx: number, cy: number, rx: number, ry: number, half: number): Conic {
  const e = ellipse(cx, cy, rx, ry, -INF, cy);
  const y = (x: number) => cy - ry * Math.sqrt(1 - ((x - cx) / rx) ** 2);
  return { ...e, xmin: cx - half, xmax: cx + half, draw: sample(u => { const x = cx - half + 2 * half * u; return [x, y(x)]; }) };
}

export function segment(x0: number, y0: number, x1: number, y1: number): Conic {
  const nx = y1 - y0, ny = -(x1 - x0), l = Math.hypot(nx, ny);
  const D = nx / l, E = ny / l;
  const pad = 1e-6;
  return { A: 0, B: 0, C: 0, D, E, F: -(D * x0 + E * y0), ...box(Math.min(x0, x1) - pad, Math.max(x0, x1) + pad, Math.min(y0, y1) - pad, Math.max(y0, y1) + pad), draw: [[x0, y0], [x1, y1]] };
}

/** reorder sampled closed-curve points so a clipped arc is one continuous polyline */
function orderArc(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  let gap = -1, gmax = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d > gmax) { gmax = d; gap = i; }
  }
  return gmax > 20 ? [...pts.slice(gap + 1), ...pts.slice(0, gap + 1)] : pts;
}
