// Uniform spatial grid for equal-radius discs (broad phase of the collision step).
// Rebuilt every sub-step with a counting sort: O(n), no allocation after construction (all typed
// arrays are sized for `capacity` bodies up front). Neighbour pairs are visited in a fixed order,
// so the narrow phase is deterministic.

export class DiscGrid {
  readonly cell: number; readonly cols: number; readonly rows: number;
  readonly x0: number; readonly y0: number;
  /** cellStart[c]..cellStart[c+1] index into `order` */
  readonly cellStart: Int32Array;
  readonly order: Int32Array;
  private cellOf: Int32Array;

  constructor(o: { x0: number; y0: number; w: number; h: number; cell: number; capacity: number }) {
    this.cell = o.cell; this.x0 = o.x0; this.y0 = o.y0;
    this.cols = Math.max(1, Math.ceil(o.w / o.cell)); this.rows = Math.max(1, Math.ceil(o.h / o.cell));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.order = new Int32Array(o.capacity);
    this.cellOf = new Int32Array(o.capacity);
  }

  private index(x: number, y: number) {
    let cx = Math.floor((x - this.x0) / this.cell), cy = Math.floor((y - this.y0) / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** bucket bodies 0..n-1 by cell (counting sort) */
  build(px: Float64Array, py: Float64Array, n: number) {
    const cs = this.cellStart; cs.fill(0);
    for (let i = 0; i < n; i++) { const c = this.index(px[i], py[i]); this.cellOf[i] = c; cs[c + 1]++; }
    for (let c = 0; c < cs.length - 1; c++) cs[c + 1] += cs[c];
    // fill using a running cursor per cell (reuse cellStart shifted copy semantics without allocating)
    for (let i = 0; i < n; i++) { const c = this.cellOf[i]; this.order[cs[c]++] = i; }
    // cs[c] now holds the END of cell c; shift back so cs[c] is the start again
    for (let c = cs.length - 1; c > 0; c--) cs[c] = cs[c - 1];
    cs[0] = 0;
  }

  /** call fn(i, j) once for every pair of bodies in the same or adjacent cells (i < j not guaranteed; each unordered pair once) */
  pairs(fn: (i: number, j: number) => void) {
    const { cols, rows, cellStart: cs, order } = this;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx, a0 = cs[c], a1 = cs[c + 1];
      if (a0 === a1) continue;
      // same cell
      for (let a = a0; a < a1; a++) for (let b = a + 1; b < a1; b++) fn(order[a], order[b]);
      // forward neighbours: (+1,0), (-1,+1), (0,+1), (+1,+1) — each adjacent pair of cells once
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? 0 : 1), ny = cy + (k === 0 ? 0 : 1);
        if (nx < 0 || nx >= cols || ny >= rows) continue;
        const d = ny * cols + nx, b0 = cs[d], b1 = cs[d + 1];
        for (let a = a0; a < a1; a++) for (let b = b0; b < b1; b++) fn(order[a], order[b]);
      }
    }
  }
}
