// Videos page navigation (pure parts): the Shorts / Long format and its counts, the address, remembered choices, the "renders not in the
// list" banner and its dismissal, sorting, filters and the calendar input per format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVideo, type Video } from '../packages/publish/index.ts';
import { calendarEntries } from '../packages/publish/calendar.ts';
import {
  FORMATS, formatOf, inFormat, formatCounts, statusCountsIn, parseHash, formatHash, readFormat, writeFormat, startNav, filesSig, bannerVisible, dismissBanner, readDismissed,
  sortVideos, readSort, hasFilters, NO_FILTERS, filterBy, optionsOf, calendarInput, CALENDAR_NOTE, bannerText, addConfirmText, FORMAT_KEY, type Store, type Format,
} from '../apps/studio/videos-nav.ts';

let n = 0;
const vid = (o: Record<string, unknown> = {}): Video => sanitizeVideo({ id: `v-nav${++n}`, title: `T${n}`, sceneId: 'hammer-smash', style: 'classic', status: 'rendered', file: `f${n}.mp4`, createdAt: new Date(2026, 10, 1, 0, 0, n).toISOString(), updatedAt: new Date(2026, 10, 1, 0, 0, n).toISOString(), ...o })!;
const LIB: Video[] = [
  vid({ status: 'published' }), vid({ status: 'scheduled' }), vid({ status: 'rendered' }), vid({ status: 'draft' }), vid({ status: 'rendered', sceneId: 'sync-lines' }),
  vid({ kind: 'long', sceneId: 'compilation', status: 'rendered' }), vid({ kind: 'long', sceneId: 'compilation', status: 'scheduled', scheduledAt: '2026-12-01T10:00' }),
];
const memory = (init: Record<string, string> = {}): Store & { data: Record<string, string> } => { const data = { ...init }; return { data, get: k => data[k] ?? null, set: (k, v) => { data[k] = v; } }; };
const broken: Store = { get() { throw new Error('storage blocked'); }, set() { throw new Error('storage blocked'); } };

test('format: Shorts + Long is always All; counts and status chips are per format', () => {
  assert.deepEqual(formatCounts(LIB), { all: 7, shorts: 5, long: 2 });
  assert.equal(formatCounts(LIB).shorts + formatCounts(LIB).long, formatCounts(LIB).all);
  assert.deepEqual(formatCounts([]), { all: 0, shorts: 0, long: 0 });
  assert.equal(formatOf(vid()), 'shorts', 'a record without a kind is a Short (older lists)'); assert.equal(formatOf(vid({ kind: 'long' })), 'long');
  assert.equal(inFormat(LIB, 'all').length, 7); assert.equal(inFormat(LIB, 'shorts').length, 5); assert.equal(inFormat(LIB, 'long').length, 2);
  assert.ok(inFormat(LIB, 'shorts').every(v => v.kind !== 'long') && inFormat(LIB, 'long').every(v => v.kind === 'long'));
  const all = statusCountsIn(LIB, 'all'), sh = statusCountsIn(LIB, 'shorts'), lg = statusCountsIn(LIB, 'long');
  assert.deepEqual([sh.all, sh.draft, sh.rendered, sh.scheduled, sh.published], [5, 1, 2, 1, 1]); assert.deepEqual([lg.all, lg.draft, lg.rendered, lg.scheduled, lg.published], [2, 0, 1, 1, 0]);
  for (const k of ['all', 'draft', 'rendered', 'scheduled', 'published'] as const) assert.equal(sh[k] + lg[k], all[k], `chip ${k}: Shorts + Long = All`);
});

test('address: parse and write #videos/<format>/<mode>, ignore other addresses', () => {
  assert.deepEqual(parseHash('#videos'), {}); assert.deepEqual(parseHash('#videos/long'), { format: 'long' }); assert.deepEqual(parseHash('#videos/shorts/calendar'), { format: 'shorts', mode: 'calendar' });
  assert.deepEqual(parseHash('#videos/long/build'), { format: 'long', mode: 'build' }); assert.deepEqual(parseHash('#videos/calendar'), { mode: 'calendar' }); assert.deepEqual(parseHash('#videos/nonsense/x'), {});
  assert.equal(parseHash(''), null); assert.equal(parseHash('#other'), null); assert.equal(parseHash('#videosx'), null);
  for (const format of FORMATS) for (const mode of ['list', 'calendar', 'build'] as const) assert.deepEqual(parseHash(formatHash({ format, mode })), { format, mode: mode === 'list' ? undefined : mode }.mode ? { format, mode } : { format });
  assert.equal(formatHash({ format: 'long', mode: 'list' }), '#videos/long'); assert.equal(formatHash({ format: 'all', mode: 'build' }), '#videos/all/build');
});

test('remembered format: the address wins, then what was remembered, then All; blocked storage never breaks anything', () => {
  const s = memory(); assert.equal(readFormat(s), 'all'); writeFormat(s, 'long'); assert.equal(s.data[FORMAT_KEY], 'long'); assert.equal(readFormat(s), 'long');
  assert.deepEqual(startNav('', s), { format: 'long', mode: 'list' }); assert.deepEqual(startNav('#videos/shorts/calendar', s), { format: 'shorts', mode: 'calendar' }); assert.deepEqual(startNav('#videos', s), { format: 'long', mode: 'list' });
  assert.equal(readFormat(memory({ [FORMAT_KEY]: 'garbage' })), 'all', 'an unknown stored value is ignored');
  assert.equal(readFormat(broken), 'all'); assert.doesNotThrow(() => writeFormat(broken, 'long')); assert.deepEqual(startNav('#videos/long', broken), { format: 'long', mode: 'list' });
  assert.equal(readSort(broken), 'newest'); assert.equal(readSort(memory({ 'studio.vsort': 'title' })), 'title'); assert.equal(readSort(memory({ 'studio.vsort': 'x' })), 'newest');
});

test('banner: hidden when dismissed for this very list of files, back when the list changes, never on Long, in a calendar or read-only', () => {
  const files = ['b.mp4', 'a.mp4'], s = memory();
  assert.equal(filesSig(files), filesSig(['a.mp4', 'b.mp4']), 'the order does not matter'); assert.notEqual(filesSig(files), filesSig(['a.mp4'])); assert.equal(filesSig([]), '');
  const show = (o: Partial<Parameters<typeof bannerVisible>[0]> = {}) => bannerVisible({ files, dismissedSig: readDismissed(s), format: 'all', mode: 'list', ...o });
  assert.equal(show(), true); dismissBanner(s, files); assert.equal(show(), false, 'dismissed');
  assert.equal(readDismissed(s), filesSig(files)); assert.equal(show({ files: [...files, 'c.mp4'] }), true, 'a new render brings it back');
  assert.equal(show({ files: ['x.mp4'] }), true, 'a different list too'); assert.equal(bannerVisible({ files: [], dismissedSig: '' }), false);
  dismissBanner(memory(), files); const fresh = memory(); assert.equal(bannerVisible({ files, dismissedSig: readDismissed(fresh), format: 'long', mode: 'list' }), false); assert.equal(bannerVisible({ files, dismissedSig: '', mode: 'calendar' }), false); assert.equal(bannerVisible({ files, dismissedSig: '', readOnly: true }), false);
  assert.doesNotThrow(() => dismissBanner(broken, files)); assert.equal(readDismissed(broken), '');
  assert.equal(bannerText(1), '1 render in output/ is not in this list yet.'); assert.equal(bannerText(14), '14 renders in output/ are not in this list yet.'); assert.match(addConfirmText(14), /Add 14 renders/); assert.match(addConfirmText(1), /Add 1 render from/);
});

test('sort and filters', () => {
  const a = vid({ title: 'banana', updatedAt: '2026-11-03T00:00:00Z' }), b = vid({ title: 'Apple', updatedAt: '2026-11-02T00:00:00Z', scheduledAt: '2026-12-05T10:00' }), c = vid({ title: 'cherry', updatedAt: '2026-11-04T00:00:00Z', scheduledAt: '2026-12-01T10:00' });
  assert.deepEqual(sortVideos([a, b, c], 'newest').map(v => v.title), ['cherry', 'banana', 'Apple']);
  assert.deepEqual(sortVideos([a, b, c], 'title').map(v => v.title), ['Apple', 'banana', 'cherry']);
  assert.deepEqual(sortVideos([a, b, c], 'schedule').map(v => v.title), ['cherry', 'Apple', 'banana'], 'dated first (earliest first), the rest after');
  const input = [a, b, c]; sortVideos(input, 'title'); assert.deepEqual(input.map(v => v.title), ['banana', 'Apple', 'cherry'], 'the list itself is not changed');
  assert.equal(hasFilters(NO_FILTERS), false); assert.equal(hasFilters({ ...NO_FILTERS, query: ' ' }), false); for (const k of ['status', 'scene', 'style', 'focus'] as const) assert.equal(hasFilters({ ...NO_FILTERS, [k]: 'x' }), true);
  assert.equal(hasFilters({ ...NO_FILTERS, query: 'x' }), true);
  assert.equal(filterBy(LIB, { scene: 'sync-lines', style: '' }).length, 1); assert.equal(filterBy(LIB, { scene: '', style: '' }).length, 7); assert.equal(filterBy(LIB, { scene: 'hammer-smash', style: 'riso' }).length, 0);
  assert.deepEqual(optionsOf(inFormat(LIB, 'shorts')), { scenes: ['hammer-smash', 'sync-lines'], styles: ['classic'] });
});

test('calendar per format: the Shorts plan never shows long videos; Long shows no plan; All marks long videos', () => {
  const short = vid({ id: 'v-s1', status: 'rendered' }), longV = vid({ id: 'v-l1', kind: 'long', sceneId: 'compilation', status: 'scheduled', scheduledAt: '2026-12-01T10:00' });
  const plan = { slots: [{ slot: '2026-12-02T00:00:00.000Z', wib: '2026-12-02 07:00', videoId: 'v-s1', sceneId: 'hammer-smash', title: 'T', status: 'planned' }] };
  const entries = (f: Format) => { const i = calendarInput(plan, [short, longV], f); return calendarEntries(i.plan as never, i.videos); };
  assert.deepEqual(entries('shorts').map(e => e.videoId), ['v-s1']); assert.ok(entries('shorts').every(e => !e.kind));
  assert.deepEqual(entries('long').map(e => e.videoId), ['v-l1']); assert.equal(entries('long')[0].inPlan, false);
  assert.deepEqual(entries('all').map(e => e.videoId).sort(), ['v-l1', 'v-s1']); assert.equal(entries('all').find(e => e.videoId === 'v-l1')!.kind, 'long'); assert.equal(entries('all').find(e => e.videoId === 'v-s1')!.kind, undefined);
  assert.equal(CALENDAR_NOTE.shorts, ''); assert.match(CALENDAR_NOTE.long, /Shorts/); assert.match(CALENDAR_NOTE.all, /Long/);
  // a plan slot of a Short that is not in the Long calendar must not leak in through the plan
  assert.equal(calendarInput(plan, [short], 'long').plan, null);
});
