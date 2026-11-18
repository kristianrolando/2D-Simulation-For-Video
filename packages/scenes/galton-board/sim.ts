// Galton board: balls hop through R rows of pegs (left/right with probability p) and stack in R+1 bins.
// Pure + deterministic: every ball's path is a function of its index and the seed, so positions at any
// time are a lookup. Final bin counts follow Binomial(R, p).
import { mulberry32 } from '../../core/index.ts';

export interface GaltonParams { balls: number; rows: number; p: number; seed: number; interval: number }
export interface Geometry { cx: number; top: number; dx: number; dy: number; pegR: number; ballR: number; binTop: number; floor: number; perLayer: number; entryY: number }

export const GEO: Geometry = { cx: 540, top: 600, dx: 62, dy: 52, pegR: 6, ballR: 5.2, binTop: 0, floor: 1560, perLayer: 5, entryY: 470 };

export interface Ball { release: number; bits: number; bin: number; slot: number; tPegs: number; tLand: number; landX: number; landY: number }
export interface GaltonSim { P: GaltonParams; g: Geometry; balls: Ball[]; counts: number[]; tEnd: number; hop: number; fall0: number;
  events: { t: number; type: 'peg' | 'land'; i: number; row: number; bin: number }[] }

const G = 2600; // px/s² (visual gravity)

export function geometry(rows: number): Geometry {
  const g = { ...GEO };
  g.dx = Math.min(62, 820 / (rows + 1));
  g.dy = g.dx * 0.84;
  g.binTop = g.top + (rows - 1) * g.dy + 40;
  g.perLayer = Math.max(2, Math.floor((g.dx - 4) / (2 * g.ballR + 0.6)));
  return g;
}

export function pegXY(g: Geometry, row: number, k: number): [number, number] { return [g.cx + (k - row / 2) * g.dx, g.top + row * g.dy]; }
export function binX(g: Geometry, rows: number, k: number) { return g.cx + (k - rows / 2) * g.dx; }
/** resting position of the s-th ball in a bin (hex packing) */
export function slotXY(g: Geometry, rows: number, bin: number, s: number): [number, number] {
  const d = 2 * g.ballR + 0.6, layer = Math.floor(s / g.perLayer), col = s % g.perLayer;
  const off = (layer % 2 ? 0.5 : 0) * d - ((g.perLayer - 1) / 2) * d;
  return [binX(g, rows, bin) + off + col * d - (layer % 2 ? d / 4 : 0), g.floor - g.ballR - layer * d * 0.87];
}

export function simulate(P: GaltonParams): GaltonSim {
  const g = geometry(P.rows);
  const rnd = mulberry32(P.seed);
  const hop = Math.sqrt((2 * g.dy) / G) * 1.15;                // time between peg contacts
  const fall0 = Math.sqrt((2 * (g.top - g.ballR - g.pegR - g.entryY)) / G); // entry -> first peg
  const counts = new Array(P.rows + 1).fill(0);
  const balls: Ball[] = [];
  const events: GaltonSim['events'] = [];
  for (let i = 0; i < P.balls; i++) {
    const release = i * P.interval;
    let bits = 0, k = 0;
    for (let r = 0; r < P.rows; r++) { if (rnd() < P.p) { bits |= 1 << r; k++; } }
    const slot = counts[k]++;
    const tPegs = release + fall0;
    const [lx, ly] = slotXY(g, P.rows, k, slot);
    const lastY = g.top + (P.rows - 1) * g.dy;
    const fall = Math.sqrt((2 * Math.max(4, ly - lastY)) / G);
    const tLand = tPegs + P.rows * hop + fall * 0.9;
    balls.push({ release, bits, bin: k, slot, tPegs, tLand, landX: lx, landY: ly });
    for (let r = 0; r < P.rows; r++) events.push({ t: tPegs + r * hop, type: 'peg', i, row: r, bin: k });
    events.push({ t: tLand, type: 'land', i, row: P.rows, bin: k });
  }
  events.sort((a, b) => a.t - b.t || a.i - b.i);
  const tEnd = balls.length ? Math.max(...balls.map(b => b.tLand)) : 0;
  return { P, g, balls, counts, tEnd, hop, fall0, events };
}

/** position of ball b at sim time t (null before release) */
export function ballPos(S: GaltonSim, b: Ball, t: number): [number, number, number] | null {
  const g = S.g;
  if (t < b.release) return null;
  if (t >= b.tLand) return [b.landX, b.landY, 0];
  if (t < b.tPegs) { const u = t - b.release; return [g.cx, g.entryY + 0.5 * G * u * u, G * u]; }
  const rows = S.P.rows;
  const lastHopEnd = b.tPegs + rows * S.hop;
  // column index after r decisions = number of set bits in the first r bits
  const colAt = (r: number) => { let c = 0; for (let j = 0; j < r; j++) if (b.bits & (1 << j)) c++; return c; };
  if (t < lastHopEnd) {
    const r = Math.min(rows - 1, Math.floor((t - b.tPegs) / S.hop)), u = (t - b.tPegs - r * S.hop) / S.hop;
    const c = colAt(r), right = (b.bits >> r) & 1;
    const [x0, y0] = pegXY(g, r, c); const sy0 = y0 - g.pegR - g.ballR;
    const x1 = x0 + (right ? 0.5 : -0.5) * g.dx, y1 = sy0 + g.dy;
    // parabolic hop: slight bounce up, then fall onto the next peg (or into the bin column)
    const y = sy0 + (y1 - sy0) * u * u - 22 * 4 * u * (1 - u) * 0.5;
    return [x0 + (x1 - x0) * u, y, 0];
  }
  const u = (t - lastHopEnd) / (b.tLand - lastHopEnd);
  const x0 = binX(g, rows, b.bin), y0 = g.top + (rows - 1) * g.dy + g.dy - g.pegR - g.ballR;
  return [x0 + (b.landX - x0) * u, y0 + (b.landY - y0) * u * u, 1];
}

/** expected count for bin k */
export function binomialExpected(n: number, rows: number, p: number, k: number) {
  let c = 1; for (let j = 0; j < k; j++) c = (c * (rows - j)) / (j + 1);
  let pk = 1; for (let j = 0; j < k; j++) pk *= p;
  let qk = 1; for (let j = 0; j < rows - k; j++) qk *= 1 - p;
  return n * c * pk * qk;
}
