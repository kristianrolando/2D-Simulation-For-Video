// What the Videos list shows and every number around it, in ONE pure place (no DOM, no fetch): the rows for a set of filters, the counts on the
// format picker, the status chips and the channel menu, the channel cards and summary line, the "filters on" line, what is remembered, the
// bulk selection rules and the CSV of a selection. Unit-tested in Node (tests/videos-view.test.ts). It reads the video list and never changes anything.
//
// THE COUNTING RULE (documented in the README): a number on a chip or in the channel menu is the number of rows you would see if you clicked it,
// with every OTHER filter that is on (format, channel, status, search, simulation, style, "needs you") still applied. So channel + "no channel"
// always add up to All, and a chip never promises rows the list will not show. The channel cards and the summary line are different on purpose:
// they say what a channel holds in total (all formats, all statuses), whatever the other filters are.
import { filterVideos, STATUS_LABEL, STATUSES, type Video, type Status } from '../../packages/publish/index.ts';
import { inFormat, formatOf, NO_CHANNEL, channelKey, type Format } from './videos-nav.ts';

export interface ViewState { format: Format; channel: string; status: Status | 'all'; query: string; scene: string; style: string }
export const NO_VIEW: ViewState = { format: 'all', channel: '', status: 'all', query: '', scene: '', style: '' };
export interface ViewCtx { sceneName: (id: string) => string; styleName: (id: string) => string; /** the "needs you" shortcut (failed / uploading uploads), or none */ extra?: (v: Video) => boolean }

export { NO_CHANNEL, channelKey };

type Skip = 'format' | 'channel' | 'status' | undefined;
/** the rows for the filters; `skip` leaves one group out (to count what clicking a choice of that group would show) */
export function rows<T extends Video>(videos: T[], s: ViewState, ctx: ViewCtx, skip?: Skip): T[] {
  let out = videos;
  if (skip !== 'format') out = inFormat(out, s.format);
  if (skip !== 'channel' && s.channel) out = out.filter(v => channelKey(v) === s.channel);
  if (s.scene) out = out.filter(v => v.sceneId === s.scene);
  if (s.style) out = out.filter(v => v.style === s.style);
  out = filterVideos(out, { status: skip === 'status' ? 'all' : s.status, query: s.query }, { scene: ctx.sceneName, style: ctx.styleName });
  if (ctx.extra) out = out.filter(ctx.extra);
  return out;
}

export interface ChipCounts { formats: Record<Format, number>; statuses: Record<Status | 'all', number> }
/** the numbers on the format picker and the status chips: each one is what its click would show (see the rule at the top) */
export function chipCounts(videos: Video[], s: ViewState, ctx: ViewCtx): ChipCounts {
  const noFormat = rows(videos, s, ctx, 'format'), noStatus = rows(videos, s, ctx, 'status');
  const formats = { all: noFormat.length, shorts: noFormat.filter(v => formatOf(v) === 'shorts').length, long: noFormat.filter(v => formatOf(v) === 'long').length };
  const statuses = { all: noStatus.length, draft: 0, rendered: 0, scheduled: 0, published: 0 } as Record<Status | 'all', number>;
  for (const v of noStatus) statuses[v.status]++;
  return { formats, statuses };
}

export interface ChannelChoice { key: string; name: string; count: number; kind: 'connected' | 'manual' | 'tagged' | 'none' }
/** the channel menu: every channel the studio knows (connected, added by hand) plus any other name found on a video, and "No channel" when some
 *  video has none. `known` = names in the order they should appear. Counts follow the rule at the top (every other filter applies). */
export function channelChoices(videos: Video[], known: { name: string; kind: 'connected' | 'manual' }[], s: ViewState, ctx: ViewCtx): { all: number; choices: ChannelChoice[] } {
  const pool = rows(videos, s, ctx, 'channel'), n = new Map<string, number>();
  for (const v of pool) n.set(channelKey(v), (n.get(channelKey(v)) ?? 0) + 1);
  const tagged = new Set(videos.map(channelKey)); // a name on any video exists even when the filters hide it now
  const out: ChannelChoice[] = [], seen = new Set<string>();
  for (const k of known) if (!seen.has(k.name)) { seen.add(k.name); out.push({ key: k.name, name: k.name, count: n.get(k.name) ?? 0, kind: k.kind }); }
  for (const name of [...tagged].filter(x => x !== NO_CHANNEL && !seen.has(x)).sort((a, b) => a.localeCompare(b))) { seen.add(name); out.push({ key: name, name, count: n.get(name) ?? 0, kind: 'tagged' }); }
  if (tagged.has(NO_CHANNEL)) out.push({ key: NO_CHANNEL, name: 'No channel', count: n.get(NO_CHANNEL) ?? 0, kind: 'none' });
  return { all: pool.length, choices: out };
}
/** a remembered or linked channel that no longer exists falls back to All channels */
export function validChannel(channel: string, videos: Video[], known: { name: string }[]): string {
  if (!channel) return '';
  if (channel === NO_CHANNEL) return videos.some(v => channelKey(v) === NO_CHANNEL) ? channel : '';
  return known.some(k => k.name === channel) || videos.some(v => channelKey(v) === channel) ? channel : '';
}

export interface ChannelFacts { key: string; name: string; total: number; statuses: Record<Status, number>; shorts: number; long: number }
/** what one channel holds in total (all formats, all statuses); key '' = every video */
export function channelFacts(videos: Video[], key: string, name = key === '' ? 'All channels' : key === NO_CHANNEL ? 'No channel' : key): ChannelFacts {
  const mine = key ? videos.filter(v => channelKey(v) === key) : videos;
  const statuses = { draft: 0, rendered: 0, scheduled: 0, published: 0 } as Record<Status, number>;
  for (const v of mine) statuses[v.status]++;
  const long = mine.filter(v => formatOf(v) === 'long').length;
  return { key, name, total: mine.length, statuses, shorts: mine.length - long, long };
}
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
/** "Plasma Pendulum: 245 videos · 240 rendered · 5 scheduled · 0 published · 245 Shorts · 0 Long" */
export const summaryLine = (f: ChannelFacts) => `${f.name}: ${plural(f.total, 'video')} · ${STATUSES.filter(s => s !== 'draft' || f.statuses.draft).map(s => `${f.statuses[s].toLocaleString('en-US')} ${STATUS_LABEL[s].toLowerCase()}`).join(' · ')} · ${f.shorts.toLocaleString('en-US')} Shorts · ${f.long.toLocaleString('en-US')} Long`;
/** the cards of the channel strip: one per channel, then "No channel" when some video has none; the first card is "All" */
export function channelCards(videos: Video[], choices: ChannelChoice[]): ChannelFacts[] {
  return [channelFacts(videos, ''), ...choices.map(c => channelFacts(videos, c.key, c.name))];
}

// ---------------- the "filters on" line ----------------
export const hasActive = (s: ViewState, focus = '') => s.channel !== '' || s.status !== 'all' || s.query.trim() !== '' || s.scene !== '' || s.style !== '' || focus !== '';
/** "Channel: Plasma Pendulum · Rendered · search “hammer”" (the format picker is a view, not a filter, so it is not listed) */
export function activeLine(s: ViewState, ctx: ViewCtx, focus = ''): string {
  const parts: string[] = [];
  if (s.channel) parts.push(`Channel: ${s.channel === NO_CHANNEL ? 'No channel' : s.channel}`);
  if (s.status !== 'all') parts.push(STATUS_LABEL[s.status]);
  if (s.scene) parts.push(ctx.sceneName(s.scene));
  if (s.style) parts.push(ctx.styleName(s.style));
  if (s.query.trim()) parts.push(`search “${s.query.trim()}”`);
  if (focus) parts.push(focus === 'failed' ? 'upload failed' : 'uploading');
  return parts.join(' · ');
}

// ---------------- remembered filters (a Store that may throw or be missing: then nothing is remembered and nothing breaks) ----------------
export const VIEW_KEY = 'studio.vfilters';
export interface SavedStore { get(key: string): string | null; set(key: string, value: string): void }
export const saveView = (st: SavedStore, s: ViewState) => { try { st.set(VIEW_KEY, JSON.stringify({ channel: s.channel, status: s.status, query: s.query, scene: s.scene, style: s.style })); } catch { /* not remembered */ } };
/** what was remembered, checked: a damaged value, an unknown status or text of the wrong type gives the empty filter, never an error */
export function loadView(st: SavedStore): Pick<ViewState, 'channel' | 'status' | 'query' | 'scene' | 'style'> {
  const none = { channel: '', status: 'all' as const, query: '', scene: '', style: '' };
  try {
    const j = JSON.parse(st.get(VIEW_KEY) ?? 'null'); if (!j || typeof j !== 'object') return none;
    const t = (x: unknown, max = 200) => (typeof x === 'string' ? x.slice(0, max) : '');
    return { channel: t(j.channel, 80), status: (STATUSES as readonly string[]).includes(j.status) ? j.status : 'all', query: t(j.query), scene: t(j.scene, 80), style: t(j.style, 80) };
  } catch { return none; }
}

// ---------------- bulk selection and export ----------------
/** which of the chosen videos "Mark as uploaded manually" would change, and why the others are left alone (a scheduled or published video, or one
 *  with an upload record, is never touched) */
export function planBulkMark<T extends Video>(videos: T[], ids: string[]): { ok: T[]; skipped: { id: string; reason: string }[] } {
  const by = new Map(videos.map(v => [v.id, v])), ok: T[] = [], skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const v = by.get(id); if (!v) { skipped.push({ id, reason: 'not in the list' }); continue; }
    if (v.youtube) skipped.push({ id, reason: 'has an upload record' });
    else if (v.status === 'scheduled' || v.status === 'published') skipped.push({ id, reason: `already ${v.status}` });
    else if (v.status !== 'rendered') skipped.push({ id, reason: 'not rendered yet' });
    else ok.push(v);
  }
  return { ok, skipped };
}
const csvCell = (x: unknown) => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV of a selection for handing over or uploading by hand: number, id, title, description, tags, channel, status, video file, cover file
 *  (UTF-8 with BOM so a spreadsheet reads it right; quotes, commas and line breaks inside a cell are quoted) */
export function bulkCsv(videos: Video[]): string {
  const head = ['no', 'id', 'title', 'description', 'tags', 'channel', 'status', 'video_file', 'cover_file'];
  const body = videos.map((v, i) => [i + 1, v.id, v.title, v.description, v.tags.join('; '), v.channel || '', v.status, v.file, v.coverFile]);
  return '﻿' + [head, ...body].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
