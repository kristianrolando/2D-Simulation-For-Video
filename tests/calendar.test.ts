// Calendar view of the upload schedule: slot states, month grid, grouping. Pure: no server, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarEntries, groupByDay, monthWeeks, shiftMonth, startMonth, slotState } from '../packages/publish/calendar.ts';
import { wibInstant } from '../packages/publish/schedule.ts';

const slot = (id: string, at: string, status = 'planned') => ({ slot: new Date(wibInstant(at.slice(0, 10), at.slice(11))).toISOString(), wib: at, videoId: id, sceneId: 'hammer-smash', title: 'plan title ' + id, status } as any);
const vid = (id: string, extra: Record<string, unknown> = {}) => ({ id, sceneId: 'hammer-smash', title: 'real title ' + id, status: 'rendered', scheduledAt: '', publishedAt: '', ...extra } as any);

test('month grid: whole Monday-first weeks', () => {
  const w = monthWeeks(2026, 11);                      // 1 Nov 2026 is a Sunday
  assert.equal(w[0][0], '2026-10-26'); assert.equal(w[0][6], '2026-11-01');
  assert.equal(w.at(-1)![6], '2026-12-06'); assert.ok(w.every(x => x.length === 7));
  assert.equal(monthWeeks(2027, 2).length, 4);         // Feb 2027 starts on a Monday and has 28 days
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2027-01', -1), '2026-12');
});

test('a slot sits on its real WIB date: midnight belongs to the date it starts', () => {
  const e = calendarEntries({ slots: [slot('a', '2026-11-20 00:00'), slot('b', '2026-11-20 05:00')] }, []);
  assert.deepEqual(e.map(x => [x.date, x.time]), [['2026-11-20', '00:00'], ['2026-11-20', '05:00']]);
  assert.equal(groupByDay(e).get('2026-11-20')!.length, 2);
});

test('the studio record wins over the plan file', () => {
  assert.equal(slotState({ status: 'planned' }, undefined), 'planned');
  assert.equal(slotState({ status: 'uploaded' }, undefined), 'scheduled');
  assert.equal(slotState({ status: 'failed' }, vid('x')), 'failed');
  assert.equal(slotState({ status: 'planned' }, vid('x', { youtube: { stage: 'done' }, status: 'scheduled' })), 'scheduled');
  assert.equal(slotState({ status: 'uploaded' }, vid('x', { status: 'published' })), 'published');
  assert.equal(slotState({ status: 'planned' }, vid('x', { youtube: { stage: 'processing' } })), 'uploading');
  assert.equal(slotState({ status: 'planned' }, vid('x', { youtube: { stage: 'failed', waitUntil: '2026-11-20T00:00:00Z' } })), 'waiting');
  assert.equal(slotState({ status: 'planned' }, vid('x', { youtube: { stage: 'failed', waitUntil: '' } })), 'failed');
});

test('videos scheduled outside the plan are shown too, once, at their own time', () => {
  const e = calendarEntries({ slots: [slot('a', '2026-11-21 05:00')] }, [
    vid('a'), vid('m', { status: 'scheduled', scheduledAt: '2026-11-18T18:38' }), vid('p', { status: 'published', youtube: { stage: 'done', publishAt: '2026-11-18T15:00:00.000Z' } }), vid('r')]);
  assert.deepEqual(e.map(x => `${x.videoId}@${x.date} ${x.time}:${x.state}:${x.inPlan}`), ['m@2026-11-18 18:38:scheduled:false', 'p@2026-11-18 22:00:published:false', 'a@2026-11-21 05:00:planned:true']);
  assert.equal(e.find(x => x.videoId === 'a')!.title, 'real title a');   // the studio's (editable) title, not the plan's copy
});

test('the calendar opens on today\'s month while anything lies ahead, otherwise on the first entry', () => {
  const e = calendarEntries({ slots: [slot('a', '2027-01-05 05:00')] }, []);
  assert.equal(startMonth(e, wibInstant('2026-11-19', '09:00')), '2026-11');
  assert.equal(startMonth(e, wibInstant('2027-03-01', '09:00')), '2027-01');
  assert.equal(startMonth([], wibInstant('2026-11-19', '09:00')), '2026-11');
});
