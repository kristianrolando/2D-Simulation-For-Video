// Container geometry shared by the new templates: convex polygons, circles and rings, fitted into a box.
// Everything here is plain arithmetic + dmath (sin/cos), so it is identical in the browser and in Node.
import { dsin, dcos } from '../core/index.ts';

export type ContainerKind = 'octagon' | 'circle' | 'square' | 'triangle' | 'hexagon' | 'ring';
export const CONTAINER_KINDS: ContainerKind[] = ['octagon', 'circle', 'square', 'triangle', 'ring'];

/** an edge with its inward unit normal: inside means nx*x + ny*y - c >= 0 */
export interface Edge { x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; c: number }
export interface Container {
  kind: ContainerKind; cx: number; cy: number;
  /** circle / ring outer radius, or the polygon's circumradius */
  R: number;
  /** ring inner radius (0 = none) */
  rin: number;
  /** polygon vertices (x, y pairs), empty for circles */
  verts: number[];
  edges: Edge[];
  /** distance to the closest wall (positive inside) */
  inside(x: number, y: number): number;
  /** outline path (closed sub-paths) for drawing */
  path(g: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; arc(x: number, y: number, r: number, a0: number, a1: number): void; closePath(): void }): void;
}

const SIDES: Partial<Record<ContainerKind, { n: number; rot: number }>> = {
  octagon: { n: 8, rot: Math.PI / 8 }, square: { n: 4, rot: Math.PI / 4 }, hexagon: { n: 6, rot: 0 },
  // apex up: first vertex at -90°
  triangle: { n: 3, rot: -Math.PI / 2 },
};

/** a container centred on (cx, cy) whose bounding box fits in `w` x `h` */
export function makeContainer(kind: ContainerKind, cx: number, cy: number, w: number, h: number, ringInner = 0.3): Container {
  const sp = SIDES[kind];
  if (!sp) {
    const R = Math.min(w, h) / 2, rin = kind === 'ring' ? R * ringInner : 0;
    return {
      kind, cx, cy, R, rin, verts: [], edges: [],
      inside(x, y) { const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy); return rin > 0 ? Math.min(R - d, d - rin) : R - d; },
      path(g) { g.moveTo(cx + R, cy); g.arc(cx, cy, R, 0, Math.PI * 2); g.closePath(); if (rin > 0) { g.moveTo(cx + rin, cy); g.arc(cx, cy, rin, 0, Math.PI * 2); g.closePath(); } },
    };
  }
  // unit polygon, then scale to fit and centre its bounding box
  const u: number[] = [];
  for (let k = 0; k < sp.n; k++) { const a = sp.rot + (k * 2 * Math.PI) / sp.n; u.push(dcos(a), dsin(a)); }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < u.length; k += 2) { x0 = Math.min(x0, u[k]); x1 = Math.max(x1, u[k]); y0 = Math.min(y0, u[k + 1]); y1 = Math.max(y1, u[k + 1]); }
  const s = Math.min(w / (x1 - x0), h / (y1 - y0)), ox = cx - ((x0 + x1) / 2) * s, oy = cy - ((y0 + y1) / 2) * s;
  const verts = u.map((v, i) => (i % 2 ? oy + v * s : ox + v * s));
  // the polygon's own centre (centroid of the vertices) — differs from the box centre for the triangle
  let gx = 0, gy = 0; for (let k = 0; k < verts.length; k += 2) { gx += verts[k]; gy += verts[k + 1]; }
  gx /= sp.n; gy /= sp.n;
  const edges: Edge[] = [];
  for (let k = 0; k < sp.n; k++) {
    const ax = verts[2 * k], ay = verts[2 * k + 1], bx = verts[(2 * k + 2) % verts.length], by = verts[(2 * k + 3) % verts.length];
    let nx = -(by - ay), ny = bx - ax; const L = Math.sqrt(nx * nx + ny * ny); nx /= L; ny /= L;
    if (nx * (gx - ax) + ny * (gy - ay) < 0) { nx = -nx; ny = -ny; }
    edges.push({ x0: ax, y0: ay, x1: bx, y1: by, nx, ny, c: nx * ax + ny * ay });
  }
  return {
    kind, cx: gx, cy: gy, R: s, rin: 0, verts, edges,
    inside(x, y) { let m = Infinity; for (const e of edges) { const d = e.nx * x + e.ny * y - e.c; if (d < m) m = d; } return m; },
    path(g) { for (let k = 0; k < verts.length; k += 2) (k ? g.lineTo : g.moveTo).call(g, verts[k], verts[k + 1]); g.closePath(); },
  };
}

/** a hammer mount: a point on the wall and the inward direction the hammer travels */
export interface Mount { x: number; y: number; dx: number; dy: number }

/** up to 4 mounts in the order top, bottom, left, right (a triangle has 3: bottom, left, right) */
export function mountsOf(C: Container): Mount[] {
  if (!C.edges.length) {
    return [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([ux, uy]) => ({ x: C.cx + ux * C.R, y: C.cy + uy * C.R, dx: -ux, dy: -uy }));
  }
  if (C.verts.length === 6) {
    // triangle: hammers come out of the corners and travel toward the opposite (flat) side; top corner first
    const order = [0, 1, 2].sort((a, b) => C.verts[2 * a + 1] - C.verts[2 * b + 1]);
    return order.map(k => { const x = C.verts[2 * k], y = C.verts[2 * k + 1], dx = C.cx - x, dy = C.cy - y, L = Math.sqrt(dx * dx + dy * dy); return { x, y, dx: dx / L, dy: dy / L }; });
  }
  const want: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // inward normal of the top, bottom, left, right walls
  const out: Mount[] = [], used = new Set<number>();
  for (const [wx, wy] of want) {
    let best = -1, bd = 0.45; // accept walls within ~63° of the wanted direction
    C.edges.forEach((e, i) => { const d = e.nx * wx + e.ny * wy; if (!used.has(i) && d > bd) { bd = d; best = i; } });
    if (best < 0) continue;
    used.add(best); const e = C.edges[best];
    out.push({ x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2, dx: e.nx, dy: e.ny });
  }
  return out;
}

/** point at fraction f (0..1, wraps) along a closed path of "radius" r around (cx, cy), starting at the top, clockwise.
 *  sides = 0 → circle; otherwise a regular polygon with a vertex at the top, walked at constant speed. */
export function pathPoint(cx: number, cy: number, r: number, sides: number, f: number, out: { x: number; y: number }) {
  f -= Math.floor(f);
  if (sides < 3) { const a = -Math.PI / 2 + f * 2 * Math.PI; out.x = cx + r * dcos(a); out.y = cy + r * dsin(a); return out; }
  const seg = f * sides, k = Math.floor(seg), u = seg - k;
  const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / sides, a1 = a0 + (2 * Math.PI) / sides;
  const x0 = dcos(a0), y0 = dsin(a0), x1 = dcos(a1), y1 = dsin(a1);
  out.x = cx + r * (x0 + (x1 - x0) * u); out.y = cy + r * (y0 + (y1 - y0) * u);
  return out;
}

/** closest point on segment (ax, ay)-(bx, by) to (px, py), as the segment parameter in [0, 1] */
export function segParam(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
  if (L2 === 0) return 0;
  const t = ((px - ax) * ex + (py - ay) * ey) / L2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
