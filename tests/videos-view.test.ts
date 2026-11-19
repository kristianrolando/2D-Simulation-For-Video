// The numbers and rules behind the Videos list (apps/studio/videos-view.ts): one counting rule for chips, menu, cards and summary, remembered
// filters, bulk selection and the CSV. Pure: no studio, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVideo, type Video } from '../packages/publish/index.ts';
import { sortVideos } from '../apps/studio/videos-nav.ts';
import {
  NO_CHANNEL, NO_VIEW, rows, chipCounts, channelChoices, channelFacts, channelCards, summaryLine, activeLine, hasActive, validChannel, loadView, saveView, planBulkMark, bulkCsv, channelKey,
  type ViewState, type ViewCtx,
} from '../apps/studio/videos-view.ts';

const ctx: ViewCtx = { sceneName: id => id.toUpperCase(), styleName: id => id };
let n = 0;
const mk = (over: Record<string, unknown> = {}): Video => sanitizeVideo({ id: `v${++n}`, title: `Video ${n}`, status: 'rendered', sceneId: 'galton-board', style: 'classic', file: `f${n}.mp4`, durationSec: 30, createdAt: `2026-11-${10 + (n % 9)}T10:00:00.000Z`, updatedAt: `2026-11-${10 + (n % 9)}T10:00:00.000Z`, ...over })!;
/** 2 real channels, a manual one, long videos, scheduled/published ones and records with no channel at all */
function world(): Video[] {
  const v: Video[] = [];
  for (let i = 0; i < 6; i++) v.push(mk({ channel: 'Photon Lab', channelId: 'UC1' }));
  v.push(mk({ channel: 'Photon Lab', channelId: 'UC1', status: 'scheduled' }), mk({ channel: 'Photon Lab', channelId: 'UC1', status: 'published' }));
  for (let i = 0; i < 5; i++) v.push(mk({ channel: 'Plasma Pendulum', channelId: 'UC2' }));
  v.push(mk({ channel: 'Plasma Pendulum', channelId: 'UC2', status: 'published' }), mk({ channel: 'Plasma Pendulum', channelId: 'UC2', kind: 'long', compilationId: 'c1', durationSec: 700 }));
  for (let i = 0; i < 3; i++) v.push(mk({ channel: 'Fourier Loom' }));          // a channel added by hand: a name, no id
  v.push(mk({ status: 'draft' }));                                                  // sanitize gives it the default channel
  const none = mk(); (none as { channel: string }).channel = '';                    // a record whose channel is empty (never from the studio itself)
  v.push(none);
  return v;
}
const state = (o: Partial<ViewState> = {}): ViewState => ({ ...NO_VIEW, ...o });
const known = [{ name: 'Photon Lab', kind: 'connected' as const }, { name: 'Plasma Pendulum', kind: 'connected' as const }, { name: 'Fourier Loom', kind: 'manual' as const }];

test('channel counts + "no channel" always add up to All, with any other filter on', () => {
  const vs = world();
  for (const s of [state(), state({ format: 'shorts' }), state({ status: 'rendered' }), state({ format: 'long' }), state({ query: 'video' }), state({ scene: 'galton-board', status: 'published' })]) {
    const { all, choices } = channelChoices(vs, known, s, ctx);
    assert.equal(all, rows(vs, s, ctx, 'channel').length);
    assert.equal(choices.reduce((a, c) => a + c.count, 0), all, JSON.stringify(s));
  }
  const { all, choices } = channelChoices(vs, known, state(), ctx);
  assert.equal(all, vs.length);
  assert.deepEqual(choices.map(c => [c.name, c.count, c.kind]), [['Photon Lab', 9, 'connected'], ['Plasma Pendulum', 7, 'connected'], ['Fourier Loom', 3, 'manual'], ['No channel', 1, 'none']]);
});

test('every chip count is the number of rows its click would show', () => {
  const vs = world();
  for (const base of [state(), state({ channel: 'Plasma Pendulum' }), state({ channel: 'Photon Lab', format: 'shorts' }), state({ channel: NO_CHANNEL }), state({ query: 'video 1' }), state({ status: 'published', channel: 'Plasma Pendulum' })]) {
    const c = chipCounts(vs, base, ctx);
    for (const f of ['all', 'shorts', 'long'] as const) assert.equal(c.formats[f], rows(vs, { ...base, format: f }, ctx).length, `format ${f} of ${JSON.stringify(base)}`);
    for (const st of ['all', 'draft', 'rendered', 'scheduled', 'published'] as const) assert.equal(c.statuses[st], rows(vs, { ...base, status: st }, ctx).length, `status ${st} of ${JSON.stringify(base)}`);
    assert.equal(c.formats.shorts + c.formats.long, c.formats.all);
    assert.equal(c.statuses.draft + c.statuses.rendered + c.statuses.scheduled + c.statuses.published, c.statuses.all);
  }
  // the chips follow the channel: Plasma Pendulum has no scheduled video, 1 published, 1 long
  const p = chipCounts(vs, state({ channel: 'Plasma Pendulum' }), ctx);
  assert.deepEqual([p.statuses.all, p.statuses.rendered, p.statuses.scheduled, p.statuses.published, p.formats.long], [7, 6, 0, 1, 1]);
});

test('channel cards and summary: what a channel holds in total, whatever the other filters', () => {
  const vs = world();
  const f = channelFacts(vs, 'Plasma Pendulum');
  assert.deepEqual([f.total, f.statuses.rendered, f.statuses.scheduled, f.statuses.published, f.shorts, f.long], [7, 6, 0, 1, 6, 1]);
  assert.equal(summaryLine(f), 'Plasma Pendulum: 7 videos · 6 rendered · 0 scheduled · 1 published · 6 Shorts · 1 Long');
  assert.equal(summaryLine(channelFacts(vs, 'Fourier Loom')), 'Fourier Loom: 3 videos · 3 rendered · 0 scheduled · 0 published · 3 Shorts · 0 Long');
  assert.match(summaryLine(channelFacts(vs, '')), /^All channels: 20 videos/);
  assert.match(summaryLine(channelFacts(vs, NO_CHANNEL)), /^No channel: 1 video ·/);
  const { choices } = channelChoices(vs, known, state({ status: 'draft' }), ctx);
  const cards = channelCards(vs, choices);
  assert.equal(cards[0].total, vs.length);
  assert.equal(cards.slice(1).reduce((a, c) => a + c.total, 0), vs.length, 'the cards add up to the total, also when a filter is on');
  assert.equal(channelKey({ channel: '  ' }), NO_CHANNEL);
});

test('a channel with no video yet is listed with 0; a name found only on a video is listed too; an unknown choice falls back to All', () => {
  const vs = world();
  const { choices } = channelChoices(vs, [...known, { name: 'Empty Channel', kind: 'manual' }], state(), ctx);
  assert.deepEqual(choices.find(c => c.name === 'Empty Channel'), { key: 'Empty Channel', name: 'Empty Channel', count: 0, kind: 'manual' });
  const odd = channelChoices([...vs, mk({ channel: 'Somebody Else' })], known, state(), ctx).choices.find(c => c.name === 'Somebody Else');
  assert.equal(odd?.kind, 'tagged'); assert.equal(odd?.count, 1);
  assert.equal(validChannel('Gone Channel', vs, known), ''); assert.equal(validChannel('Photon Lab', vs, known), 'Photon Lab'); assert.equal(validChannel('Empty Channel', vs, [{ name: 'Empty Channel' }]), 'Empty Channel');
  assert.equal(validChannel(NO_CHANNEL, vs, known), NO_CHANNEL); assert.equal(validChannel(NO_CHANNEL, vs.filter(v => channelKey(v) !== NO_CHANNEL), known), '');
  assert.equal(validChannel('', vs, known), '');
  // no record without a channel: the "No channel" choice does not exist
  assert.ok(!channelChoices(vs.filter(v => channelKey(v) !== NO_CHANNEL), known, state(), ctx).choices.some(c => c.kind === 'none'));
});

test('an empty result is an empty result: zero rows, counts 0, the filter line says what is on', () => {
  const vs = world(), s = state({ channel: 'Fourier Loom', status: 'published' });
  assert.equal(rows(vs, s, ctx).length, 0);
  assert.ok(hasActive(s)); assert.ok(!hasActive(NO_VIEW)); assert.ok(hasActive(NO_VIEW, 'failed'));
  assert.equal(activeLine(s, ctx), 'Channel: Fourier Loom · Published');
  assert.equal(activeLine(state({ query: ' hammer ', scene: 'galton-board' }), ctx), 'GALTON-BOARD · search “hammer”');
  assert.equal(activeLine(state({ channel: NO_CHANNEL }), ctx), 'Channel: No channel');
  assert.equal(activeLine(NO_VIEW, ctx), '');
});

test('search finds title, scene, channel and id', () => {
  const vs = world(), pick = vs[3];
  assert.ok(rows(vs, state({ query: pick.id }), ctx).some(v => v.id === pick.id));
  assert.equal(rows(vs, state({ query: 'fourier' }), ctx).length, 3);
  assert.equal(rows(vs, state({ query: 'pendulum' }), ctx).length, 7);
  assert.equal(rows(vs, state({ query: 'GALTON-BOARD' }), ctx).length, vs.length, 'the scene name');
});

test('remembered filters: round trip, damaged values and a store that throws change nothing', () => {
  const mem: Record<string, string> = {}, st = { get: (k: string) => mem[k] ?? null, set: (k: string, v: string) => { mem[k] = v; } };
  saveView(st, state({ channel: 'Plasma Pendulum', status: 'rendered', query: 'x', scene: 's', style: 'y' }));
  assert.deepEqual(loadView(st), { channel: 'Plasma Pendulum', status: 'rendered', query: 'x', scene: 's', style: 'y' });
  for (const bad of ['', 'junk', '[]', 'null', '{"status":"weird","channel":5,"query":{}}', '{"channel":"a".repeat(9)}']) assert.deepEqual(loadView({ get: () => bad, set() {} }), { channel: '', status: 'all', query: '', scene: '', style: '' });
  const broken = { get: () => { throw new Error('no storage'); }, set: () => { throw new Error('no storage'); } };
  assert.doesNotThrow(() => saveView(broken, state({ channel: 'a' }))); assert.deepEqual(loadView(broken), { channel: '', status: 'all', query: '', scene: '', style: '' });
});

test('bulk mark: only Rendered videos without an upload record; Scheduled/Published and uploaded ones are never touched', () => {
  const vs = world();
  const ids = vs.map(v => v.id), plan = planBulkMark(vs, [...ids, 'nope']);
  assert.equal(plan.ok.length + plan.skipped.length, ids.length + 1);
  assert.ok(plan.ok.every(v => v.status === 'rendered' && !v.youtube));
  assert.ok(plan.skipped.filter(s => /scheduled|published/.test(s.reason)).length === vs.filter(v => v.status === 'scheduled' || v.status === 'published').length);
  assert.equal(plan.skipped.find(s => s.id === 'nope')?.reason, 'not in the list');
  const withYt = mk({ status: 'rendered', youtube: { videoId: 'abc', stage: 'failed' } });
  assert.match(planBulkMark([withYt], [withYt.id]).skipped[0].reason, /upload record/);
  assert.match(planBulkMark([vs.find(v => v.status === 'draft')!], [vs.find(v => v.status === 'draft')!.id]).skipped[0].reason, /not rendered/);
});

test('CSV of a selection: header, numbering, and quotes/commas/line breaks stay inside their cell', () => {
  const v1 = mk({ title: 'He said "hi", twice', description: 'Line one\nLine two, with a comma', tags: ['a', 'b c'], channel: 'Plasma Pendulum', coverFile: 'c1.jpg' }), v2 = mk({ title: 'Plain', channel: 'Photon Lab' });
  const csv = bulkCsv([v1, v2]);
  assert.ok(csv.startsWith('﻿no,id,title,description,tags,channel,status,video_file,cover_file\r\n'));
  assert.ok(csv.includes(`1,${v1.id},"He said ""hi"", twice","Line one\nLine two, with a comma",a; b c,Plasma Pendulum,rendered,${v1.file},c1.jpg\r\n`));
  assert.ok(csv.includes(`2,${v2.id},Plain,`));
  // parse it back with a small CSV reader: 2 data rows, 9 columns each
  const parse = (t: string) => { const out: string[][] = []; let row: string[] = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r') { /* skip */ } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else cell += c; } return out; };
  const table = parse(csv.slice(1)); assert.equal(table.length, 3); assert.ok(table.every(r => r.length === 9)); assert.equal(table[1][3], 'Line one\nLine two, with a comma'); assert.equal(table[1][2], 'He said "hi", twice');
  assert.equal(bulkCsv([]), '﻿no,id,title,description,tags,channel,status,video_file,cover_file\r\n');
});

test('sorting: last edited, render date, schedule, title, duration, and the direction can be turned around', () => {
  const a = mk({ title: 'B', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z', durationSec: 10 });
  const b = mk({ title: 'A', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', durationSec: 50 });
  const c = mk({ title: 'C', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z', durationSec: 30 });
  const order = (by: Parameters<typeof sortVideos>[1], reverse = false) => sortVideos([a, b, c], by, reverse).map(v => v.title).join('');
  assert.equal(order('newest'), 'BCA');      // last edited: B (5 Nov), C (4 Nov), A (2 Nov)
  assert.equal(order('created'), 'ACB');     // render date: A (3 Nov), C (2 Nov), B (1 Nov)
  assert.equal(order('title'), 'ABC');
  assert.equal(order('duration'), 'ACB');    // 50, 30, 10 seconds
  assert.equal(order('schedule'), 'BCA');    // no dates: the newest first
  assert.equal(order('newest', true), 'ACB'); assert.equal(order('title', true), 'CBA');
  const dated = mk({ title: 'D', scheduledAt: '2030-01-01T10:00', updatedAt: '2026-11-01T00:00:00Z' });
  assert.equal(sortVideos([a, dated], 'schedule')[0].title, 'D', 'a video with a date comes first');
});
