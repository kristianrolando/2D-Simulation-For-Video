// Calendar view of the upload schedule, pure: which video sits in which slot and in what state, and the month grid.
// Times are shown in WIB (UTC+7), the zone the slots are planned in. Reads data only; it never changes a plan or a video.
import { wibParts, wibInstant, type PlanSlot } from './schedule.ts';
import type { Video } from './index.ts';

export type CalState = 'planned' | 'uploading' | 'waiting' | 'scheduled' | 'published' | 'failed';
export const CAL_LABEL: Record<CalState, string> = { planned: 'Planned', uploading: 'Uploading', waiting: 'Waiting for quota', scheduled: 'Scheduled on YouTube', published: 'Published', failed: 'Upload failed' };
export interface CalEntry { ms: number; date: string; time: string; videoId: string; sceneId: string; title: string; state: CalState; inPlan: boolean; /** the channel the video is for (Photon Lab for older records) */ channel?: string; /** 'long' for a long video (the upload plan is for Shorts, so these only show with a date the owner entered) */ kind?: 'long' }
type V = Pick<Video, 'id' | 'sceneId' | 'title' | 'status' | 'scheduledAt' | 'publishedAt' | 'youtube'> & { kind?: 'long'; channel?: string };

/** What the owner should see for a slot: the studio's own record of the video wins over the plan file (it is what really happened). */
export function slotState(slot: Pick<PlanSlot, 'status'> | null, v: V | undefined): CalState {
  if (v?.status === 'published') return 'published';
  const y = v?.youtube;
  if (y) { if (y.stage === 'done') return 'scheduled'; if (y.stage === 'failed') return y.waitUntil ? 'waiting' : 'failed'; return 'uploading'; }
  if (v?.status === 'scheduled') return 'scheduled';
  if (!slot) return 'planned';
  return slot.status === 'uploaded' ? 'scheduled' : slot.status === 'failed' ? 'failed' : slot.status === 'uploading' ? 'uploading' : 'planned';
}
const at = (ms: number) => { const p = wibParts(ms); return { date: p.date, time: p.time }; };

/** every planned slot, plus videos the studio knows are scheduled or published at a time that is not in the plan; sorted by time */
export function calendarEntries(plan: { slots: PlanSlot[] } | null, videos: V[]): CalEntry[] {
  const byId = new Map(videos.map(v => [v.id, v])), out: CalEntry[] = [], used = new Set<string>();
  for (const s of plan?.slots ?? []) {
    const v = byId.get(s.videoId), ms = Date.parse(s.slot); if (Number.isNaN(ms)) continue;
    used.add(s.videoId);
    out.push({ ms, ...at(ms), videoId: s.videoId, sceneId: s.sceneId, title: v?.title || s.title, state: slotState(s, v), inPlan: true, channel: v?.channel || 'Photon Lab' });
  }
  for (const v of videos) {
    if (used.has(v.id) || (v.status !== 'scheduled' && v.status !== 'published')) continue;
    const ms = v.youtube?.publishAt ? Date.parse(v.youtube.publishAt) : v.scheduledAt ? Date.parse(v.scheduledAt + '+07:00') : NaN;   // scheduledAt is the Mac's local time, WIB here
    if (Number.isNaN(ms)) continue;
    out.push({ ms, ...at(ms), videoId: v.id, sceneId: v.sceneId, title: v.title, state: slotState(null, v), inPlan: false, channel: v.channel || 'Photon Lab', ...(v.kind === 'long' ? { kind: 'long' as const } : {}) });
  }
  return out.sort((a, b) => a.ms - b.ms);
}
export function groupByDay(entries: CalEntry[]): Map<string, CalEntry[]> {
  const m = new Map<string, CalEntry[]>(); for (const e of entries) (m.get(e.date) ?? m.set(e.date, []).get(e.date)!).push(e); return m;
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** the weeks (Monday first) that show a month: 'YYYY-MM-DD' strings, whole weeks, leading and trailing days of the next/previous month included */
export function monthWeeks(year: number, month1: number): string[][] {
  const first = Date.UTC(year, month1 - 1, 1), dow = (new Date(first).getUTCDay() + 6) % 7, days = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  const total = Math.ceil((dow + days) / 7) * 7, weeks: string[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(first + (i - dow) * 86400e3), s = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    if (i % 7 === 0) weeks.push([]); weeks.at(-1)!.push(s);
  }
  return weeks;
}
export const monthOf = (date: string) => date.slice(0, 7);
export const shiftMonth = (ym: string, by: number) => { const [y, m] = ym.split('-').map(Number), t = y * 12 + (m - 1) + by; return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`; };
/** which month to open first: today's if the schedule has something in or after it, else the first month with entries, else today's */
export function startMonth(entries: CalEntry[], now = Date.now()): string {
  const today = monthOf(wibParts(now).date); if (!entries.length) return today;
  const next = entries.find(e => e.ms >= wibInstant(wibParts(now).date, '00:00')); return next ? today : monthOf(entries[0].date);
}
