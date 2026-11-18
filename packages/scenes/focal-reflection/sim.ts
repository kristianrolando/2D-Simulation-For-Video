// Event-driven simulation of point balls reflecting off conic mirrors. Pure and deterministic.
// The whole run is precomputed into piecewise-linear tracks, so the position of every ball at any
// simulation time is a lookup (the scene is seekable for ball positions; trails are incremental).
import { intersect, normalAt } from './geometry.ts';
import type { Layout } from './presets.ts';
import { TAU, dcos, dsin } from '../../core/index.ts';

export interface Seg { t0: number; x: number; y: number; dx: number; dy: number; c: number }
export interface Track { segs: Seg[]; end: number; endX: number; endY: number }
export type SimEvent =
  | { t: number; type: 'wall'; x: number; y: number; c: number }
  | { t: number; type: 'pass' | 'absorb'; target: number; x: number; y: number; count: number }
  | { t: number; type: 'wave'; n: number; count: number }
  | { t: number; type: 'final'; count: number; target: number };

export interface SimResult {
  tracks: Track[];
  events: SimEvent[];
  waves: { t: number; count: number }[];
  tFinal: number;
  speed: number;
  /** largest distance from the exact focus at a synchronised arrival, before snapping (px) */
  maxMissPx: number;
  /** spread of arrival times within a synchronised group (sim s) */
  maxSyncSpread: number;
  /** balls that left the mirrors without reaching a target (should be 0) */
  lost: number;
}

interface Live { id: number; x: number; y: number; dx: number; dy: number; t0: number; c: number; nextT: number; kind: 'wall' | 'target' | 'home' | 'none'; wall: number; target: number }

const TOL_PX = 1e-3;     // a straight path counts as passing a target if it comes this close
const SYNC_T = 1e-6;     // arrivals closer than this (sim s) are simultaneous

export function simulate(L: Layout, counts: number[], speed = 400): SimResult {
  const tracks: Track[] = [];
  const events: SimEvent[] = [];
  const waves: { t: number; count: number }[] = [];
  let live: Live[] = [];
  let maxMiss = 0, maxSpread = 0, wave = 0, tFinal = 0, lost = 0;

  function plan(b: Live) {
    // next wall
    let best = Infinity, wall = -1;
    for (let i = 0; i < L.walls.length; i++) { const s = intersect(L.walls[i], b.x, b.y, b.dx, b.dy); if (s < best) { best = s; wall = i; } }
    let kind: Live['kind'] = wall >= 0 ? 'wall' : 'none', target = -1;
    // next target passed before that wall
    for (let i = 0; i < L.targets.length; i++) {
      const T = L.targets[i];
      const s = (T.x - b.x) * b.dx + (T.y - b.y) * b.dy;
      if (!(s > 1e-6) || s >= best) continue;
      const mx = b.x + s * b.dx - T.x, my = b.y + s * b.dy - T.y;
      if (mx * mx + my * my <= TOL_PX * TOL_PX) { best = s; kind = 'target'; target = i; }
    }
    if (L.homeY !== undefined && b.dy < -1e-12) {
      const s = (L.homeY - b.y) / b.dy;
      if (s > 1e-6 && s < best) { best = s; kind = 'home'; }
    }
    if (kind === 'none') best = 4000; // escaped: let it fly off-screen
    b.nextT = b.t0 + best / speed; b.kind = kind; b.wall = wall; b.target = target;
  }
  function newSeg(b: Live) { tracks[b.id].segs.push({ t0: b.t0, x: b.x, y: b.y, dx: b.dx, dy: b.dy, c: b.c }); }
  function spawn(x: number, y: number, dx: number, dy: number, t: number, c: number, id = tracks.length): Live {
    if (id === tracks.length) tracks.push({ segs: [], end: Infinity, endX: 0, endY: 0 });
    const b: Live = { id, x, y, dx, dy, t0: t, c, nextT: 0, kind: 'none', wall: -1, target: -1 };
    newSeg(b); plan(b); return b;
  }
  function kill(b: Live, t: number) {
    const tr = tracks[b.id]; tr.end = t; tr.endX = b.x; tr.endY = b.y;
  }
  const move = (b: Live, t: number) => { const s = (t - b.t0) * speed; b.x += b.dx * s; b.y += b.dy * s; b.t0 = t; };

  function launchWave(t: number, at: number[] | null) {
    const N = counts[wave] * L.countScale;
    waves.push({ t, count: N });
    events.push({ t, type: 'wave', n: wave, count: N });
    if (L.mode === 'fan') {
      const fans = at ?? L.start ?? [0];
      const per = Math.max(1, Math.round(N / fans.length));
      const pool = live.slice(); live = [];
      fans.forEach((ti, fi) => {
        const T = L.targets[ti];
        for (let k = 0; k < per; k++) {
          const spread = T.spread ?? TAU, full = spread >= TAU - 1e-9;
          const ang = full ? (T.angle ?? 0) + (k * TAU) / per : (T.angle ?? 0) + spread * ((k + 0.5) / per - 0.5);
          const reuse = pool.find(b => Math.abs(b.x - T.x) < 1e-6 && Math.abs(b.y - T.y) < 1e-6);
          if (reuse) pool.splice(pool.indexOf(reuse), 1);
          const b = spawn(T.x, T.y, dcos(ang), dsin(ang), t, k / per, reuse ? reuse.id : tracks.length);
          live.push(b);
        }
      });
      for (const b of pool) kill(b, t); // (never happens with increasing sequences)
    } else {
      const d = L.drop!;
      for (let k = 0; k < N; k++) {
        const u = (k + 0.5) / N;
        let off: number;
        if (d.sides === 'both') { const m = 2 * (d.o1 - d.o0); const v = u * m; off = v < m / 2 ? -(d.o1 - v) : d.o0 + (v - m / 2); }
        else { off = N === 1 ? 0.4 * d.o1 : -d.o1 + 2 * d.o1 * u; if (Math.abs(off) < d.o0) off = d.o0; }
        live.push(spawn(L.cx + off, d.y + 1e-3, 0, 1, t, Math.abs(off) / d.o1));
      }
    }
  }

  launchWave(0, null);
  let guard = 0;
  while (live.length && guard++ < 5_000_000) {
    let t = Infinity;
    for (const b of live) if (b.nextT < t) t = b.nextT;
    // group simultaneous target arrivals (focus property => whole wave arrives together)
    const group = live.filter(b => b.kind === 'target' && b.nextT <= t + SYNC_T);
    if (group.length) {
      const tg = Math.max(...group.map(b => b.nextT)), t0g = Math.min(...group.map(b => b.nextT));
      maxSpread = Math.max(maxSpread, tg - t0g);
      const byTarget = new Map<number, Live[]>();
      for (const b of group) { move(b, b.nextT); const T = L.targets[b.target]; maxMiss = Math.max(maxMiss, Math.hypot(b.x - T.x, b.y - T.y)); b.x = T.x; b.y = T.y; b.t0 = tg; (byTarget.get(b.target) ?? byTarget.set(b.target, []).get(b.target)!).push(b); }
      const everyone = group.length === live.length;
      const allFan = everyone && [...byTarget.keys()].every(i => L.targets[i].role === 'fan');
      for (const [ti, bs] of byTarget) {
        const T = L.targets[ti];
        events.push({ t: tg, type: T.role === 'absorb' ? 'absorb' : 'pass', target: ti, x: T.x, y: T.y, count: bs.length });
        if (T.role === 'absorb') for (const b of bs) { kill(b, tg); live.splice(live.indexOf(b), 1); }
        else if (!allFan) for (const b of bs) { newSeg(b); plan(b); }
      }
      if (allFan) {
        if (wave + 1 < counts.length) { wave++; launchWave(tg, [...byTarget.keys()].sort((a, b) => a - b)); }
        else { tFinal = tg; events.push({ t: tg, type: 'final', count: live.length, target: [...byTarget.keys()][0] }); for (const b of live) kill(b, tg); live = []; }
      } else if (!live.length) {
        if (wave + 1 < counts.length) { wave++; launchWave(tg, null); }
        else { tFinal = tg; events.push({ t: tg, type: 'final', count: counts[wave] * L.countScale, target: L.targets.findIndex(x => x.role === 'absorb') }); }
      }
      continue;
    }
    const b = live.find(x => x.nextT === t)!;
    move(b, t);
    if (b.kind === 'wall') {
      const [nx, ny] = normalAt(L.walls[b.wall], b.x, b.y);
      const dot = b.dx * nx + b.dy * ny;
      b.dx -= 2 * dot * nx; b.dy -= 2 * dot * ny;
      const l = Math.sqrt(b.dx * b.dx + b.dy * b.dy); b.dx /= l; b.dy /= l;
      events.push({ t, type: 'wall', x: b.x, y: b.y, c: b.c });
      newSeg(b); plan(b);
    } else {
      // home line (retro-reflector) or escaped ball
      kill(b, t); live.splice(live.indexOf(b), 1);
      if (b.kind === 'home') events.push({ t, type: 'absorb', target: -1, x: b.x, y: b.y, count: 1 }); else lost++;
      if (!live.length) {
        if (wave + 1 < counts.length) { wave++; launchWave(t, null); }
        else { tFinal = t; events.push({ t, type: 'final', count: counts[wave] * L.countScale, target: -1 }); }
      }
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { tracks, events, waves, tFinal, speed, maxMissPx: maxMiss, maxSyncSpread: maxSpread, lost };
}

/** position of a track at sim time t (null if not alive). `hint` speeds up forward scans. */
export function trackPos(tr: Track, t: number, speed: number): { x: number; y: number; dx: number; dy: number; c: number; seg: number } | null {
  if (!tr.segs.length || t < tr.segs[0].t0 || t > tr.end) return null;
  let lo = 0, hi = tr.segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tr.segs[m].t0 <= t) lo = m; else hi = m - 1; }
  const s = tr.segs[lo], d = (t - s.t0) * speed;
  return { x: s.x + s.dx * d, y: s.y + s.dy * d, dx: s.dx, dy: s.dy, c: s.c, seg: lo };
}
