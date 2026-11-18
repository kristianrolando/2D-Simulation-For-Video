// Hammer smash: hammers slide out of the walls of a container and smash the balls inside.
// Rules: 'split' (a crushed ball becomes k balls), 'box' (the hammers meet to form a box; every bounce
// inside the closed box adds a ball), 'survive' (a crushed ball is gone, a lucky wall bounce adds one).
//
// Determinism: fixed sub-steps, one seeded RNG, plain IEEE arithmetic + Math.sqrt (correctly rounded) and
// dmath for trigonometry. The run is *recorded* frame by frame (positions quantised to 1/8 px, colours,
// hammer extensions, events), lazily: the preview asks for frames as it plays, audio() asks for all of
// them. Preview, render and audio all read the same recording, so they cannot disagree.
import { mulberry32, dcos, dsin } from '../../core/index.ts';
import { DiscGrid } from '../../sim/grid.ts';
import { makeContainer, mountsOf, type Container, type ContainerKind, type Mount } from '../../sim/shapes.ts';

export type Rule = 'split' | 'box' | 'survive';
export const RULES: Rule[] = ['split', 'box', 'survive'];

export interface HammerParams {
  rule: Rule; container: ContainerKind; hammers: number; splitInto: number;
  capacity: number; startBalls: number; ballScale: number; speed: number; gravity: number;
  interval: number; speedUp: number; boxSize: number; bonus: number; seed: number;
  fps: number; /** last simulated frame (the burst) */ endFrame: number;
}

export const Ev = { Wall: 1, Ball: 2, Crush: 3, Spawn: 4, Strike: 5, Slam: 6, Cleared: 7, Full: 8, BoxClosed: 9 } as const;

export const CX = 540, CY = 1000, BOX_W = 1000, BOX_H = 1000;
const NCOL = 12;
const HEAD_RAD = 9;      // head half-thickness (capsule radius)
const ROD_RAD = 5;
const MAX_V = 2600;      // px/s cap after a hammer kick
const Q = 8;             // position quantisation: 1/8 px

/** growable typed arrays (amortised doubling; no per-frame allocation once warm) */
class Grow<T extends Int16Array | Uint8Array | Float32Array | Int32Array> {
  a: T; n = 0; private make: (n: number) => T;
  constructor(make: (n: number) => T, cap = 1024) { this.make = make; this.a = make(cap); }
  reserve(extra: number) {
    if (this.n + extra <= this.a.length) return;
    let cap = this.a.length * 2; while (cap < this.n + extra) cap *= 2;
    const b = this.make(cap); (b as any).set(this.a.subarray(0, this.n)); this.a = b;
  }
  push(v: number) { this.reserve(1); this.a[this.n++] = v; }
}

export class HammerSim {
  readonly P: HammerParams;
  readonly C: Container;
  readonly mounts: Mount[];
  /** ball radius (px) */
  readonly r: number;
  readonly cap: number;
  /** rest offset of each head centre from its mount, full reach (extension at the stop) and head half-length */
  readonly rest: number[]; readonly reach: number[]; readonly half: number[]; private halfTab: Float64Array[];
  /** box rule: distance from the centre to each closed head's face */
  readonly boxB: number;

  // ---- live state ----
  private px: Float64Array; private py: Float64Array; private vx: Float64Array; private vy: Float64Array;
  private col: Uint8Array; private age: Uint16Array; private cool: Float64Array;
  n = 0;
  private rnd: () => number;
  private grid: DiscGrid;
  private ext: Float64Array;       // current extension of each hammer
  private extPrev: Float64Array;
  private strike = { t0: -1, t1: 0, wind: 0, ext: 0, hold: 0, ret: 0, mask: 0, next: 0.9, count: 0, slammed: 0 };
  private t = 0;
  private boxOpen = true;
  fullAt = -1; clearedAt = -1;
  crushes = 0; spawns = 0; strikes = 0; maxN = 0;

  // ---- recording ----
  /** number of frames recorded (frames 0..done-1 are available) */
  done = 0;
  private fStart = new Grow(n => new Int32Array(n));   // per frame: index of its first ball in xy/c/ag
  private xy = new Grow(n => new Int16Array(n));
  private c = new Grow(n => new Uint8Array(n));
  private ag = new Grow(n => new Uint8Array(n));
  private hs = new Grow(n => new Float32Array(n));      // per frame: extension of 4 hammers
  private eStart = new Grow(n => new Int32Array(n));
  private eType = new Grow(n => new Uint8Array(n));
  private eX = new Grow(n => new Float32Array(n)); private eY = new Grow(n => new Float32Array(n));
  private eA = new Grow(n => new Float32Array(n)); private eB = new Grow(n => new Int32Array(n));
  // per-frame strongest collision candidates (for sound), fixed size, no allocation
  private topWall = new Float64Array(4 * 4); private topBall = new Float64Array(3 * 4);

  constructor(P: HammerParams) {
    this.P = P;
    this.C = makeContainer(P.container, CX, CY, BOX_W, BOX_H);
    this.mounts = mountsOf(this.C);
    // radius: `capacity` balls fill ~52 % of the floor area
    const area = containerArea(this.C);
    this.cap = Math.max(1, Math.round(P.capacity));
    this.r = Math.min(34, Math.max(3, Math.sqrt((0.52 * area) / (Math.PI * this.cap)) * P.ballScale));
    const r = this.r, capAll = this.cap + 16;
    this.px = new Float64Array(capAll); this.py = new Float64Array(capAll); this.vx = new Float64Array(capAll); this.vy = new Float64Array(capAll);
    this.col = new Uint8Array(capAll); this.age = new Uint16Array(capAll); this.cool = new Float64Array(capAll);
    this.grid = new DiscGrid({ x0: CX - BOX_W / 2 - 4 * r, y0: CY - BOX_H / 2 - 4 * r, w: BOX_W + 8 * r, h: BOX_H + 8 * r, cell: 2 * r + 0.5, capacity: capAll });
    this.rnd = mulberry32(P.seed >>> 0 || 1);
    const M = this.mounts.length;
    this.ext = new Float64Array(4); this.extPrev = new Float64Array(4);
    // box: heads stop at distance b from the centre (b also clears a ring's inner circle)
    let b = P.boxSize * this.C.R * 0.55;
    if (this.C.rin > 0) b = Math.max(b, this.C.rin + 2.6 * r + HEAD_RAD);
    b = Math.max(b, 3 * r + HEAD_RAD);
    this.boxB = b;
    this.rest = []; this.reach = []; this.half = []; this.halfTab = [];
    const curved = !this.C.edges.length;
    for (let j = 0; j < M; j++) {
      const m = this.mounts[j], rest = HEAD_RAD + 3;
      this.rest.push(rest);
      // how far the head centre can travel before meeting the far wall (ray along the travel direction)
      let far = 0;
      for (let d = 4; d < 2.2 * this.C.R; d += 2) if (this.C.inside(m.x + m.dx * (rest + d), m.y + m.dy * (rest + d)) < 0) { far = d; break; }
      let halfMax: number;
      if (P.rule === 'box') {
        const toC = (this.C.cx - (m.x + m.dx * rest)) * m.dx + (this.C.cy - (m.y + m.dy * rest)) * m.dy;
        halfMax = (b + HEAD_RAD) * (dsin(Math.PI / M) / dcos(Math.PI / M)) + HEAD_RAD;
        this.reach.push(toC - b - HEAD_RAD);
      } else {
        halfMax = Math.min(this.C.R * (curved ? 0.2 : 0.26), 150);
        // stop with the head face 0.9 r from the far wall: a ball caught there is squeezed to 45 % of its size
        this.reach.push(Math.max(0, far - HEAD_RAD - 0.9 * r));
      }
      this.half.push(halfMax);
      // telescopic head: at each extension the head is as long as fits between the side walls (table every 2 px)
      const tab = new Float64Array(Math.ceil(Math.max(0, this.reach[j]) / 2) + 3);
      for (let k = 0; k < tab.length; k++) {
        const e = Math.min(k * 2, this.reach[j]), hx = m.x + m.dx * (rest + e), hy = m.y + m.dy * (rest + e);
        let lo = 0, hi = halfMax;
        for (let it = 0; it < 24; it++) {
          const h = (lo + hi) / 2;
          let ok = true;
          for (let q = -4; q <= 4 && ok; q++) { if (q === 0) continue; if (this.C.inside(hx - m.dy * h * (q / 4), hy + m.dx * h * (q / 4)) < HEAD_RAD * 0.6) ok = false; }
          if (ok) lo = h; else hi = h;
        }
        tab[k] = Math.max(Math.min(halfMax, 1.2 * r), lo);
      }
      this.halfTab.push(tab);
    }
    // starting balls: random spots (seeded), away from walls and from each other
    const n0 = Math.max(1, Math.min(this.cap, Math.round(P.startBalls)));
    for (let i = 0; i < n0; i++) {
      let x = CX, y = CY;
      for (let tries = 0; tries < 200; tries++) {
        x = CX + (this.rnd() - 0.5) * BOX_W * 0.7; y = CY + (this.rnd() - 0.5) * BOX_H * 0.7;
        if (this.C.inside(x, y) < 3 * r) continue;
        let clear = true; for (let k = 0; k < this.n; k++) { const dx = this.px[k] - x, dy = this.py[k] - y; if (dx * dx + dy * dy < 9 * r * r) { clear = false; break; } }
        if (clear) break;
      }
      const a = this.rnd() * 2 * Math.PI;
      const k = this.add(x, y, P.speed * dirX(a), P.speed * dirY(a), Math.floor(this.rnd() * NCOL));
      this.age[k] = 1000; // already there: no pop-in
    }
    this.maxN = this.n;
    this.record(); // frame 0
  }

  // ---------------- public read API ----------------
  /** simulate until frame f is recorded (clamped to the end frame) */
  ensure(f: number) { const last = Math.min(f, this.P.endFrame); while (this.done <= last) { this.stepFrame(); this.record(); } }
  get complete() { return this.done > this.P.endFrame; }
  countAt(f: number) { this.ensure(f); f = Math.min(f, this.done - 1); return this.fStart.a[f + 1] - this.fStart.a[f]; }
  /** balls of frame f: indices [start, end) into xy (x,y pairs, 1/8 px), colour and age arrays */
  ballsAt(f: number) { this.ensure(f); f = Math.min(f, this.done - 1); return { start: this.fStart.a[f], end: this.fStart.a[f + 1], xy: this.xy.a, col: this.c.a, age: this.ag.a, q: Q }; }
  /** head half-length of hammer j at extension e (telescopic: it never pokes through a wall) */
  halfAt(j: number, e: number) { const t = this.halfTab[j], k = Math.max(0, e) / 2, i = Math.min(t.length - 2, Math.floor(k)), u = Math.min(1, k - i); return t[i] + (t[i + 1] - t[i]) * u; }
  hammerAt(f: number, j: number) { this.ensure(f); f = Math.min(f, this.done - 1); return this.hs.a[f * 4 + j]; }
  /** visit the events of frame f */
  eventsAt(f: number, fn: (type: number, x: number, y: number, a: number, b: number) => void) {
    this.ensure(f); if (f >= this.done) return;
    for (let e = this.eStart.a[f]; e < this.eStart.a[f + 1]; e++) fn(this.eType.a[e], this.eX.a[e], this.eY.a[e], this.eA.a[e], this.eB.a[e]);
  }
  /** state vector of frame f (for parity hashing): exact quantised positions + hammer extensions */
  stateAt(f: number): number[] {
    const b = this.ballsAt(f), v: number[] = [];
    for (let i = b.start; i < b.end; i++) v.push(b.xy[2 * i], b.xy[2 * i + 1], b.col[i]);
    for (let j = 0; j < 4; j++) v.push(this.hammerAt(f, j));
    return v;
  }

  // ---------------- simulation ----------------
  private add(x: number, y: number, vx: number, vy: number, c: number) {
    const i = this.n++; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.col[i] = c % NCOL; this.age[i] = 0; this.cool[i] = 0.4;
    return i;
  }
  private remove(i: number) {
    const l = --this.n;
    if (i !== l) { this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.col[i] = this.col[l]; this.age[i] = this.age[l]; this.cool[i] = this.cool[l]; }
  }

  /** interval between strikes at time t (shrinks toward interval / speedUp at the end) */
  private intervalAt(t: number) {
    const P = this.P, tEnd = P.endFrame / P.fps, u = Math.min(1, t / Math.max(1, tEnd));
    return P.interval / (1 + (P.speedUp - 1) * u);
  }

  private planStrike(t: number) {
    const s = this.strike, P = this.P, I = this.intervalAt(t), M = this.mounts.length;
    s.t0 = t; s.wind = 0.1 * I; s.ext = Math.max(0.16, 0.34 * I);
    s.hold = P.rule === 'box' ? Math.max(0.6, 0.55 * I) : Math.max(0.05, 0.05 * I);
    s.ret = Math.max(0.2, 0.3 * I);
    s.t1 = t + s.wind + s.ext + s.hold + s.ret;
    s.next = t + Math.max(I, s.t1 - t + 0.08);
    if (P.rule === 'box') s.mask = (1 << M) - 1;
    else {
      // the installed hammers are the first `hammers` mounts. Each strike goes to the hammer whose path holds
      // the most balls (seeded tie-break), never the same one twice in a row when there is a choice.
      const H = Math.max(1, Math.min(P.hammers, M));
      let j = Math.floor(this.rnd() * H), best = -1;
      if (H > 1) {
        for (let q = 0; q < H; q++) {
          const c = (j + q) % H; if ((1 << c) === s.mask) continue;
          const m = this.mounts[c], half = this.half[c];
          let score = 0;
          for (let i = 0; i < this.n; i++) {
            const lat = (this.px[i] - m.x) * -m.dy + (this.py[i] - m.y) * m.dx;
            if (lat > -half && lat < half) score++;
          }
          if (score > best) { best = score; j = c; }
        }
      }
      s.mask = 1 << j;
    }
    s.count++; s.slammed = 0; this.strikes++;
    this.ev(Ev.Strike, 0, 0, I, s.mask);
  }

  /** extension of hammer j at time t */
  private extAt(j: number, t: number) {
    const s = this.strike; if (s.t0 < 0 || !(s.mask & (1 << j)) || t >= s.t1) return 0;
    const R = this.reach[j], wb = Math.min(18, 0.03 * R);
    let u = t - s.t0;
    if (u < s.wind) { const k = u / s.wind; return -wb * k * (2 - k); }
    u -= s.wind;
    if (u < s.ext) { const k = u / s.ext; return -wb + (R + wb) * k * k * k; } // accelerating slam
    u -= s.ext;
    if (u < s.hold) return R;
    u -= s.hold;
    const k = u / s.ret; return R * (1 - k) * (1 - k);
  }

  // event buffer for the frame being stepped
  private ev(type: number, x: number, y: number, a: number, b: number) {
    this.eType.push(type); this.eX.push(x); this.eY.push(y); this.eA.push(a); this.eB.push(b);
  }
  private keepTop(buf: Float64Array, k: number, x: number, y: number, a: number, b: number) {
    // buf holds k slots of (a, x, y, b); replace the weakest if this one is stronger
    let w = 0; for (let s = 1; s < k; s++) if (buf[s * 4] < buf[w * 4]) w = s;
    if (a > buf[w * 4]) { buf[w * 4] = a; buf[w * 4 + 1] = x; buf[w * 4 + 2] = y; buf[w * 4 + 3] = b; }
  }

  private stepFrame() {
    const P = this.P, fps = P.fps, dt0 = 1 / fps;
    const frame = this.done; // the frame being produced
    this.topWall.fill(0); this.topBall.fill(0);
    if (this.t >= this.strike.next && this.clearedAt < 0) this.planStrike(this.t);
    // sub-steps: enough that a head never moves more than ~0.8 r per step (no tunnelling)
    let travel = 0;
    for (let j = 0; j < this.mounts.length; j++) travel = Math.max(travel, Math.abs(this.extAt(j, this.t + dt0) - this.extAt(j, this.t)));
    const sub = Math.min(12, Math.max(2, Math.ceil(travel / (0.8 * this.r))));
    const dt = dt0 / sub;
    for (let s = 0; s < sub; s++) this.substep(this.t + s * dt, dt);
    this.t = (frame) / fps; // exact frame time (no drift)
    // emit the strongest collisions of this frame
    for (let k = 0; k < 4; k++) if (this.topWall[k * 4] > 0) this.ev(Ev.Wall, this.topWall[k * 4 + 1], this.topWall[k * 4 + 2], this.topWall[k * 4], this.topWall[k * 4 + 3]);
    for (let k = 0; k < 3; k++) if (this.topBall[k * 4] > 0) this.ev(Ev.Ball, this.topBall[k * 4 + 1], this.topBall[k * 4 + 2], this.topBall[k * 4], this.topBall[k * 4 + 3]);
    for (let i = 0; i < this.n; i++) if (this.age[i] < 65000) this.age[i]++;
    if (this.n > this.maxN) this.maxN = this.n;
    if (this.fullAt < 0 && this.n >= this.cap) { this.fullAt = this.t; this.ev(Ev.Full, CX, CY, this.n, 0); }
    if (this.clearedAt < 0 && this.n === 0) { this.clearedAt = this.t; this.ev(Ev.Cleared, CX, CY, 0, 0); }
  }

  private substep(t: number, dt: number) {
    const P = this.P, r = this.r, n0 = this.n, M = this.mounts.length;
    const { px, py, vx, vy } = this;
    // hammers: kinematic positions at t+dt
    for (let j = 0; j < M; j++) { this.extPrev[j] = this.ext[j]; this.ext[j] = this.extAt(j, t + dt); }
    // 1) integrate
    const g = P.gravity, v0 = P.speed;
    for (let i = 0; i < n0; i++) {
      vy[i] += g * dt;
      if (g === 0) { // keep the balls lively: relax speed toward v0
        const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        if (sp > 1e-6) { const k = 1 + 0.6 * dt * (v0 / sp - 1); vx[i] *= k; vy[i] *= k; }
        else { vx[i] = v0; }
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;
      this.cool[i] -= dt;
    }
    // 2) hammers push balls (swept: anything in front of the old head line ends up in front of the new one)
    for (let j = 0; j < M; j++) this.pushByHammer(j, dt);
    // 3) ball-ball
    this.grid.build(px, py, this.n);
    this.grid.pairs(this.pairFn);
    // 4) walls
    const C = this.C, eW = g > 0 ? 0.82 : 1;
    for (let i = 0; i < this.n; i++) this.wall(i, C, eW);
    // 5) rules: crushing / box bounces / lucky bounces
    if (P.rule !== 'box') this.crushCheck();
    else this.boxCheck();
  }

  private pairFn = (i: number, j: number) => {
    const { px, py, vx, vy } = this, r2 = 2 * this.r;
    const dx = px[j] - px[i], dy = py[j] - py[i], d2 = dx * dx + dy * dy;
    if (d2 >= r2 * r2 || d2 === 0) return;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = (r2 - d) * 0.5;
    px[i] -= nx * over; py[i] -= ny * over; px[j] += nx * over; py[j] += ny * over;
    const rv = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
    if (rv < 0) {
      const e = this.P.gravity > 0 ? 0.85 : 0.98, imp = -(1 + e) * rv * 0.5;
      vx[i] -= imp * nx; vy[i] -= imp * ny; vx[j] += imp * nx; vy[j] += imp * ny;
      if (-rv > 120) this.keepTop(this.topBall, 3, (px[i] + px[j]) / 2, (py[i] + py[j]) / 2, -rv, this.col[i]);
    }
  };

  private wall(i: number, C: Container, e: number) {
    const { px, py, vx, vy } = this, r = this.r;
    if (C.edges.length) {
      for (let k = 0; k < C.edges.length; k++) {
        const E = C.edges[k], d = E.nx * px[i] + E.ny * py[i] - E.c;
        if (d < r) {
          px[i] += E.nx * (r - d); py[i] += E.ny * (r - d);
          const vn = vx[i] * E.nx + vy[i] * E.ny;
          if (vn < 0) { vx[i] -= (1 + e) * vn * E.nx; vy[i] -= (1 + e) * vn * E.ny; this.wallHit(i, -vn); }
        }
      }
      return;
    }
    const dx = px[i] - C.cx, dy = py[i] - C.cy, d = Math.sqrt(dx * dx + dy * dy) || 1e-9, ux = dx / d, uy = dy / d;
    if (d > C.R - r) {
      px[i] = C.cx + ux * (C.R - r); py[i] = C.cy + uy * (C.R - r);
      const vn = vx[i] * ux + vy[i] * uy; // outward
      if (vn > 0) { vx[i] -= (1 + e) * vn * ux; vy[i] -= (1 + e) * vn * uy; this.wallHit(i, vn); }
    }
    if (C.rin > 0 && d < C.rin + r) {
      px[i] = C.cx + ux * (C.rin + r); py[i] = C.cy + uy * (C.rin + r);
      const vn = vx[i] * ux + vy[i] * uy;
      if (vn < 0) { vx[i] -= (1 + e) * vn * ux; vy[i] -= (1 + e) * vn * uy; this.wallHit(i, -vn); }
    }
  }

  private wallHit(i: number, speed: number) {
    if (speed > 60) this.keepTop(this.topWall, 4, this.px[i], this.py[i], speed, this.col[i]);
    // survive: a lucky bounce off the wall clones the ball
    if (this.P.rule === 'survive' && speed > 80 && this.cool[i] <= 0 && this.n < this.cap) {
      this.cool[i] = 0.8;
      if (this.rnd() < this.P.bonus) {
        const a = this.rnd() * 2 * Math.PI, k = this.add(this.px[i], this.py[i], this.P.speed * dirX(a), this.P.speed * dirY(a), this.col[i] + 1);
        this.cool[k] = 1.2; this.spawns++;
        this.ev(Ev.Spawn, this.px[i], this.py[i], this.n, this.col[k]);
      }
    }
  }

  /** hammer j (head capsule + rod) pushes balls; moving head = moving wall */
  private pushByHammer(j: number, dt: number) {
    const m = this.mounts[j], e1 = this.ext[j], e0 = this.extPrev[j];
    if (e1 <= 0 && e0 <= 0) return; // fully retracted: the head sits in the wall slot
    const r = this.r, half = this.halfAt(j, e1), rest = this.rest[j];
    const dx = m.dx, dy = m.dy, tx = -dy, ty = dx;
    const hx = m.x + dx * (rest + e1), hy = m.y + dy * (rest + e1);           // head centre now
    const hx0 = m.x + dx * (rest + e0), hy0 = m.y + dy * (rest + e0);         // head centre before
    const vh = (e1 - e0) / dt, R = HEAD_RAD + r;
    const { px, py, vx, vy } = this;
    for (let i = 0; i < this.n; i++) {
      const lx = (px[i] - hx) * tx + (py[i] - hy) * ty;          // along the head
      const lat = lx < -half ? -half : lx > half ? half : lx;
      const cx = hx + tx * lat, cy = hy + ty * lat;               // closest point on the head segment
      const depth0 = (px[i] - hx0) * dx + (py[i] - hy0) * dy;     // signed distance in front of the OLD head line
      if (Math.abs(lx) <= half + r && depth0 >= 0) {
        // ball was in front: keep it in front of the new face
        const depth = (px[i] - hx) * dx + (py[i] - hy) * dy;
        if (Math.abs(lx) <= half && depth < R) {
          px[i] += dx * (R - depth); py[i] += dy * (R - depth);
          const vn = vx[i] * dx + vy[i] * dy;
          if (vn < vh) { const nv = vh + 0.9 * (vh - vn); vx[i] += dx * (nv - vn); vy[i] += dy * (nv - vn); clampV(this, i); }
          continue;
        }
      }
      // generic capsule contact (sides, back, rounded ends)
      let ox = px[i] - cx, oy = py[i] - cy; const d2 = ox * ox + oy * oy;
      if (d2 < R * R) {
        let d = Math.sqrt(d2); if (d < 1e-9) { ox = -dx; oy = -dy; d = 1; }
        const nx = ox / d, ny = oy / d;
        px[i] = cx + nx * R; py[i] = cy + ny * R;
        const vrel = (vx[i] - dx * vh) * nx + (vy[i] - dy * vh) * ny;
        if (vrel < 0) { vx[i] -= 1.9 * vrel * nx; vy[i] -= 1.9 * vrel * ny; clampV(this, i); }
      }
      // rod: segment from the mount to the head centre
      const along = (px[i] - m.x) * dx + (py[i] - m.y) * dy;
      if (along > 0 && along < rest + e1) {
        const side = (px[i] - m.x) * tx + (py[i] - m.y) * ty, Rr = ROD_RAD + r;
        if (Math.abs(side) < Rr) {
          const sgn = side < 0 ? -1 : 1; px[i] += tx * sgn * (Rr - Math.abs(side)); py[i] += ty * sgn * (Rr - Math.abs(side));
          const vs = vx[i] * tx + vy[i] * ty; if (vs * sgn < 0) { vx[i] -= 2 * vs * tx; vy[i] -= 2 * vs * ty; }
        }
      }
    }
  }

  /** split / survive: a ball still pressed into an advancing (or holding) head after the solve is crushed */
  private crushCheck() {
    const s = this.strike, P = this.P, r = this.r;
    for (let j = 0; j < this.mounts.length; j++) {
      if (!(s.mask & (1 << j)) || this.ext[j] < this.extPrev[j] - 1e-9 || this.ext[j] <= 0) continue;
      const m = this.mounts[j], e = this.ext[j], half = this.halfAt(j, e), rest = this.rest[j];
      const hx = m.x + m.dx * (rest + e), hy = m.y + m.dy * (rest + e), tx = -m.dy, ty = m.dx;
      if (!s.slammed && e >= this.reach[j] - 1e-6) { s.slammed = 1; this.ev(Ev.Slam, hx, hy, this.n / this.cap, j); }
      for (let i = this.n - 1; i >= 0; i--) {
        const lx = (this.px[i] - hx) * tx + (this.py[i] - hy) * ty;
        if (Math.abs(lx) > half) continue;
        const depth = (this.px[i] - hx) * m.dx + (this.py[i] - hy) * m.dy;
        if (depth < 0) continue;
        // crushed: still pressed 60 % of a radius into the face, or pinched between the face and a (curved) wall
        const pressed = depth <= HEAD_RAD + r * 0.4;
        const pinched = depth <= HEAD_RAD + r * 1.35 && e >= 0.9 * this.reach[j] && this.C.inside(this.px[i], this.py[i]) < r * 1.6;
        if (!pressed && !pinched) continue;
        const x = this.px[i], y = this.py[i], c = this.col[i];
        this.crushes++;
        this.remove(i);
        let born = 0;
        if (P.rule === 'split') {
          // the pieces pop out behind the head (the side it has just swept clear), spread along its length
          const k = Math.min(P.splitInto, this.cap - this.n);
          for (let q = 0; q < k; q++) {
            const f = k === 1 ? 0 : (q / (k - 1)) * 2 - 1, off = f * (half - r) * 0.85 + (f === 0 ? 0 : 0);
            let ox = hx - m.dx * (HEAD_RAD + r + 1.5) + tx * off, oy = hy - m.dy * (HEAD_RAD + r + 1.5) + ty * off;
            // keep clear of the rod
            const side = (ox - m.x) * tx + (oy - m.y) * ty;
            if (Math.abs(side) < ROD_RAD + r + 1) { const sg = q % 2 ? 1 : -1; ox += tx * sg * (ROD_RAD + r + 1); oy += ty * sg * (ROD_RAD + r + 1); }
            const a = this.rnd() * Math.PI - Math.PI / 2, sp = P.speed * (0.8 + 0.5 * this.rnd());
            // backwards (away from the head) with a sideways spread
            const bx = -m.dx * dirX(a) + tx * dirY(a), by = -m.dy * dirX(a) + ty * dirY(a);
            const k2 = this.add(ox, oy, bx * sp, by * sp, c + 1 + q);
            this.age[k2] = 0; born++;
          }
          this.spawns += born;
        }
        this.ev(Ev.Crush, x, y, this.n, c | (born << 8));
      }
    }
  }

  /** box: while every head is closed, each bounce off a head face from the inside adds a ball */
  private boxCheck() {
    const s = this.strike, M = this.mounts.length;
    let closed = s.t0 >= 0;
    for (let j = 0; j < M && closed; j++) if (this.ext[j] < this.reach[j] - 1e-6) closed = false;
    if (closed && this.boxOpen) { this.boxOpen = false; this.ev(Ev.BoxClosed, this.C.cx, this.C.cy, 0, 0); s.slammed = 1; this.ev(Ev.Slam, this.C.cx, this.C.cy, this.n / this.cap, -1); }
    if (!closed) { this.boxOpen = true; return; }
    const r = this.r, b = this.boxB, C = this.C;
    for (let i = 0, n0 = this.n; i < n0; i++) {
      if (this.cool[i] > 0 || !this.inBox(i, b + r)) continue;
      for (let j = 0; j < M; j++) {
        const m = this.mounts[j];
        // distance from the ball to head j's face, measured toward the centre
        const face = (this.px[i] - C.cx) * -m.dx + (this.py[i] - C.cy) * -m.dy; // = b means touching
        const vn = this.vx[i] * -m.dx + this.vy[i] * -m.dy;
        if (face > b - r - 1.5 && vn < -20) {
          this.cool[i] = 0.9;
          // the new ball appears outside the box, on a free spot of the arena (the box itself never overfills)
          if (this.n < this.cap) {
            for (let tries = 0; tries < 10; tries++) {
              const x = C.cx + (this.rnd() - 0.5) * BOX_W, y = C.cy + (this.rnd() - 0.5) * BOX_H;
              if (C.inside(x, y) < 2 * r || this.inBoxXY(x, y, b + 3 * r) || this.occupied(x, y)) continue;
              const a = this.rnd() * 2 * Math.PI, sp = this.P.speed;
              const k = this.add(x, y, sp * dirX(a), sp * dirY(a), this.col[i] + 1);
              this.cool[k] = 0.9; this.spawns++;
              this.ev(Ev.Spawn, x, y, this.n, this.col[k] | (1 << 8));
              this.ev(Ev.Ball, this.px[i], this.py[i], 400, this.col[i]); // the bounce that caused it
              break;
            }
          }
          break;
        }
      }
    }
  }
  private inBoxXY(x: number, y: number, b: number) {
    const C = this.C;
    for (let j = 0; j < this.mounts.length; j++) { const m = this.mounts[j]; if ((x - C.cx) * -m.dx + (y - C.cy) * -m.dy > b) return false; }
    return true;
  }
  /** any ball within 2r of (x, y)? (uses the grid built this sub-step) */
  private occupied(x: number, y: number) {
    const G = this.grid, r2 = 4 * this.r * this.r;
    const cx = Math.floor((x - G.x0) / G.cell), cy = Math.floor((y - G.y0) / G.cell);
    for (let yy = cy - 1; yy <= cy + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= G.cols || yy >= G.rows) continue;
      const c = yy * G.cols + xx;
      for (let a = G.cellStart[c]; a < G.cellStart[c + 1]; a++) { const i = G.order[a]; if (i >= this.n) continue; const dx = this.px[i] - x, dy = this.py[i] - y; if (dx * dx + dy * dy < r2) return true; }
    }
    return false;
  }
  private inBox(i: number, b: number) {
    const C = this.C;
    for (let j = 0; j < this.mounts.length; j++) { const m = this.mounts[j]; if ((this.px[i] - C.cx) * -m.dx + (this.py[i] - C.cy) * -m.dy > b) return false; }
    return true;
  }

  private record() {
    const n = this.n;
    if (this.done === 0) { this.fStart.push(0); this.eStart.push(0); }
    this.xy.reserve(2 * n); this.c.reserve(n); this.ag.reserve(n);
    for (let i = 0; i < n; i++) {
      this.xy.a[this.xy.n++] = Math.round(this.px[i] * Q); this.xy.a[this.xy.n++] = Math.round(this.py[i] * Q);
      this.c.a[this.c.n++] = this.col[i]; this.ag.a[this.ag.n++] = this.age[i] > 255 ? 255 : this.age[i];
    }
    this.fStart.push(this.c.n);
    for (let j = 0; j < 4; j++) this.hs.push(j < this.mounts.length ? this.ext[j] : 0);
    this.eStart.push(this.eType.n);
    this.done++;
  }

  /** bytes held by the recording (diagnostics) */
  bytes() { return this.xy.a.byteLength + this.c.a.byteLength + this.ag.a.byteLength + this.hs.a.byteLength + this.eType.a.byteLength * 18; }
}

function clampV(s: HammerSim, i: number) {
  const a = s as any, sp = Math.sqrt(a.vx[i] * a.vx[i] + a.vy[i] * a.vy[i]);
  if (sp > MAX_V) { const k = MAX_V / sp; a.vx[i] *= k; a.vy[i] *= k; }
}
function dirX(a: number) { return dcos(a); }
function dirY(a: number) { return dsin(a); }

export function containerArea(C: Container) {
  if (!C.verts.length) return Math.PI * (C.R * C.R - C.rin * C.rin);
  let A = 0; const v = C.verts;
  for (let k = 0; k < v.length; k += 2) { const j = (k + 2) % v.length; A += v[k] * v[j + 1] - v[j] * v[k + 1]; }
  return Math.abs(A) / 2;
}
function boxArea(b: number, sides: number) { return sides * b * b * (dsin(Math.PI / sides) / dcos(Math.PI / sides)); }
