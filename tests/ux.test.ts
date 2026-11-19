// Studio UX helpers: search, gallery order, keyboard shortcuts, readable errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadFailed, uploadRunning, uploadWaiting, progressTitle, needsCounts, firstNeeding, matchesQuery, groupByScene, shortcutFor, SHORTCUTS, friendlyError, friendlyWarnings, fmtSecs, fmtSize } from '../apps/studio/ux.ts';

test('search: every word must match, case and accents ignored, empty query matches all', () => {
  assert.ok(matchesQuery('', 'anything'));
  assert.ok(matchesQuery('galton', 'Galton board', 'Chance'));
  assert.ok(matchesQuery('BELL curve', 'Galton board', 'random bounces stack into a bell curve'));
  assert.ok(!matchesQuery('galton orbit', 'Galton board', 'Chance'));
  assert.ok(matchesQuery('cafe', 'Café'));
  assert.ok(!matchesQuery('xyz', 'Galton board'));
});

test('gallery order keeps presets under their scene and is stable', () => {
  const items = [
    { kind: 'scene', sceneId: 'b', name: 'B' }, { kind: 'scene', sceneId: 'a', name: 'A' },
    { kind: 'preset', sceneId: 'a', name: 'a2' }, { kind: 'preset', sceneId: 'b', name: 'b1' }, { kind: 'preset', sceneId: 'a', name: 'a1' },
  ];
  const out = groupByScene(items, ['a', 'b']).map(i => i.name);
  assert.deepEqual(out, ['A', 'a2', 'a1', 'B', 'b1']);
  assert.deepEqual(groupByScene(items, ['a', 'b']).map(i => i.name), out, 'deterministic');
  assert.equal(groupByScene([{ kind: 'scene', sceneId: 'zzz', name: 'Z' }, ...items], ['a', 'b']).at(-1)!.name, 'Z', 'unknown scenes go last');
});

test('shortcuts: mapping, modifiers ignored, every documented key maps to an action', () => {
  assert.equal(shortcutFor({ key: ' ', code: 'Space' }), 'play');
  assert.equal(shortcutFor({ key: 'r' }), 'render');
  assert.equal(shortcutFor({ key: 'R' }), 'render');
  assert.equal(shortcutFor({ key: 'r', metaKey: true }), null, 'Cmd+R stays the browser reload');
  assert.equal(shortcutFor({ key: 'r', ctrlKey: true }), null);
  assert.equal(shortcutFor({ key: 'ArrowRight' }), 'stepFwd');
  assert.equal(shortcutFor({ key: 'ArrowLeft', shiftKey: true }), 'jumpBack');
  assert.equal(shortcutFor({ key: '3' }), 'style:2');
  assert.equal(shortcutFor({ key: '7' }, 6), null);
  assert.equal(shortcutFor({ key: '0' }), null);
  assert.equal(shortcutFor({ key: '/' }), 'search');
  assert.equal(shortcutFor({ key: '?', shiftKey: true }), 'help');
  assert.equal(shortcutFor({ key: 'x' }), null);
  const keyOf: Record<string, string> = { Space: ' ', '←': 'ArrowLeft', '→': 'ArrowRight', Esc: 'Escape', '↑': 'ArrowUp', '↓': 'ArrowDown' };
  for (const row of SHORTCUTS) for (const k of row.keys) {
    if (k === '–') continue;
    const key = keyOf[k] ?? k;
    if (k === '↑' || k === '↓') continue; // list navigation lives in the Videos list, not in the global map
    assert.ok(shortcutFor({ key, code: k === 'Space' ? 'Space' : undefined }), `documented key ${k} does something`);
  }
});

test('errors become plain sentences with a next step; unknown ones keep the detail', () => {
  assert.match(friendlyError(new TypeError('Failed to fetch')), /Cannot reach the studio server/);
  assert.match(friendlyError('spawn ffmpeg ENOENT'), /ffmpeg was not found.*brew install/);
  assert.match(friendlyError('ffmpeg failed: Invalid data found | x'), /video encoder stopped/);
  assert.match(friendlyError('ENOSPC: no space left on device'), /disk is full/);
  assert.match(friendlyError('worker exited with 1'), /crashed/);
  assert.match(friendlyError('unknown scene foo'), /Reload/);
  assert.match(friendlyError('weird thing'), /weird thing/);
  assert.equal(friendlyError(undefined), 'Something went wrong. Try again.');
  assert.equal(friendlyWarnings([]), '');
  assert.match(friendlyWarnings(['a', 'b', 'c', 'd']), /adjusted.*…$/);
});

test('formatters', () => {
  assert.equal(fmtSecs(4.2), '4 s');
  assert.equal(fmtSecs(75), '1 min 15 s');
  assert.equal(fmtSecs(-1), '');
  assert.equal(fmtSize(2.5 * 1048576), '2.5 MB');
  assert.equal(fmtSize(2048), '2 KB');
  assert.equal(fmtSize(undefined), '');
});

test('tab title shows render progress and stays quiet otherwise', () => {
  assert.equal(progressTitle('running', 41.6), 'Render 42% · Sim Studio');
  assert.equal(progressTitle('running', 140), 'Render 100% · Sim Studio');
  assert.equal(progressTitle('queued', 0), 'Queued · Sim Studio');
  assert.equal(progressTitle('done', 100), null);
  assert.equal(progressTitle('error', 0), null);
});

test('videos that need the owner: counts and which one opens first', () => {
  const vs = [{ status: 'published' }, { status: 'rendered' }, { status: 'rendered', youtube: { stage: 'failed' } }, { status: 'scheduled', youtube: { stage: 'uploading' } }, { status: 'draft' }];
  assert.deepEqual(needsCounts(vs), { toSchedule: 1, failed: 1, uploading: 1 });
  const waiting = { status: 'rendered', youtube: { stage: 'failed', waitUntil: '2026-11-19T08:02:00.000Z' } };
  assert.ok(uploadWaiting(waiting) && uploadRunning(waiting) && !uploadFailed(waiting), 'waiting for the quota is in progress, not a failure that needs the owner');
  assert.deepEqual(needsCounts([waiting]), { toSchedule: 0, failed: 0, uploading: 1 });
  assert.equal(firstNeeding(vs), vs[2], 'a failed upload comes first');
  assert.equal(firstNeeding(vs.filter((_, i) => i !== 2)), vs[3], 'then a running upload');
  const two = [{ status: 'draft' }, { status: 'rendered' }];
  assert.equal(firstNeeding(two), two[1], 'then the newest rendered one');
  assert.equal(firstNeeding([]), undefined);
});
