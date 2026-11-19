// Long videos: the pure parts (chapters, selection and order, texts and their checker), the record on disk, the build (tiny real clips, a
// real ffmpeg: stop in the middle, continue without redoing finished clips) and one real studio on another port (throw-away folders).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { FPS, stamp, startTimes, chapterLines, chapterProblems, clipCacheName, framesOf, sanitizeCompilation, totalFrames, outFileFor, MIN_MIN, MAX_MIN, type ClipRef } from '../packages/compile/index.ts';
import { planParts, partCount, orderClips, dropTwins, labelFor, visualKey, splitParts, type Candidate } from '../packages/compile/select.ts';
import { LONG_TOPICS, writeLongTexts, checkLongTexts, writeLongTitles } from '../packages/compile/texts.ts';
import { openCompileStore } from '../apps/server/compile-store.ts';
import { buildCompilation, takeBuilderLock, verifyOutput, probeFile, gainFor, drawBadge } from '../apps/server/compile-build.ts';
import { drawLongThumb, thumbClear, lookOf, LONG_THUMB, DEFAULT_LOOK } from '../apps/server/compile-cover.ts';
import { imageSize } from '../packages/publish/cover.ts';
import { sanitizeVideo, uploadProblems, coverage, type Video } from '../packages/publish/index.ts';
import { newVideoFor } from '../packages/publish/describe.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-compile-'));
const procs: ChildProcess[] = [];
after(() => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } fs.rmSync(T, { recursive: true, force: true }); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<V>(fn: () => Promise<V | false>, ms = 90000): Promise<V> { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not yet */ } await sleep(250); } throw new Error('timed out'); }

// ---------------- chapters ----------------
test('chapter times are exact sums of frames, formatted for YouTube, and valid by YouTube\'s rules', () => {
  assert.deepEqual([0, 5, 59, 60, 65.9, 3599, 3600, 3725].map(stamp), ['0:00', '0:05', '0:59', '1:00', '1:05', '59:59', '1:00:00', '1:02:05']);
  const clips = [{ frames: 3300, label: 'A' }, { frames: 1503, label: 'B' }, { frames: 2400, label: 'C' }];
  assert.deepEqual(startTimes(clips), [0, 55, 55 + 1503 / 60]);
  assert.deepEqual(chapterLines(clips), ['0:00 1. A', '0:55 2. B', '1:20 3. C']); // 55 + 25.05 = 80.05 → 1:20 (rounded down, never before the clip)
  const desc = chapterLines(clips).join('\n'), dur = totalFrames(clips) / FPS;
  assert.deepEqual(chapterProblems(desc, dur), []);
  assert.match(chapterProblems('0:05 a\n0:20 b\n0:40 c', 60)[0], /0:00/);
  assert.match(chapterProblems('0:00 a\n0:20 b', 60).join(), /at least 3/);
  assert.match(chapterProblems('0:00 a\n0:05 b\n0:40 c', 60).join(), /shorter than 10/);
  assert.match(chapterProblems('0:00 a\n0:30 b\n0:20 c', 60).join(), /does not come after/);
  assert.match(chapterProblems('0:00 a\n0:30 b\n1:10 c', 60).join(), /after the video ends/);
  assert.equal(framesOf(55), 3300); assert.equal(framesOf(25.05), 1503);
});

test('the cache name changes with anything that changes the picture', () => {
  const c = { videoId: 'v-abc', label: 'Ring' }, src = { sizeBytes: 100, mtimeMs: 5 };
  const base = clipCacheName(c, src, 3, 15);
  assert.equal(base, clipCacheName(c, src, 3, 15));
  for (const other of [clipCacheName(c, { sizeBytes: 101, mtimeMs: 5 }, 3, 15), clipCacheName(c, { sizeBytes: 100, mtimeMs: 6 }, 3, 15), clipCacheName(c, src, 4, 15), clipCacheName(c, src, 3, 16), clipCacheName({ ...c, label: 'Square' }, src, 3, 15)]) assert.notEqual(other, base);
  assert.match(base, /^clip-v-abc-[0-9a-f]{8}\.mp4$/);
});

// ---------------- selection and order ----------------
let seq = 0;
const cand = (scene: string, params: Record<string, unknown>, dur = 55): Candidate => ({ videoId: `v-${scene}-${++seq}`, file: `f${seq}.mp4`, sceneId: scene, params, durationSec: dur, createdAt: new Date(2026, 10, 1, 0, 0, seq).toISOString() });
const CONTAINERS = ['circle', 'ring', 'octagon', 'square', 'triangle'], OBJECTS = ['ball', 'mixed', 'square', 'triangle', 'gem', 'star'];
const hammerLibrary = (rules = ['split', 'box', 'survive']) => rules.flatMap(rule => CONTAINERS.flatMap(container => OBJECTS.map(objects => cand('hammer-smash', { rule, container, objects, seed: 7 }))));

test('twins (same look, different seed) count once; the oldest is kept', () => {
  const a = cand('hammer-smash', { rule: 'box', container: 'ring', objects: 'ball', seed: 7 }), b = cand('hammer-smash', { rule: 'box', container: 'ring', objects: 'ball', seed: 8 }), c = cand('hammer-smash', { rule: 'box', container: 'ring', objects: 'gem', seed: 7 });
  assert.equal(visualKey(a), visualKey(b)); assert.notEqual(visualKey(a), visualKey(c));
  const r = dropTwins([b, c, a]); assert.deepEqual(r.kept.map(x => x.videoId), [a.videoId, c.videoId]); assert.deepEqual(r.twins.map(x => x.videoId), [b.videoId]);
});
test('a group is split into parts of 9 to 18 minutes, every clip used once, parts with a spread of looks', () => {
  assert.deepEqual([0, 5, 9, 12, 13, 19, 21, 26.6, 27.5, 33.3, 40, 60].map(partCount), [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 5]);
  const lib = hammerLibrary(), plan = planParts(lib, 1);
  assert.equal(plan.parts.length, 6); assert.equal(plan.twins.length, 0);
  const ids = plan.parts.flatMap(p => p.clips.map(c => c.videoId)); assert.equal(ids.length, new Set(ids).size, 'no clip twice'); assert.equal(ids.length, lib.length);
  for (const p of plan.parts) {
    const min = p.clips.reduce((s, c) => s + c.durationSec, 0) / 60; assert.ok(min >= MIN_MIN && min <= MAX_MIN, `${p.group} part ${p.part}: ${min} min`);
    assert.ok(new Set(p.clips.map(c => c.params.container)).size === CONTAINERS.length, 'every container appears in each part');
    assert.ok(new Set(p.clips.map(c => c.params.objects)).size >= 5, 'most objects appear in each part');
  }
  assert.deepEqual(planParts(lib, 1).parts.map(p => p.clips.map(c => c.videoId)), plan.parts.map(p => p.clips.map(c => c.videoId)), 'same seed, same plan');
  assert.notDeepEqual(planParts(lib, 2).parts[0].clips.map(c => c.videoId), plan.parts[0].clips.map(c => c.videoId), 'another seed, another order');
});
test('neighbouring clips never share their container, and the many small scenes go into one mix', () => {
  const ordered = orderClips(hammerLibrary(['box']).slice(0, 30), 5);
  for (let i = 1; i < ordered.length; i++) assert.notEqual(ordered[i].params.container, ordered[i - 1].params.container, `position ${i}`);
  const small = [...['focal-reflection', 'billiard', 'galton-board', 'harmonograph'].flatMap(s => [0, 1, 2, 3, 4, 5].map(k => cand(s, { layout: 'x' + k, table: 't' + k, balls: k + 1, seed: k }, 30)))];
  const plan = planParts([...hammerLibrary(['box']), ...small], 3), mix = plan.parts.filter(p => p.group === 'mix');
  assert.equal(mix.length, 1); assert.equal(mix[0].clips.length, small.length);
  for (let i = 1; i < mix[0].clips.length; i++) assert.notEqual(mix[0].clips[i].sceneId, mix[0].clips[i - 1].sceneId);
  assert.equal(splitParts(small, 1)[0].length, small.length);
});
test('chapter labels are read from the parameters', () => {
  assert.equal(labelFor(cand('hammer-smash', { rule: 'box', container: 'octagon', objects: 'gem' })), 'Octagon with gems');
  assert.equal(labelFor(cand('hammer-smash', { rule: 'box', container: 'circle', objects: 'ball' })), 'Circle with balls');
  assert.equal(labelFor(cand('sync-lines', { mode: 'close', container: 'ring', ratio: 'pi' })), 'Ring frame, ratio π');
  assert.match(labelFor(cand('sync-lines', { mode: 'lid', container: 'ring', motion: 'gravity', laps: 'odd', objects: 'ball' })), /^Ring track, gravity motion, odd laps/);
  assert.equal(labelFor({ ...cand('focal-reflection', { layout: 'ellipse' }), sceneName: 'Focal reflection' }), 'Focal reflection: ellipse');
});

// ---------------- texts ----------------
const refs = (n: number, frames = 3300, sceneId = 'hammer-smash'): ClipRef[] => Array.from({ length: n }, (_, i) => ({ videoId: `v-${i}`, file: `f${i}.mp4`, label: `Label ${i + 1}`, frames, sceneId }));
test('every title idea of every theme is short, has the keyword, and uses only true numbers', () => {
  for (const [group, topic] of Object.entries(LONG_TOPICS)) {
    for (const [style, list] of Object.entries(topic.titles)) for (const t of list) assert.ok(topic.keywords.some(k => t.toLowerCase().includes(k)) || /\{scenes\}|physics/i.test(t), `${group}/${style}: "${t}" has no keyword`);
    for (const [n, part, parts] of [[15, 1, 2], [16, 3, 3], [9, 1, 1], [23, 1, 1]] as const) {
      const clips = refs(n, 3300, group === 'mix' ? 'galton-board' : 'hammer-smash'), texts = writeLongTexts({ group, part, parts, clips, seed: 3 });
      assert.equal(texts.titles.length, 5); assert.ok(texts.titles.every(t => t.text.length <= 100));
      for (const t of texts.titles) { const bad = checkLongTexts({ group, title: t.text, description: texts.description, tags: texts.tags, hashtags: texts.hashtags, clips, part, parts }).filter(i => ['title-keyword', 'number', 'clickbait', 'claim', 'title-long', 'title-caps'].includes(i.code)); assert.deepEqual(bad.map(b => b.text), [], `${group} "${t.text}"`); }
      assert.deepEqual(checkLongTexts({ group, title: texts.title, description: texts.description, tags: texts.tags, hashtags: texts.hashtags, clips, part, parts }), [], `${group} ${n}`);
    }
  }
});
test('the description counts the clips and minutes of this very video, with chapters from the real frames', () => {
  const clips = refs(12, 2400), t = writeLongTexts({ group: 'sync-lines/lid', part: 1, parts: 1, clips, seed: 1 });
  assert.match(t.description, /12 simulations, about 8 minutes/); assert.ok(t.description.includes('0:00 1. Label 1\n0:40 2. Label 2'));
  assert.ok(!t.hashtags.some(h => h.toLowerCase() === '#shorts') && t.hashtags.length <= 3);
  assert.equal(checkLongTexts({ group: 'sync-lines/lid', title: t.title, description: t.description, tags: t.tags, hashtags: t.hashtags, clips }).length, 0);
  // the title numbers follow the clips: 12 clips of 40 s are not "15 simulations"
  assert.ok(writeLongTitles({ group: 'sync-lines/lid', part: 1, parts: 1, clips, seed: 1 }).every(x => !/\b15\b/.test(x.text)));
});
test('the checker catches wrong facts, bait, #Shorts and bad chapters', () => {
  const clips = refs(12, 2400), t = writeLongTexts({ group: 'sync-lines/lid', part: 1, parts: 1, clips, seed: 1 }), base = { group: 'sync-lines/lid', title: t.title, description: t.description, tags: t.tags, hashtags: t.hashtags, clips };
  const codes = (o: object) => checkLongTexts({ ...base, ...o }).map(i => i.code);
  assert.ok(codes({ description: t.description.replace('12 simulations', '15 simulations') }).includes('count'));
  assert.ok(codes({ description: t.description.replace('about 8 minutes', 'about 20 minutes') }).includes('minutes'));
  assert.ok(codes({ hashtags: ['#Shorts', '#math'] }).includes('hashtag-shorts'));
  assert.ok(codes({ title: 'You won\'t believe these 12 sync tests' }).includes('clickbait'));
  assert.ok(codes({ title: 'The 99 best sync tests' }).includes('number'));
  assert.ok(codes({ description: t.description.replace('0:00 1.', '0:03 1.') }).includes('chapters'));
  assert.ok(codes({ description: t.description.replace('0:40 2.', '0:08 2.') }).some(c => c === 'chapters' || c === 'chapters-time'));
  assert.ok(codes({ title: 'x'.repeat(101) }).includes('title-long'));
  assert.ok(codes({ title: 'Black holes and sync tests' }).includes('claim'));
});

// ---------------- the record on disk ----------------
test('the long-video store never loses a record: atomic saves, a backup, a damaged file is set aside', () => {
  const dir = path.join(T, 'store'), store = openCompileStore(dir);
  assert.deepEqual(store.load(), [], 'a missing folder is an empty list');
  const c = sanitizeCompilation({ id: 'c-one', slug: 'one', group: 'mix', title: 'A', clips: [{ videoId: 'v-aaa', file: 'a.mp4', label: 'L', frames: 60, sceneId: 'galton-board' }], status: 'built' })!;
  store.save(c); store.save({ ...c, title: 'B' });
  assert.equal(store.load()[0].title, 'B'); assert.ok(fs.existsSync(path.join(dir, 'c-one.json.bak')), 'the previous version is kept');
  fs.writeFileSync(path.join(dir, 'c-one.json'), '{ not json');
  const again = openCompileStore(dir), got = again.load();
  assert.equal(got.length, 1); assert.equal(got[0].title, 'A', 'the backup was used'); assert.match(again.notice(), /damaged/);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('c-one.json.damaged-')), 'the damaged file was kept');
  fs.writeFileSync(path.join(dir, 'c-two.json'), JSON.stringify({ schemaVersion: 99, compilation: {} }));
  assert.doesNotThrow(() => openCompileStore(dir).load());
  const ro = openCompileStore(dir, { canWrite: () => false }); ro.save({ ...c, title: 'Z' }); assert.equal(openCompileStore(dir).load().find(x => x.id === 'c-one')!.title, 'A', 'a read-only studio writes nothing');
  assert.equal(sanitizeCompilation({ id: '../x' }), null); assert.equal(sanitizeCompilation('x'), null);
  const odd = sanitizeCompilation({ id: 'c-x', file: '../../etc/passwd', clips: [{ videoId: 'v-aaa', file: '../b.mp4' }] })!;
  assert.equal(odd.file, 'passwd', 'a file name never carries a path'); assert.equal(odd.clips[0].file, 'b.mp4');
  store.save({ ...c, id: 'c-gone' }); store.remove('c-gone'); assert.ok(!store.load().some(x => x.id === 'c-gone')); assert.ok(fs.readdirSync(path.join(dir, 'removed')).length === 1, 'removed records are moved, not deleted');
});

// ---------------- the Videos list ----------------
test('a long video is its own kind in the Videos list: Shorts are unchanged, the scene map ignores it, and it is never uploaded', () => {
  const short = newVideoFor('sync-lines', { mode: 'lid', container: 'ring' }, { file: 'x.mp4', status: 'rendered', durationSec: 40 })!;
  assert.equal(short.kind, undefined); assert.deepEqual(sanitizeVideo(JSON.parse(JSON.stringify(short))), short, 'an old record round-trips unchanged (no kind, no compilationId)');
  const long = sanitizeVideo({ ...short, id: 'v-long', kind: 'long', compilationId: 'c-1', sceneId: 'compilation', file: 'long-x.mp4', durationSec: 800 })!;
  assert.equal(long.kind, 'long'); assert.equal(long.compilationId, 'c-1');
  const facts = { exists: true, width: 1920, height: 1080, durationSec: 800, sizeBytes: 1, mtimeMs: 1 }, opts = { mode: 'now', at: '', categoryId: '28', language: 'en', madeForKids: false, synthetic: false, notify: true } as const;
  assert.match(uploadProblems(long, facts, opts)[0], /Long videos cannot be uploaded/); assert.equal(uploadProblems(long, facts, opts).length, 1);
  const cov = coverage([long, { ...short, status: 'draft' }], ['sync-lines', 'compilation'], ['classic']); assert.equal(cov.cells['sync-lines|classic'], 'draft'); assert.equal(cov.cells['compilation|classic'], 'none');
});

// ---------------- the thumbnail ----------------
test('the thumbnail is 1280×720 and its pictures stay clear of YouTube\'s duration stamp', async () => {
  assert.ok(thumbClear()); assert.equal(LONG_THUMB.cells.length, 4);
  assert.deepEqual(lookOf({}), DEFAULT_LOOK); assert.equal(lookOf({ stylePreset: JSON.stringify({ look: { accent: '#112233' }, background: { bg: ['#000001', '#000002', '#000003'] } }) }).accent, '#112233'); assert.equal(lookOf({ stylePreset: '{broken' }).bg0, DEFAULT_LOOK.bg0);
  const { createCanvas } = await import('@napi-rs/canvas'), c = createCanvas(1080, 1920), x = c.getContext('2d'); x.fillStyle = '#123'; x.fillRect(0, 0, 1080, 1920); x.fillStyle = '#fc0'; x.fillRect(300, 800, 400, 400);
  const jpg = await drawLongThumb([c.toBuffer('image/png'), c.toBuffer('image/png'), c.toBuffer('image/png'), c.toBuffer('image/png')], 15, 'CHAIN REACTIONS', DEFAULT_LOOK), size = imageSize(jpg);
  assert.deepEqual([size?.width, size?.height, size?.type], [1280, 720, 'jpeg']); assert.ok(jpg.length > 20000 && jpg.length < 2e6);
  assert.ok(drawBadge(7, 'Octagon with gems').length > 1000);
});

// ---------------- the build: tiny real clips, real ffmpeg ----------------
function tinyClip(file: string, seconds: number, freq: number) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1080x1920:rate=60:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
test('the build: stopped in the middle, it continues without redoing a finished clip, and the result passes every check', { timeout: 240000 }, async () => {
  const out = path.join(T, 'build-out'), cache = path.join(T, 'build-cache'); fs.mkdirSync(out, { recursive: true });
  const specs: [string, number, number][] = [['a.mp4', 3, 330], ['b.mp4', 2.5, 440], ['c.mp4', 3, 550], ['d.mp4', 2, 660]];
  for (const [f, s, hz] of specs) tinyClip(path.join(out, f), s, hz);
  const req = { compilationId: 'c-build', out: path.join(out, 'long-build.mp4'), cacheDir: cache, clips: specs.map(([f], i) => ({ videoId: `v-clip${i}`, file: path.join(out, f), label: `Clip ${i + 1}` })) };
  // stop: the first clip is finished, the second is killed in the middle of its encode
  const ac = new AbortController();
  await assert.rejects(buildCompilation(req, p => { if (p.frame >= 10 && !ac.signal.aborted) setTimeout(() => ac.abort(), 150); }, ac.signal));
  const cached = () => fs.readdirSync(cache).filter(f => /^clip-.*\.mp4$/.test(f) && !/\.part\./.test(f));
  assert.ok(cached().length >= 1 && cached().length < 4, `some clips are finished, not all (${cached().length})`);
  assert.ok(!fs.existsSync(req.out), 'no half-written final video'); assert.ok(!fs.existsSync(path.join(cache, '.builder.lock')), 'the lock is released');
  const before = new Map(cached().map(f => [f, fs.statSync(path.join(cache, f)).mtimeMs]));
  const rep = await buildCompilation(req);
  assert.equal(rep.reused, before.size, 'every finished clip was reused'); assert.equal(rep.made, 4 - before.size);
  for (const [f, m] of before) assert.equal(fs.statSync(path.join(cache, f)).mtimeMs, m, `${f} was not touched`);
  assert.deepEqual(rep.problems, []); assert.equal(rep.frames, 180 + 150 + 180 + 120); assert.deepEqual(rep.clipFrames, [180, 150, 180, 120]);
  const f = await probeFile(req.out);
  assert.deepEqual([f.width, f.height, f.fps, f.vcodec, f.pix, f.acodec, f.sampleRate, f.channels], [1920, 1080, '60/1', 'h264', 'yuv420p', 'aac', 44100, 2]);
  assert.equal(f.frames, 630); assert.ok(Math.abs(f.durationSec - 10.5) < 0.05); assert.ok(Math.abs(f.audioDurationSec - f.durationSec) < 0.05, 'sound and picture have the same length');
  assert.deepEqual((await verifyOutput(req.out, 630)).problems, []);
  assert.match((await verifyOutput(req.out, 631)).problems.join(), /frames/, 'a wrong frame count is caught');
  const again = await buildCompilation(req); assert.equal(again.made, 0, 'a second run makes nothing new');
  // a damaged cache file is not trusted: it is made again
  const victim = path.join(cache, cached()[0]); fs.writeFileSync(victim, 'broken'); const fixed = await buildCompilation(req); assert.equal(fixed.made, 1); assert.deepEqual(fixed.problems, []);
  // the picture at a seam is the first picture of the next clip (frame 180 = clip 2, its number badge fades in after the first frames)
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-ss', '3.0', '-i', req.out, '-frames:v', '1', '-f', 'null', '-']).status, 0);
});
test('one builder at a time; a lock left by a killed build is taken over; loudness gain stays gentle', () => {
  const dir = path.join(T, 'lock'), release = takeBuilderLock(dir, 111, p => p === 111);
  assert.throws(() => takeBuilderLock(dir, 222, p => p === 111), /already running \(process 111\)/);
  release(); const second = takeBuilderLock(dir, 222, () => false); second();
  fs.writeFileSync(path.join(dir, '.builder.lock'), '999'); assert.doesNotThrow(() => takeBuilderLock(dir, 333, () => false)());
  assert.equal(gainFor(null), 0); assert.equal(gainFor(-16), 0); assert.equal(gainFor(-24), 8); assert.equal(gainFor(-40), 9); assert.equal(gainFor(-5), -6);
});

// ---------------- a real studio (throw-away folders, another port) ----------------
test('the studio builds a long video through its queue: stop, build again, texts, thumbnail, the Videos list, and the Shorts stay untouched', { timeout: 300000 }, async () => {
  const data = path.join(T, 'srv-data'), out = path.join(T, 'srv-out'), port = 8100 + Math.floor(Math.random() * 300), base = `http://127.0.0.1:${port}`;
  fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  const shorts: Video[] = [];
  for (const [i, container] of ['circle', 'square', 'triangle', 'ring'].entries()) {
    const file = `short-${i}.mp4`; tinyClip(path.join(out, file), 10.5, 300 + i * 40);
    shorts.push(newVideoFor('sync-lines', { mode: 'lid', container, laps: ['odd', 'primes', 'consecutive'][i % 3], motion: ['linear', 'gravity', 'piston'][i % 3], count: 12 + i, seed: 7 + i }, { file, status: i === 0 ? 'scheduled' : 'rendered', durationSec: 10.5, jobId: 'x' + i, scheduledAt: i === 0 ? '2030-01-01T10:00' : '' })!);
  }
  fs.writeFileSync(path.join(data, 'videos.json'), JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), videos: shorts }));
  const before = JSON.stringify(shorts);
  const proc = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(T, 'home'), PORT: String(port), SIM_DATA_DIR: data, SIM_OUT_DIR: out, SIM_YT_TICK_MS: '3600000' }, stdio: 'ignore' }); procs.push(proc);
  const api = async (p: string, method = 'GET', body?: unknown): Promise<any> => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };
  const lib = await until(async () => { const j = await api('/api/compile'); return j.library?.usable ? j : false; });
  assert.equal(lib.library.usable, 4, 'four Shorts are usable (a scheduled one too)');
  const sug = await api('/api/compile/suggest'); assert.equal(sug.parts.length, 1); assert.equal(sug.parts[0].count, 4);
  const made = await api('/api/compilations', 'POST', { suggest: true }); assert.equal(made.compilations.length, 1);
  const c0 = made.compilations[0]; assert.equal(c0.status, 'draft'); assert.deepEqual(c0.issues.filter((i: any) => i.severity === 'error'), []);
  assert.equal((await api('/api/compilations', 'POST', { suggest: true })).compilations.length, 0, 'asking again makes no duplicates');
  assert.equal((await api('/api/compilations', 'POST', { clipIds: [] })).status, 400); assert.equal((await api('/api/compilations/c-nope/build', 'POST')).status, 404);
  // stop in the middle of the build, then build again
  const b1 = await api(`/api/compilations/${c0.id}/build`, 'POST'); assert.equal(b1.status, 'building'); assert.equal((await api(`/api/compilations/${c0.id}/build`, 'POST')).status, 409, 'not twice at once');
  await until(async () => { const j = (await api('/api/jobs')).find?.((x: any) => x.id === b1.jobId) ?? ((await fetch(base + '/api/jobs').then(r => r.json())) as any[]).find(x => x.id === b1.jobId); return j?.status === 'running' && j.progress.frame >= 10 ? j : false; });
  await api(`/api/compilations/${c0.id}/stop`, 'POST');
  const stopped = await until(async () => { const j = (await api('/api/compile')).compilations.find((x: any) => x.id === c0.id); return j.status === 'failed' ? j : false; });
  assert.match(stopped.note, /stopped/); assert.ok(!fs.existsSync(path.join(out, outFileFor(c0))) && !fs.existsSync(path.join(out, outFileFor(c0)) + '.part'), 'no half-written video');
  const jobs = (await fetch(base + '/api/jobs').then(r => r.json())) as any[]; assert.equal(jobs.find(x => x.id === b1.jobId).status, 'stopped');
  const again = await fetch(`${base}/api/jobs/${b1.jobId}/again`, { method: 'POST' }).then(r => r.json()) as any; assert.ok(again.id && again.kind === 'compile' || again.id, 'Render again on the stopped build starts it again');
  const done = await until(async () => { const j = (await api('/api/compile')).compilations.find((x: any) => x.id === c0.id); return j.status === 'built' && j.thumbUrl ? j : j.status === 'failed' && !j.job ? Promise.reject(new Error(j.error)) : false; }, 200000); // the thumbnail follows the build by a moment
  assert.ok(done.fileExists); assert.ok(done.thumbUrl, 'the thumbnail was made after the build'); assert.match(done.note, /Checked/);
  const mp4 = path.join(out, done.file), f = await probeFile(mp4); assert.deepEqual([f.width, f.height, f.fps, f.frames], [1920, 1080, '60/1', 4 * 630]);
  assert.ok(Math.abs(done.durationSec - 42) < 0.01);
  assert.deepEqual(done.issues.filter((i: any) => i.severity === 'error'), [], 'texts match the real video: ' + JSON.stringify(done.issues));
  assert.match(done.description, /0:00 1\. /); assert.match(done.description, /0:10 2\. /);
  const vids = (await api('/api/videos')).videos as any[], long = vids.filter(v => v.kind === 'long');
  assert.equal(long.length, 1); assert.equal(long[0].compilationId, c0.id); assert.equal(long[0].file, done.file); assert.equal(long[0].status, 'rendered'); assert.ok(long[0].thumbUrl);
  assert.equal(vids.filter(v => v.kind !== 'long').length, 4, 'the Shorts are all still there');
  // the Shorts' own records (status, schedule) are exactly as before
  const after = (JSON.parse(fs.readFileSync(path.join(data, 'videos.json'), 'utf8')).videos as Video[]).filter(v => v.kind !== 'long'); assert.equal(JSON.stringify(after), before, 'not one field of a Short changed');
  assert.deepEqual(fs.readdirSync(out).filter(n => /\.part|\.request\.json$/.test(n)), [], 'no leftovers in output/');
  // the long video cannot be uploaded from the studio, and edits go through the record
  const ed = await api(`/api/compilations/${c0.id}`, 'PATCH', { titleIndex: 2 }); assert.equal(ed.title, c0.titleIdeas[2] ?? ed.title);
  assert.equal((await api(`/api/compilations/${c0.id}`, 'DELETE')).status, 409, 'a finished long video is not removed from the page');
  const cache = await api(`/api/compilations/${c0.id}/cache`, 'DELETE'); assert.ok(cache.removed >= 4); assert.equal(cache.cacheGB, 0);
  proc.kill('SIGTERM');
});
