// Upload schedule logic, pure (no files, no network): the WIB slots and the balanced, deterministic choice of which video goes where.
// WIB = UTC+7 all year (no daylight saving), so a slot is a fixed offset from UTC. YouTube receives `publishAt` as a UTC ISO string.
import { hash32, rng } from './copywriter.ts';
import { MIN_LEAD_MIN } from './index.ts';

/** Per day, in this order. The last one is midnight leading into the NEXT date. */
export const SLOTS_WIB = ['05:00', '06:30', '08:00', '19:30', '00:00'] as const;
export const WIB_OFFSET_H = 7;
const DAY = 86400e3;

const p2 = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' + 'HH:mm' in WIB → the instant (ms since epoch) */
export function wibInstant(ymd: string, hhmm: string): number {
  const [y, m, d] = ymd.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h - WIB_OFFSET_H, mi);
}
/** the WIB calendar date and clock of an instant */
export function wibParts(ms: number): { date: string; time: string } {
  const d = new Date(ms + WIB_OFFSET_H * 3600e3);
  return { date: `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`, time: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` };
}
const addDays = (ymd: string, n: number) => wibParts(wibInstant(ymd, '12:00') + n * DAY).date;

/** The slot's "day" as the owner counts it: 00:00 belongs to the day BEFORE its date (it is that day's last slot). */
export function slotDay(ms: number): string { const w = wibParts(ms); return w.time === '00:00' ? addDays(w.date, -1) : w.date; }

/** The next `count` free slots, in time order. A slot less than `minLeadMin` from `now` is not used, and neither is one in `taken` (instants, compared by minute). */
export function buildSlots(now: number, count: number, opts: { minLeadMin?: number; taken?: Iterable<number> } = {}): number[] {
  const lead = (opts.minLeadMin ?? MIN_LEAD_MIN) * 60e3, taken = new Set([...(opts.taken ?? [])].map(t => Math.round(t / 60e3)));
  const out: number[] = [];
  let day = addDays(wibParts(now).date, -1);              // yesterday's midnight slot can still be ahead
  while (out.length < count) {
    const list = SLOTS_WIB.map((s, i) => wibInstant(i === SLOTS_WIB.length - 1 ? addDays(day, 1) : day, s));
    for (const t of list) if (t >= now + lead && !taken.has(Math.round(t / 60e3)) && out.length < count) out.push(t);
    day = addDays(day, 1);
  }
  return out;
}

// ---------------- balanced choice ----------------
export interface Cand {
  id: string; sceneId: string;
  /** what the video looks like (container / style): no more than `maxLookRun` in a row share it */
  look: string;
  /** the structural variant (scene + rule/mode + container + objects): near-twins are not scheduled close together */
  group: string;
  /** the hook part of the title (before " — "): the same pattern is not used twice on one day */
  head: string;
}
export interface PickOptions { seed: number; maxLookRun?: number; twinWindow?: number }
export interface Placed { cand: Cand; slot: number; relaxed: string[] }
export interface PickResult { placed: Placed[]; reserve: Cand[] }

/** Fill `slots` (ascending instants) with the candidates. Rules, strictest first: never the same scene twice in a row (hard), a look
 *  at most `maxLookRun` times in a row, no near-twin (same group) within `twinWindow` slots, no title pattern twice in one day. A rule
 *  that cannot be met at some slot is relaxed there (and recorded); the scene rule is never relaxed: a video that could only go next to
 *  its own scene is left in `reserve`. Each scene's videos are spread over the whole horizon by their ideal position (so rare scenes
 *  are not bunched at the end), then the most overdue eligible video wins. Same input and seed → same result. */
export function pickBalanced(cands: Cand[], slots: number[], o: PickOptions): PickResult {
  const maxRun = o.maxLookRun ?? 2, window = o.twinWindow ?? 12, r = rng(hash32(`schedule|${o.seed}`));
  // per scene: seeded shuffle, then round-robin over variant groups so neighbours of one scene differ
  const byScene = new Map<string, Cand[]>();
  for (const c of [...cands].sort((a, b) => a.id < b.id ? -1 : 1)) (byScene.get(c.sceneId) ?? byScene.set(c.sceneId, []).get(c.sceneId)!).push(c);
  const order = new Map<string, Cand[]>();
  for (const [scene, list] of [...byScene].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const sh = [...list]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    const groups = new Map<string, Cand[]>(); for (const c of sh) (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push(c);
    const gl = [...groups.values()], rr: Cand[] = [];
    for (let k = 0; rr.length < sh.length; k++) for (const g of gl) if (k < g.length) rr.push(g[k]);
    order.set(scene, rr);
  }
  // A scene with more videos than all the others + 1 cannot be kept apart: its surplus (the last of its own order) is reserve from the start,
  // so the ideal positions below spread over the length that can really be filled (otherwise the rare scenes would all land early).
  const total = cands.length;
  const biggest = [...order].sort((a, b) => b[1].length - a[1].length)[0];
  const surplus = biggest ? Math.max(0, biggest[1].length - (total - biggest[1].length + 1)) : 0;
  const cut: Cand[] = surplus ? biggest![1].splice(biggest![1].length - surplus, surplus) : [];
  const N = Math.min(slots.length, total - surplus);
  type Q = { c: Cand; ideal: number };
  const pools = new Map<string, Q[]>();
  for (const [scene, rr] of order) {
    const step = N / rr.length;
    pools.set(scene, rr.map((c, k) => ({ c, ideal: (k + 0.5) * step + (r() - 0.5) * 0.3 * step })));
  }
  const placed: Placed[] = [];
  let prev: Cand | null = null, run = 0;
  const recentGroups: string[] = [], dayHeads = new Map<string, Set<string>>();
  for (let i = 0; i < N; i++) {
    const day = slotDay(slots[i]);
    const heads = dayHeads.get(day) ?? dayHeads.set(day, new Set()).get(day)!;
    let chosen: { q: Q; scene: string; relaxed: string[] } | null = null;
    for (const level of [0, 1, 2, 3]) {                // 0 = all rules; 1 = drop title pattern; 2 = also twins; 3 = also look run
      let best: { q: Q; scene: string } | null = null;
      for (const [scene, pool] of pools) {
        if (prev && prev.sceneId === scene) continue;
        for (const q of pool) {
          if (level < 1 && heads.has(q.c.head)) continue;
          if (level < 2 && recentGroups.slice(-window).includes(q.c.group)) continue;
          if (level < 3 && prev && prev.look === q.c.look && run >= maxRun) continue;
          if (!best || q.ideal < best.q.ideal) best = { q, scene };
          break;                                     // the first eligible of a scene is its next one
        }
      }
      if (best) { chosen = { ...best, relaxed: [level >= 1 ? 'title-pattern' : '', level >= 2 ? 'twin' : '', level >= 3 ? 'look-run' : ''].filter(Boolean) }; break; }
    }
    if (!chosen) break;                              // only the previous scene is left: stop, the rest is reserve
    const pool = pools.get(chosen.scene)!; pool.splice(pool.indexOf(chosen.q), 1); if (!pool.length) pools.delete(chosen.scene);
    placed.push({ cand: chosen.q.c, slot: slots[i], relaxed: chosen.relaxed });
    run = prev && prev.look === chosen.q.c.look ? run + 1 : 1; prev = chosen.q.c;
    recentGroups.push(chosen.q.c.group); heads.add(chosen.q.c.head);
  }
  const reserve = [...[...pools.values()].flat().sort((a, b) => a.ideal - b.ideal).map(q => q.c), ...cut];
  return { placed, reserve };
}

// ---------------- plan file (data/schedule.json) ----------------
export type SlotStatus = 'planned' | 'uploading' | 'uploaded' | 'failed';
export interface PlanSlot { slot: string; wib: string; videoId: string; sceneId: string; title: string; status: SlotStatus; youtubeId?: string; error?: string; updatedAt?: string; relaxed?: string[] }
export interface SchedulePlan { version: 1; createdAt: string; seed: number; timezone: 'WIB (UTC+7)'; slotsWib: string[]; slots: PlanSlot[]; skipped: { id: string; file: string; reason: string }[]; reserve: { id: string; sceneId: string; title: string; reason: string }[] }

/** the slots that may still be uploaded: planned ones only; a slot that is uploading, uploaded or failed is never started again by itself */
export const nextToUpload = (plan: SchedulePlan, now: number, minLeadMin = MIN_LEAD_MIN) =>
  plan.slots.filter(s => s.status === 'planned' && Date.parse(s.slot) >= now + minLeadMin * 60e3);
/** mark a slot; refuses to move an uploaded slot back (idempotent: running again never uploads twice) */
export function markSlot(plan: SchedulePlan, videoId: string, status: SlotStatus, extra: Partial<PlanSlot> = {}, now = new Date()): SchedulePlan {
  const slots = plan.slots.map(s => {
    if (s.videoId !== videoId) return s;
    if (s.status === 'uploaded' && status !== 'uploaded') return s;
    return { ...s, ...extra, status, updatedAt: now.toISOString() };
  });
  return { ...plan, slots };
}
