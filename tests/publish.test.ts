// Video tracking: metadata suggestions, status changes, atomic writes, backups and recovery from damaged files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../apps/server/host.ts';
import { SCENES } from '../packages/scenes/index.ts';
import { getTheme, themeIds } from '../packages/theme/index.ts';
import {
  SCHEMA_VERSION, LIMITS, sanitizeVideo, patchVideo, parseTags, parseHashtags, suggestMetadata, descriptionWithHashtags, copyAll, checkMetadata,
  filterVideos, statusCounts, coverage, toCsv, isYoutubeUrl, nextStep, tagsLength, type Video,
} from '../packages/publish/index.ts';
import { newVideoFor, suggestFor, hookFor } from '../packages/publish/describe.ts';
import { openStore, parseStore, ReadOnlyError } from '../apps/server/store.ts';
import { findUntrackedRenders } from '../apps/server/scan.ts';
import { LANGS, utf8Bytes } from '../packages/publish/index.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sim-data-'));
let tick = Date.UTC(2026, 10, 18, 9, 0, 0);
const clock = () => new Date((tick += 1000));
const mk = (over: Partial<Video> = {}): Video => ({ ...newVideoFor('galton-board', {})!, ...over });

// ---------------- metadata ----------------
test('every scene and style gets a filled-in, valid suggestion (never an empty form)', () => {
  for (const s of SCENES) for (const style of themeIds()) {
    const sug = suggestFor(s.meta.id, { style })!;
    assert.ok(sug.title.length > 5 && sug.title.length <= LIMITS.title, `${s.meta.id}: title`);
    assert.ok(sug.description.length > 80 && sug.description.length < LIMITS.description);
    assert.ok(sug.tags.length >= 5 && tagsLength(sug.tags) <= LIMITS.tags, `${s.meta.id}: tags ${tagsLength(sug.tags)}`);
    assert.equal(sug.hashtags[0], '#Shorts');
    assert.ok(sug.hashtags.length <= 5 && sug.hashtags.every(h => /^#[\p{L}\p{N}_]+$/u.test(h)));
    assert.ok(sug.titleIdeas.length >= 2 && new Set(sug.titleIdeas).size === sug.titleIdeas.length);
    assert.ok(sug.tags.includes(getTheme(style).name.toLowerCase()), 'style name is a tag');
  }
  assert.equal(hookFor('focal-reflection', {}), 'Will every ball find the same spot?', 'layout hook when the title is empty');
  assert.equal(hookFor('galton-board', { title: 'My own hook' }), 'My own hook');
  assert.equal(hookFor('nope', {}), '');
  assert.equal(newVideoFor('nope', {}), null);
});

test('a new record is Shorts-sized, draft, pre-filled, and carries what it was rendered with', () => {
  const v = newVideoFor('gravity-bounce', { style: 'candy' }, { jobId: 'job1' })!;
  assert.equal(v.status, 'draft'); assert.equal(v.style, 'candy'); assert.equal(v.jobId, 'job1');
  assert.ok(v.title && v.description && v.tags.length && v.hashtags.length);
  assert.equal(v.durationSec, 30);
  assert.equal(v.params.style, 'candy');
  assert.equal(SCENES[0].meta.width, 1080); assert.equal(SCENES[0].meta.height, 1920);
});

test('tags and hashtags: parsing, de-duplication, limits, copy text', () => {
  assert.deepEqual(parseTags('Physics, physics,  bell curve ,#math,,'), ['Physics', 'bell curve', 'math']);
  assert.deepEqual(parseHashtags('#Shorts physics, #physics !!! #Math'), ['#Shorts', '#physics', '#Math']);
  assert.deepEqual(parseHashtags(['#a b', '#']), ['#ab']);
  const v = mk({ description: 'Hello #physics', hashtags: ['#Shorts', '#physics'] });
  assert.equal(descriptionWithHashtags(v), 'Hello #physics\n\n#Shorts', 'only missing hashtags are appended');
  assert.match(copyAll(v), /^.+\n\nHello #physics\n\n#Shorts\n\nTags: /);
  const s = suggestMetadata({ sceneName: 'X', family: 'unknown-family', sceneDescription: 'd', hook: '', styleName: 'Y' });
  assert.ok(s.title.length > 0, 'unknown family and empty hook still give a title');
});

test('checks warn about limits and missing publishing details, never throw', () => {
  const base = mk();
  assert.deepEqual(checkMetadata(base), []);
  const bad = mk({ title: 'x'.repeat(120), tags: Array.from({ length: 80 }, (_, i) => 'tag number ' + i), hashtags: Array.from({ length: 61 }, (_, i) => '#h' + i), status: 'published', youtubeUrl: 'hello' });
  const fields = checkMetadata(bad).map(w => w.field);
  for (const f of ['title', 'tags', 'hashtags', 'youtubeUrl']) assert.ok(fields.includes(f as never), f);
  assert.ok(checkMetadata(mk({ status: 'scheduled' })).some(w => w.field === 'scheduledAt'));
  assert.ok(checkMetadata(mk({ status: 'published' })).some(w => w.field === 'youtubeUrl'));
  assert.ok(isYoutubeUrl('https://www.youtube.com/shorts/AbCdEf12345') && isYoutubeUrl('https://youtu.be/AbCdEf12345') && isYoutubeUrl('https://youtube.com/watch?v=AbCdEf12345'));
  assert.ok(!isYoutubeUrl('https://example.com/shorts/AbCdEf12345') && !isYoutubeUrl(''));
});

// ---------------- status changes ----------------
test('status changes through patchVideo: dates, whitelist, invalid values', () => {
  const v0 = mk(), t = new Date(2026, 10, 20, 12, 0);
  const v1 = patchVideo(v0, { status: 'rendered' }, t);
  assert.equal(v1.status, 'rendered'); assert.equal(v1.updatedAt, t.toISOString()); assert.equal(v1.createdAt, v0.createdAt);
  const v2 = patchVideo(v1, { status: 'scheduled', scheduledAt: '2026-11-25T09:30' }, t);
  assert.equal(v2.scheduledAt, '2026-11-25T09:30');
  const v3 = patchVideo(v2, { status: 'published' }, t);
  assert.equal(v3.publishedAt, '2026-11-20', 'publishing stamps today when no date was given');
  assert.equal(patchVideo(v3, { status: 'published', publishedAt: '2026-11-22' }, t).publishedAt, '2026-11-22', 'an explicit date wins');
  const v4 = patchVideo(v3, { youtubeUrl: ' https://youtu.be/AbCdEf12345 ', notes: 'went well' }, t);
  assert.equal(v4.youtubeUrl, 'https://youtu.be/AbCdEf12345'); assert.equal(v4.status, 'published'); assert.equal(v4.notes, 'went well');
  assert.equal(patchVideo(v4, { status: 'draft' }, t).publishedAt, '2026-11-20', 'going back keeps the history');
  // whitelist and garbage
  const evil = patchVideo(v4, { id: 'hacked', sceneId: 'x', file: '../../etc/passwd', params: { a: 1 }, createdAt: 'x', status: 'bogus', scheduledAt: 'tomorrow', publishedAt: '20/11/2026', thumbSec: -3 }, t);
  assert.equal(evil.id, v4.id); assert.equal(evil.sceneId, v4.sceneId); assert.equal(evil.file, v4.file); assert.deepEqual(evil.params, v4.params);
  assert.equal(evil.status, 'draft', 'invalid status -> draft'); assert.equal(evil.scheduledAt, ''); assert.equal(evil.publishedAt, ''); assert.equal(evil.thumbSec, null);
  assert.equal(patchVideo(v4, 'nonsense' as never), v4);
  assert.equal(patchVideo(v4, { thumbSec: 12.5, thumbFile: 'a/b.png' }, t).thumbFile, 'ab.png', 'path separators are stripped');
  assert.match(nextStep(v0), /Render/); assert.match(nextStep(v1), /Upload/); assert.match(nextStep(v2), /link/); assert.match(nextStep(v4), /Done/);
});

test('sanitize: garbage in, valid out; non-objects dropped', () => {
  assert.equal(sanitizeVideo(null), null); assert.equal(sanitizeVideo('x'), null); assert.equal(sanitizeVideo([1]), null);
  const v = sanitizeVideo({ title: 5, tags: 'a, b', status: 7, durationSec: 'NaN', style: '', createdAt: 'never', params: [1] })!;
  assert.equal(v.title, ''); assert.deepEqual(v.tags, ['a', 'b']); assert.equal(v.status, 'draft'); assert.equal(v.durationSec, 0);
  assert.equal(v.style, 'classic'); assert.ok(!Number.isNaN(Date.parse(v.createdAt))); assert.deepEqual(v.params, {}); assert.ok(v.id.startsWith('v-'));
});

// ---------------- list: filter, search, coverage, export ----------------
test('filter, search, counts, coverage and CSV', () => {
  const blank = { description: '', tags: [], hashtags: [] };
  const a = mk({ ...blank, id: 'a', title: 'Bell curve from chance', status: 'published', sceneId: 'galton-board', style: 'riso', updatedAt: '2026-11-03T00:00:00Z', youtubeUrl: 'https://youtu.be/AbCdEf12345' });
  const b = mk({ ...blank, id: 'b', title: 'Orbit "flower", closing', status: 'rendered', sceneId: 'rosette-orbit', style: 'chalk', updatedAt: '2026-11-02T00:00:00Z' });
  const c = mk({ ...blank, id: 'c', title: 'Draft idea', status: 'draft', sceneId: 'billiard', style: 'classic', updatedAt: '2026-11-04T00:00:00Z', notes: 'maybe café' });
  const all = [a, b, c];
  assert.deepEqual(statusCounts(all), { all: 3, draft: 1, rendered: 1, scheduled: 0, published: 1 });
  assert.deepEqual(filterVideos(all, { status: 'all' }).map(v => v.id), ['c', 'a', 'b'], 'newest first');
  assert.deepEqual(filterVideos(all, { status: 'published' }).map(v => v.id), ['a']);
  assert.deepEqual(filterVideos(all, { query: 'BELL' }).map(v => v.id), ['a']);
  assert.deepEqual(filterVideos(all, { query: 'cafe' }).map(v => v.id), ['c'], 'accent-insensitive, searches notes');
  assert.deepEqual(filterVideos(all, { query: 'chalkboard' }, { style: id => (id === 'chalk' ? 'Chalkboard' : id) }).map(v => v.id), ['b'], 'searches display names');
  assert.deepEqual(filterVideos(all, { query: 'zzz' }), []);
  const sceneIds = SCENES.map(s => s.meta.id), styleIds = themeIds();
  const cov = coverage(all, sceneIds, styleIds);
  assert.equal(cov.total, sceneIds.length * styleIds.length); assert.equal(cov.none, cov.total - 3);
  assert.equal(cov.cells['galton-board|riso'], 'published'); assert.equal(cov.cells['rosette-orbit|chalk'], 'rendered'); assert.equal(cov.cells['galton-board|candy'], 'none');
  assert.equal(coverage([...all, mk({ sceneId: 'galton-board', style: 'riso', status: 'draft' })], sceneIds, styleIds).cells['galton-board|riso'], 'published', 'the furthest status wins');
  const csv = toCsv(all);
  assert.ok(csv.startsWith('﻿id,status,title')); assert.ok(csv.includes('"Orbit ""flower"", closing"'), 'quotes escaped');
  assert.equal(csv.trim().split('\r\n').length, 4);
});

// ---------------- storage: atomic writes, backups, recovery ----------------
test('save writes a versioned file; reload gives the same list; export works', () => {
  const dir = tmp(), s = openStore(dir, { now: clock });
  assert.equal(s.takeNotice(), null, 'first run is silent'); assert.deepEqual(s.list(), []);
  const v = mk({ id: 'one' });
  s.mutate(vs => ({ videos: [...vs, v], result: null }));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, SCHEMA_VERSION); assert.equal(onDisk.videos.length, 1);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'no temp files left');
  const again = openStore(dir, { now: clock });
  assert.equal(again.list().length, 1); assert.equal(again.get('one')!.title, v.title); assert.equal(again.takeNotice(), null);
  assert.equal(JSON.parse(again.exportJson()).videos.length, 1);
  assert.ok(again.exportCsv().includes('one'));
});

test('atomic write: a failure while replacing leaves the old file whole and the list unchanged', () => {
  const dir = tmp(), s = openStore(dir, { now: clock });
  s.mutate(vs => ({ videos: [mk({ id: 'keep' })], result: null }));
  const before = fs.readFileSync(path.join(dir, 'videos.json'), 'utf8');
  const failing = openStore(dir, { now: clock, io: { ...fs, renameSync: ((a: string, b: string) => { if (String(b).endsWith('videos.json')) throw new Error('disk exploded'); return fs.renameSync(a, b); }) as typeof fs.renameSync } });
  assert.throws(() => failing.mutate(vs => ({ videos: [...vs, mk({ id: 'lost' })], result: null })), /disk exploded/);
  assert.equal(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8'), before, 'the real file is untouched');
  assert.deepEqual(failing.list().map(v => v.id), ['keep'], 'memory matches disk after a failed save');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'the temp file is cleaned up');
  // a failure while writing the temp file (disk full)
  const full = openStore(dir, { now: clock, io: { ...fs, writeSync: (() => { throw new Error('ENOSPC'); }) as typeof fs.writeSync } });
  assert.throws(() => full.mutate(vs => ({ videos: [], result: null })), /ENOSPC/);
  assert.equal(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('every overwrite is preceded by a backup; retention keeps the newest and one per day', () => {
  const dir = tmp(), s = openStore(dir, { now: clock, keepBackups: 3 });
  for (let i = 0; i < 7; i++) s.mutate(vs => ({ videos: [...vs, mk({ id: 'v' + i })], result: null }));
  const files = s.backupList();
  assert.equal(files.length, 3, 'newest 3 kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.backups, files[0]), 'utf8')).videos.length, 6, 'the newest backup is the state before the last save');
  assert.equal(fs.readdirSync(s.backups).filter(f => f.startsWith('daily-')).length, 1, 'one snapshot for the day');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'videos.json'), 'utf8')).videos.length, 7);
});

test('recovery: damaged file is kept aside and the newest backup restored, with a clear notice', () => {
  const dir = tmp(), s = openStore(dir, { now: clock });
  for (let i = 0; i < 3; i++) s.mutate(vs => ({ videos: [...vs, mk({ id: 'v' + i })], result: null }));
  const cases: [string, string][] = [['truncated JSON', '{"schemaVersion":1,"videos":[{"id":"x"'], ['empty file', ''], ['array', '[]'], ['null', 'null'], ['no version', '{"videos":[]}'], ['binary junk', '\u0000\u0001\u0002'], ['no list', '{"schemaVersion":1}']];
  for (const [name, junk] of cases) {
    fs.writeFileSync(path.join(dir, 'videos.json'), junk);
    const r = openStore(dir, { now: clock });
    assert.equal(r.list().length, 2, `${name}: restored from the newest backup`);
    const n = r.takeNotice()!;
    assert.ok(n && n.level === 'warn' && /could not be used/.test(n.text) && /Restored the newest backup/.test(n.text), `${name}: notice`);
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith('videos.damaged-')), `${name}: damaged file kept`);
    assert.equal(openStore(dir, { now: clock }).list().length, 2, `${name}: the restored file is valid on the next start`);
  }
  assert.ok(fs.readdirSync(dir).filter(f => f.startsWith('videos.damaged-')).length >= cases.length - 1, 'nothing was deleted');
});

test('recovery: damaged with no backup starts empty; missing file starts empty or restores a backup', () => {
  const d1 = tmp(); fs.writeFileSync(path.join(d1, 'videos.json'), '{broken');
  const a = openStore(d1, { now: clock });
  assert.deepEqual(a.list(), []); assert.match(a.takeNotice()!.text, /starts empty/); assert.ok(fs.readdirSync(d1).some(f => f.startsWith('videos.damaged-')), 'the broken file is kept');
  a.mutate(vs => ({ videos: [mk({ id: 'new' })], result: null })); // and the studio keeps working
  assert.equal(openStore(d1, { now: clock }).list().length, 1);
  // missing file, no backups: silent empty list
  const d2 = tmp(); assert.equal(openStore(d2).takeNotice(), null);
  // missing main file but a backup exists
  const d3 = tmp(), s3 = openStore(d3, { now: clock });
  s3.mutate(vs => ({ videos: [mk({ id: 'a' })], result: null })); s3.mutate(vs => ({ videos: [...vs, mk({ id: 'b' })], result: null }));
  fs.rmSync(path.join(d3, 'videos.json'));
  const r3 = openStore(d3, { now: clock });
  assert.equal(r3.list().length, 1); assert.match(r3.takeNotice()!.text, /was missing\. Restored/);
});

test('newer schema is never overwritten blindly; bad entries are skipped, good ones kept', () => {
  const d = tmp(); const future = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, videos: [{ id: 'f' }] });
  fs.writeFileSync(path.join(d, 'videos.json'), future);
  const s = openStore(d, { now: clock });
  assert.deepEqual(s.list(), []); assert.match(s.takeNotice()!.text, /newer/);
  assert.ok(fs.readdirSync(d).some(f => f.startsWith('videos.newer-')) && fs.readFileSync(path.join(d, fs.readdirSync(d).find(f => f.startsWith('videos.newer-'))!), 'utf8') === future);
  const d2 = tmp();
  fs.writeFileSync(path.join(d2, 'videos.json'), JSON.stringify({ schemaVersion: 1, videos: [mk({ id: 'ok' }), 42, null, 'x', { id: 'ok', title: 'dup' }, { title: 'no id' }] }));
  const s2 = openStore(d2, { now: clock });
  assert.equal(s2.list().length, 3, 'the good ones, the duplicate id renamed'); assert.equal(new Set(s2.list().map(v => v.id)).size, 3);
  assert.match(s2.takeNotice()!.text, /3 entries .* skipped/);
  assert.equal(parseStore('{"schemaVersion":1,"videos":[]}').ok, true);
});

test('a data folder that cannot be created does not crash opening; saving reports the error', () => {
  const base = tmp(), blocker = path.join(base, 'file'); fs.writeFileSync(blocker, 'x');
  const s = openStore(path.join(blocker, 'data'), { now: clock });
  assert.deepEqual(s.list(), []);
  assert.throws(() => s.mutate(vs => ({ videos: [mk()], result: null })));
  assert.deepEqual(s.list(), [], 'unsaved change is not kept in memory');
});

// ---------------- YouTube limits (verified against the official pages, see docs/report.md §11.4) ----------------
test('limits follow the official numbers: bytes for the description, 60 hashtags, 11-character ids, no < or >', () => {
  assert.deepEqual(LIMITS, { title: 100, description: 5000, tags: 500, hashtags: 60 });
  assert.equal(utf8Bytes('é'), 2); assert.equal(utf8Bytes('😀'), 4);
  const ok = mk({ description: 'a'.repeat(5000) });
  assert.deepEqual(checkMetadata(ok).filter(w => w.field === 'description'), []);
  assert.ok(checkMetadata(mk({ description: 'é'.repeat(2501) })).some(w => w.field === 'description' && /bytes/.test(w.text)), '2501 two-byte letters = 5002 bytes');
  assert.ok(!checkMetadata(mk({ hashtags: Array.from({ length: 60 }, (_, i) => '#h' + i) })).some(w => w.field === 'hashtags'));
  assert.ok(checkMetadata(mk({ title: 'a <b> c' })).length > 0, 'angle brackets are flagged');
  assert.equal(tagsLength(['Foo Baz']), 9, 'a tag with a space counts its quotation marks (YouTube docs example)');
  assert.equal(tagsLength(['Foo-Baz']), 7);
  assert.equal(tagsLength(['a', 'b']), 3, 'the comma counts');
  assert.ok(isYoutubeUrl('https://www.youtube.com/watch?v=Ya_4rht4DG8') && isYoutubeUrl('https://www.youtube.com/watch?feature=share&v=Ya_4rht4DG8'));
  assert.ok(!isYoutubeUrl('https://youtu.be/short') && !isYoutubeUrl('https://youtu.be/Ya_4rht4DG8extra'.replace('extra', 'XX')) , 'ids are exactly 11 characters');
  assert.ok(isYoutubeUrl('https://youtu.be/Ya_4rht4DG8?si=abc'));
});

// ---------------- suggestion language ----------------
test('suggestion language: English default, Indonesian alternative, both valid; the choice is stored and validated', () => {
  assert.deepEqual(LANGS.map(l => l.id), ['en', 'id']);
  for (const s of SCENES) {
    const en = suggestFor(s.meta.id, {})!, id = suggestFor(s.meta.id, {}, 'id')!;
    assert.notEqual(en.description, id.description); assert.notEqual(en.title, id.title, `${s.meta.id}: lead title differs`);
    assert.match(id.description, /Subscribe agar|simulasi/i);
    assert.ok(id.title.length <= LIMITS.title && tagsLength(id.tags) <= LIMITS.tags && id.hashtags[0] === '#Shorts' && id.hashtags.includes('#fisika'));
    assert.ok(id.titleIdeas.includes(en.titleIdeas[0]) || id.titleIdeas.length >= 2, 'the on-screen hook stays available as an idea');
    assert.deepEqual(suggestFor(s.meta.id, {}, 'en'), en, 'default language is English');
  }
  assert.match(newVideoFor('galton-board', {}, {}, new Date(), 'id')!.description, /Semua yang tampil/);
  // English descriptions now vary in wording (see tests/copywriter.test.ts), so check the language, not one fixed sentence
  const en = newVideoFor('galton-board', {})!.description;
  assert.match(en, /simulation/i); assert.match(en, /subscribe/i); assert.doesNotMatch(en, /Semua yang tampil/);
  const d = tmp(), s = openStore(d, { now: clock });
  assert.equal(s.settings().suggestLang, 'en');
  s.setSuggestLang('id');
  assert.equal(openStore(d, { now: clock }).settings().suggestLang, 'id', 'stored in data/videos.json');
  fs.writeFileSync(path.join(d, 'videos.json'), JSON.stringify({ schemaVersion: 1, videos: [], settings: { suggestLang: 'klingon' } }));
  assert.equal(openStore(d, { now: clock }).settings().suggestLang, 'en', 'an invalid stored language falls back to English');
});

// ---------------- CLI renders found by scanning output/ ----------------
test('scan: CLI renders are found once, never duplicated, and unfinished or unreadable ones are skipped', () => {
  const out = tmp(), now = Date.now();
  const make = (name: string, rec: unknown, ageMs = 60000, size = 10) => {
    fs.writeFileSync(path.join(out, name + '.mp4'), Buffer.alloc(size, 1));
    if (rec !== null) fs.writeFileSync(path.join(out, name + '.job.json'), typeof rec === 'string' ? rec : JSON.stringify(rec));
    const t = new Date(now - ageMs); fs.utimesSync(path.join(out, name + '.mp4'), t, t);
  };
  make('galton-board-2026-11-18T10-00-00', { sceneId: 'galton-board', params: { style: 'riso' } });  // stamped CLI render
  make('my-custom-name', { sceneId: 'billiard', params: {} });                                      // --out with any name
  make('mirrors-ellipse', { sceneId: 'focal-reflection', params: {} }, 99999);
  make('no-record', null);                                                                           // no .job.json
  make('broken-record', '{not json');
  make('wrong-scene', { sceneId: 'does-not-exist' });
  make('still-writing', { sceneId: 'billiard', params: {} }, 2000);                                  // changed 2 s ago
  make('empty-file', { sceneId: 'billiard', params: {} }, 60000, 0);
  make('studio-job-running', { sceneId: 'billiard', params: {} });
  fs.writeFileSync(path.join(out, 'note.txt'), 'x'); fs.mkdirSync(path.join(out, 'frames.mp4'));
  const opts = { nowMs: now, knownScene: (id: string) => SCENES.some(s => s.meta.id === id), ignoreIds: new Set(['studio-job-running']) };
  const found = findUntrackedRenders(out, { tracked: new Set(), ...opts });
  assert.deepEqual(found.map(f => f.file).sort(), ['galton-board-2026-11-18T10-00-00.mp4', 'mirrors-ellipse.mp4', 'my-custom-name.mp4']);
  assert.equal(found.find(f => f.file.startsWith('galton'))!.params.style, 'riso');
  const tracked = new Set(['my-custom-name.mp4']);
  assert.deepEqual(findUntrackedRenders(out, { tracked, ...opts }).map(f => f.file).sort(), ['galton-board-2026-11-18T10-00-00.mp4', 'mirrors-ellipse.mp4'], 'tracked files are not listed again');
  const all = new Set(found.map(f => f.file));
  assert.deepEqual(findUntrackedRenders(out, { tracked: all, ...opts }), [], 'after import nothing is left');
  assert.deepEqual(findUntrackedRenders(path.join(out, 'missing-folder'), { tracked: new Set() }), [], 'a missing folder is just empty');
  assert.equal(fs.existsSync(path.join(out, 'my-custom-name.mp4')), true, 'scanning never touches the files');
});

// ---------------- lock: one writer, stale locks taken over ----------------
test('lock: the second studio is read-only and cannot write; a stale lock is taken over; release frees it', () => {
  const d = tmp(), alive = new Set([111, 222]), isAlive = (p: number) => alive.has(p);
  const a = openStore(d, { now: clock, lock: true, pid: 111, isAlive });
  assert.equal(a.readOnly, false); assert.equal(JSON.parse(fs.readFileSync(path.join(d, '.lock'), 'utf8')).pid, 111);
  a.mutate(vs => ({ videos: [mk({ id: 'one' })], result: null }));
  const before = fs.readFileSync(path.join(d, 'videos.json'), 'utf8'), listing = fs.readdirSync(d).sort().join();
  const b = openStore(d, { now: clock, lock: true, pid: 222, isAlive });
  assert.equal(b.readOnly, true); assert.match(b.readOnlyReason, /process 111/); assert.equal(b.list().length, 1, 'read-only still shows the data');
  assert.throws(() => b.mutate(vs => ({ videos: [], result: null })), ReadOnlyError);
  assert.throws(() => b.setSuggestLang('id'), ReadOnlyError);
  assert.equal(fs.readFileSync(path.join(d, 'videos.json'), 'utf8'), before, 'the read-only studio wrote nothing');
  assert.equal(fs.readdirSync(d).sort().join(), listing, 'and created no files');
  assert.equal(b.retryLock(), false, 'still held by a live process');
  // first studio killed (no release): its lock file stays, the process is gone
  alive.delete(111);
  assert.equal(b.retryLock(), true); assert.equal(b.readOnly, false); assert.equal(JSON.parse(fs.readFileSync(path.join(d, '.lock'), 'utf8')).pid, 222);
  b.mutate(vs => ({ videos: [...vs, mk({ id: 'two' })], result: null }));
  assert.equal(b.list().length, 2);
  // a clean release removes the lock and does not remove someone else's
  b.close(); assert.equal(fs.existsSync(path.join(d, '.lock')), false);
  const c = openStore(d, { now: clock, lock: true, pid: 333, isAlive: () => false }); assert.equal(c.readOnly, false); assert.equal(c.list().length, 2);
  fs.writeFileSync(path.join(d, '.lock'), JSON.stringify({ pid: 999 })); a.close(); c.close();
  assert.equal(fs.existsSync(path.join(d, '.lock')), true, 'a lock owned by another pid is left alone');
});

test('lock: garbage lock files and an unwritable folder do not crash; a damaged data file stays untouched when read-only', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, '.lock'), 'garbage'); const old = new Date(Date.now() - 60000); fs.utimesSync(path.join(d, '.lock'), old, old);
  const s = openStore(d, { now: () => new Date(), lock: true, pid: 5, isAlive: () => true });
  assert.equal(s.readOnly, false, 'an old unreadable lock is stale'); s.close();
  const fresh = tmp(); fs.writeFileSync(path.join(fresh, '.lock'), '');
  assert.equal(openStore(fresh, { now: () => new Date(), lock: true, pid: 5, isAlive: () => true }).readOnly, true, 'a just-created empty lock may belong to a starting studio');
  const base = tmp(), blocker = path.join(base, 'f'); fs.writeFileSync(blocker, 'x');
  const bad = openStore(path.join(blocker, 'data'), { lock: true });
  assert.equal(bad.readOnly, true); assert.match(bad.readOnlyReason, /cannot be created/);
  // damaged data + another studio holding the lock: nothing is moved or restored on disk
  const dd = tmp(), holder = openStore(dd, { now: clock, lock: true, pid: 1, isAlive: () => true });
  holder.mutate(vs => ({ videos: [mk({ id: 'x' })], result: null })); holder.mutate(vs => ({ videos: [mk({ id: 'y' })], result: null }));
  fs.writeFileSync(path.join(dd, 'videos.json'), '{broken');
  const ro = openStore(dd, { now: clock, lock: true, pid: 2, isAlive: () => true });
  assert.equal(ro.readOnly, true); assert.equal(ro.list().length, 1, 'shows the newest backup in memory'); assert.match(ro.takeNotice()!.text, /untouched/);
  assert.equal(fs.readFileSync(path.join(dd, 'videos.json'), 'utf8'), '{broken', 'the damaged file was not moved or replaced');
  assert.equal(fs.readdirSync(dd).some(f => f.startsWith('videos.damaged')), false);
});

// ---------------- titles of template variants ----------------
test('hammer-smash and sync-lines: variants of one rule/mode get different titles, with the hook first and no new numbers', async () => {
  const { variantTag, topicFor, factsFor } = await import('../packages/publish/describe.ts');
  const { checkQuality } = await import('../packages/publish/quality.ts');
  const hammer = ['circle', 'square', 'octagon', 'triangle', 'ring'].flatMap(container => ['ball', 'star', 'gem'].map(objects => ({ rule: 'box', container, objects })));
  const sync = [
    ...['circle', 'square', 'ring'].flatMap(container => ['consecutive', 'odd', 'primes'].map(laps => ({ mode: 'lid', container, laps, motion: 'gravity' }))),
    ...['circle', 'square'].flatMap(container => ['circle', 'flower4', 'pulse'].map(hidden => ({ mode: 'slider', container, hidden }))),
  ];
  for (const [sceneId, list] of [['hammer-smash', hammer], ['sync-lines', sync]] as const) {
    const titles = new Set<string>();
    for (const params of list) {
      const sug = suggestFor(sceneId, params)!;
      titles.add(sug.title);
      assert.ok(sug.title.length <= LIMITS.title && !/\d/.test(variantTag(sceneId, params)), `${sceneId}: tag has no digits, title fits`);
      assert.match(sug.title, / — /, `${sceneId}: the tag follows the hook`);
      const v = { ...newVideoFor(sceneId, params)!, status: 'rendered' as const, file: 'x.mp4', thumbFile: 'x.png' };
      const bad = checkQuality(v, { topic: topicFor(sceneId, params), facts: factsFor(sceneId, params) }).filter(q => q.severity !== 'info');
      assert.deepEqual(bad, [], `${sceneId}: no warnings for ${JSON.stringify(params)}`);
    }
    assert.ok(titles.size >= list.length * 0.9, `${sceneId}: ${titles.size} different titles for ${list.length} variants`);
  }
  assert.equal(variantTag('galton-board', {}), '', 'other scenes keep their titles');
  assert.equal(suggestFor('galton-board', {})!.title.includes(' — '), false);
});
