// Upload schedule logic: WIB slots, balanced deterministic choice, and idempotence of the plan file. Pure: no network, no files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots, wibInstant, wibParts, slotDay, pickBalanced, nextToUpload, markSlot, type Cand, type SchedulePlan } from '../packages/publish/schedule.ts';

const NOW = Date.parse('2026-11-19T09:12:00+07:00');
const wib = (ms: number) => { const p = wibParts(ms); return `${p.date} ${p.time}`; };

test('WIB converts to UTC with a fixed +7 offset', () => {
  assert.equal(new Date(wibInstant('2026-11-19', '19:30')).toISOString(), '2026-11-19T12:30:00.000Z');
  assert.equal(new Date(wibInstant('2026-11-20', '00:00')).toISOString(), '2026-11-19T17:00:00.000Z');
  assert.equal(new Date(wibInstant('2026-11-20', '05:00')).toISOString(), '2026-11-19T22:00:00.000Z');
});

test('today only 19:30 and the midnight after it are ahead; then five slots a day in order', () => {
  const s = buildSlots(NOW, 7).map(wib);
  assert.deepEqual(s, ['2026-11-19 19:30', '2026-11-20 00:00', '2026-11-20 05:00', '2026-11-20 06:30', '2026-11-20 08:00', '2026-11-20 19:30', '2026-11-21 00:00']);
  assert.equal(slotDay(wibInstant('2026-11-20', '00:00')), '2026-11-19');   // midnight is the last slot of the day before
});

test('a slot under 30 minutes away is not used, one at exactly 30 is', () => {
  const at = wibInstant('2026-11-19', '19:30');
  assert.equal(wib(buildSlots(at - 29 * 60e3, 1)[0]), '2026-11-20 00:00');
  assert.equal(wib(buildSlots(at - 30 * 60e3, 1)[0]), '2026-11-19 19:30');
});

test('slots already taken are skipped, and none repeats', () => {
  const taken = [wibInstant('2026-11-19', '19:30'), wibInstant('2026-11-20', '05:00')];
  const s = buildSlots(NOW, 40, { taken });
  assert.ok(!s.some(t => taken.includes(t)));
  assert.equal(new Set(s).size, s.length);
  assert.ok(s.every((t, i) => i === 0 || t > s[i - 1]));
});

const cands = (spec: Record<string, number>): Cand[] => Object.entries(spec).flatMap(([scene, n]) => Array.from({ length: n }, (_, i) => ({ id: `${scene}-${i}`, sceneId: scene, look: `${scene}/${i % 3}`, group: `${scene}|${i % 4}`, head: `h${i % 5}` })));

test('no two videos of one scene in a row, deterministic by seed, other seeds differ', () => {
  const c = cands({ a: 30, b: 24, c: 4, d: 2 }), slots = buildSlots(NOW, c.length);
  const r1 = pickBalanced(c, slots, { seed: 7 }), r2 = pickBalanced([...c].reverse(), slots, { seed: 7 }), r3 = pickBalanced(c, slots, { seed: 8 });
  const ids = (r: typeof r1) => r.placed.map(p => p.cand.id).join(',');
  assert.equal(ids(r1), ids(r2));
  assert.notEqual(ids(r1), ids(r3));
  assert.equal(r1.placed.length + r1.reserve.length, c.length);
  for (let i = 1; i < r1.placed.length; i++) assert.notEqual(r1.placed[i].cand.sceneId, r1.placed[i - 1].cand.sceneId);
  assert.ok(r1.placed.every((p, i) => p.slot === slots[i]));
});

test('rare scenes are spread over the whole horizon, not bunched at the end', () => {
  const c = cands({ a: 90, b: 70, r: 6 }).map(x => ({ ...x, group: `${x.sceneId}|${x.id}`, head: x.id })), r = pickBalanced(c, buildSlots(NOW, c.length), { seed: 1 });
  const pos = r.placed.map((p, i) => p.cand.sceneId === 'r' ? i : -1).filter(i => i >= 0);
  assert.equal(pos.length, 6);
  assert.ok(pos[0] < 40 && pos.at(-1)! > r.placed.length - 40, `positions ${pos}`);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] - pos[i - 1] > 10, `gap ${pos[i] - pos[i - 1]}`);
});

test('a scene too large to separate leaves the surplus in reserve instead of breaking the rule', () => {
  const c = cands({ a: 10, b: 3 }), r = pickBalanced(c, buildSlots(NOW, c.length), { seed: 3 });
  assert.equal(r.placed.length, 7);                       // 4 a's between 3 b's at most: a b a b a b a
  assert.equal(r.reserve.length, 6);
  assert.ok(r.reserve.every(x => x.sceneId === 'a'));
});

test('a look is not used more than twice in a row, and near-twins keep their distance', () => {
  const c = cands({ a: 20, b: 20, c: 20 }).map(x => ({ ...x, look: x.id.endsWith('1') ? 'same' : x.look }));
  const r = pickBalanced(c, buildSlots(NOW, c.length), { seed: 5 });
  for (let i = 2; i < r.placed.length; i++) if (!r.placed[i].relaxed.includes('look-run')) assert.ok(!(r.placed[i].cand.look === r.placed[i - 1].cand.look && r.placed[i].cand.look === r.placed[i - 2].cand.look));
  const tight = r.placed.filter(p => !p.relaxed.includes('twin'));
  for (let i = 0; i < r.placed.length; i++) if (tight.includes(r.placed[i])) for (let j = Math.max(0, i - 12); j < i; j++) assert.notEqual(r.placed[j].cand.group, r.placed[i].cand.group);
});

test('the plan file is idempotent: an uploaded slot is never planned or started again', () => {
  const plan: SchedulePlan = { version: 1, createdAt: '', seed: 1, timezone: 'WIB (UTC+7)', slotsWib: [], skipped: [], reserve: [], slots: [
    { slot: new Date(wibInstant('2026-11-19', '19:30')).toISOString(), wib: '', videoId: 'v1', sceneId: 'a', title: 't', status: 'planned' },
    { slot: new Date(wibInstant('2026-11-20', '00:00')).toISOString(), wib: '', videoId: 'v2', sceneId: 'b', title: 't', status: 'planned' }] };
  assert.deepEqual(nextToUpload(plan, NOW).map(s => s.videoId), ['v1', 'v2']);
  const up = markSlot(plan, 'v1', 'uploaded', { youtubeId: 'abc' });
  assert.deepEqual(nextToUpload(up, NOW).map(s => s.videoId), ['v2']);
  const again = markSlot(up, 'v1', 'planned');           // a stale writer cannot undo it
  assert.equal(again.slots[0].status, 'uploaded');
  assert.equal(again.slots[0].youtubeId, 'abc');
  const failed = markSlot(up, 'v2', 'failed', { error: 'x' });
  assert.deepEqual(nextToUpload(failed, NOW).map(s => s.videoId), []);   // a failed slot waits for a person, no automatic retry
  assert.deepEqual(nextToUpload(plan, wibInstant('2026-11-19', '19:10')).map(s => s.videoId), ['v2']);   // 20 min before: the 19:30 slot is under the 30-minute lead
});

test('the same title pattern is not used twice on one day when it can be avoided', () => {
  const c = cands({ a: 40, b: 40, c: 40 }).map(x => ({ ...x, head: `h${Number(x.id.split('-')[1]) % 12}`, group: x.id })), slots = buildSlots(NOW, c.length);
  const r = pickBalanced(c, slots, { seed: 2 });
  const seen = new Map<string, Set<string>>();
  for (const p of r.placed) { const d = slotDay(p.slot), set = seen.get(d) ?? seen.set(d, new Set()).get(d)!; if (!p.relaxed.includes('title-pattern')) assert.ok(!set.has(p.cand.head), `${d} repeats ${p.cand.head}`); set.add(p.cand.head); }
  assert.ok(r.placed.filter(p => p.relaxed.length).length < 10);
});
