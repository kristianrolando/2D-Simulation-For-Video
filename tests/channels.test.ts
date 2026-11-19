// Two channels on one studio, end to end against the local stand-in of Google (tests/fake-google.ts). A real studio server with its own
// HOME (so ~/Library/Application Support is a temp folder), data/ and output/. Nothing here talks to Google.
// Covers: the single-channel file is migrated (with a backup), a second channel is connected only after the owner confirms it, every call
// uses the token of the video's channel, "Upload from Sim Studio" off refuses every sending path, the upload limit holds one channel only,
// one channel can be disconnected without the other, per-video channel choice, manual uploads, and the per-channel schedule tools.
import { usablePort } from './ports.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { startFakeGoogle, type FakeChannel } from './fake-google.ts';
import { sanitizeVideo, channelLocked, youtubeIdOf } from '../packages/publish/index.ts';
import { planFileFor, planChannel, videoOnChannel, limitHold } from '../packages/publish/schedule.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-ch-'));
const HOME = path.join(T, 'home'), DATA = path.join(T, 'data'), OUT = path.join(T, 'out');
const SUPPORT = path.join(HOME, 'Library', 'Application Support', 'Sim Studio');
const PORT = usablePort(6100 + Math.floor(Math.random() * 200));
const BASE = `http://127.0.0.1:${PORT}`;
const PH: FakeChannel = { id: 'UCphotonlab00001', title: 'Photon Lab', customUrl: '@PhotonPlayground' };
const PP: FakeChannel = { id: 'UCplasmapend0001', title: 'Plasma Pendulum', customUrl: '@PlasmaPendulum' };
let fake: Awaited<ReturnType<typeof startFakeGoogle>>;
let server: ChildProcess | null = null, serverLog = '';
const responses: string[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function seed() {
  for (const d of [HOME, DATA, OUT, path.join(DATA, 'thumbnails'), SUPPORT]) fs.mkdirSync(d, { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(OUT, 'clip.mp4')]);
  assert.equal(r.status, 0, String(r.stderr));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920', '-frames:v', '1', path.join(DATA, 'thumbnails', 'tall.jpg')]);
  const now = new Date().toISOString();
  const base = { description: 'A test upload.', tags: ['physics'], hashtags: ['#Shorts'], status: 'rendered', file: 'clip.mp4', durationSec: 1, sceneId: 'galton-board', style: 'classic', coverFile: 'tall.jpg', createdAt: now, updatedAt: now };
  const pp = { channel: 'Plasma Pendulum', channelId: PP.id };
  const recs: Record<string, unknown>[] = [
    ...['p-1', 'p-2', 'p-3', 'p-4'].map(id => ({ id, title: `Test ${id}` })),        // older records: no channel at all (= Photon Lab)
    ...['pp-1', 'pp-2', 'pp-3', 'pp-man'].map(id => ({ id, title: `Test ${id}`, ...pp })),
    { id: 'p-sched', title: 'Test p-sched', status: 'scheduled', scheduledAt: '2030-01-01T10:00' },
    { id: 'l-1', title: 'Test long', kind: 'long', compilationId: 'c-1', file: 'clip.mp4', durationSec: 700 },
  ];
  const videos = recs.map(x => sanitizeVideo({ ...base, ...x }, now)!).map(v => { const o: any = { ...v }; if (!recs.find(r => r.id === v.id)!.channel) delete o.channel; return o; });
  fs.writeFileSync(path.join(DATA, 'videos.json'), JSON.stringify({ schemaVersion: 1, savedAt: now, videos }, null, 2));
  // the youtube.json written before channels existed: one refresh token and one channel at the top
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  fs.writeFileSync(path.join(SUPPORT, 'youtube.json'), JSON.stringify({ client: { id: '123-abc.apps.googleusercontent.com', secret: 'GOCSPX-fake-secret-123' }, refresh: '1//legacy-refresh-token-0001', scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    channel: { id: PH.id, name: PH.title, handle: PH.customUrl }, connectedAt: '2026-11-18T10:00:00.000Z', quota: { day, units: 3300, uploads: 2 }, defaults: { lastTime: '19:30' } }), { mode: 0o600 });
}
async function startServer() {
  serverLog = '';
  server = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME, PORT: String(PORT), SIM_DATA_DIR: DATA, SIM_OUT_DIR: OUT, SIM_GOOGLE_FAKE: fake.url, SIM_YT_POLL_MS: '150', SIM_YT_QUOTA_WAIT_MS: '1500', SIM_YT_TICK_MS: '200', SIM_YT_CHUNK: String(256 * 1024), SIM_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', d => { serverLog += d; }); server.stderr!.on('data', d => { serverLog += d; });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${BASE}/api/status`)).ok) return; } catch { /* starting */ } await sleep(150); }
  throw new Error('studio did not start:\n' + serverLog);
}
async function stopServer() { if (!server) return; const s = server; server = null; const done = new Promise(r => s.on('exit', r)); s.kill('SIGTERM'); await done; }
async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); responses.push(text);
  let j: any = {}; try { j = JSON.parse(text); } catch { j = { text }; }
  return { status: r.status, j };
}
const video = async (id: string) => (await api('GET', '/api/videos')).j.videos.find((v: any) => v.id === id);
const yts = async () => (await api('GET', '/api/youtube')).j;
const conn = async (id: string) => (await yts()).connections.find((c: any) => c.id === id);
async function until(fn: () => Promise<boolean>, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw new Error('timed out; server log:\n' + serverLog.slice(-2000)); }
const inFuture = (min: number) => { const d = new Date(Date.now() + min * 60e3), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function upload(id: string, options: Record<string, unknown> = { mode: 'schedule', at: inFuture(120) }) {
  const c = await api('POST', `/api/videos/${id}/youtube/check`, { options });
  if (c.j.problems?.length) return { status: 400, j: { error: c.j.problems[0], check: c.j } };
  return api('POST', `/api/videos/${id}/youtube/upload`, { options, consent: c.j.consent, agree: true });
}
const settled = (id: string) => until(async () => { const v = await video(id); return !!v?.youtube && (v.youtube.stage === 'done' || v.youtube.stage === 'failed'); });
/** Google's sign-in, with the picker set to `ch`: returns the page the studio shows after it */
async function signIn(ch: FakeChannel) {
  fake.ctl.channel = ch;
  const c = await api('POST', '/api/youtube/connect'), back = (await fetch(c.j.url, { redirect: 'manual' })).headers.get('location')!;
  const page = await (await fetch(back)).text(); responses.push(page); return page;
}
/** the same, without blocking this process (the stand-in of Google lives here and must keep answering) */
const runAsync = (tool: string, ...a: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>(ok => {
  const c = spawn(process.execPath, [`tools/${tool}`, ...a], { cwd: ROOT, env: { ...process.env, SIM_DATA_DIR: DATA, SIM_OUT_DIR: OUT, HOME } });
  let stdout = '', stderr = ''; c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; }); c.on('close', status => ok({ status, stdout, stderr }));
});
const run = (tool: string, ...a: string[]) => spawnSync(process.execPath, [`tools/${tool}`, ...a], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SIM_DATA_DIR: DATA, SIM_OUT_DIR: OUT, HOME } });

before(async () => { fake = await startFakeGoogle(); seed(); await startServer(); });
after(async () => { await stopServer(); fake.close(); fs.rmSync(T, { recursive: true, force: true }); });

// ---------------- pure ----------------
test('pure helpers: channel lock, video ids, plan files, upload-limit hold', () => {
  const v = sanitizeVideo({ id: 'x', status: 'rendered' })!;
  assert.equal(channelLocked(v), ''); assert.match(channelLocked({ ...v, status: 'scheduled' }), /keeps its channel/);
  assert.match(channelLocked({ ...v, youtube: { videoId: 'a' } as any }), /upload record/); assert.match(channelLocked({ ...v, uploadedManually: 'x' }), /by hand/);
  assert.equal(youtubeIdOf('abcdefghijk'), 'abcdefghijk'); assert.equal(youtubeIdOf('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeIdOf('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk'); assert.equal(youtubeIdOf('https://example.com/abcdefghijk'), ''); assert.equal(youtubeIdOf('short'), '');
  assert.equal(planFileFor('Photon Lab'), 'schedule.json', 'Photon Lab keeps its plan file'); assert.equal(planFileFor('Plasma Pendulum'), 'schedule-plasma-pendulum.json');
  assert.equal(planChannel({}), 'Photon Lab', 'the plan from before channels is Photon Lab\'s');
  assert.ok(videoOnChannel({}, 'Photon Lab')); assert.ok(!videoOnChannel({ channel: 'Plasma Pendulum' }, 'Photon Lab')); assert.ok(videoOnChannel({ channel: 'X', channelId: 'UC1' }, 'UC1', 'Plasma'));
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(limitHold('2026-11-19T00:00:00Z', now), '2026-11-20T00:00:00.000Z'); assert.equal(limitHold('2026-11-18T11:00:00Z', now), ''); assert.equal(limitHold('', now), '');
});

// ---------------- migration ----------------
test('the single-channel file becomes one connection (Photon Lab, uploads on); a backup is kept (600); no secret in the answer', async () => {
  const st = await yts();
  assert.equal(st.connections.length, 1);
  const c = st.connections[0];
  assert.equal(c.name, 'Photon Lab'); assert.equal(c.handle, '@PhotonPlayground'); assert.equal(c.uploadEnabled, true); assert.equal(c.active, true); assert.equal(c.connected, true);
  assert.equal(c.uploadsToday, 2, 'today\'s uploads were all this channel\'s'); assert.equal(st.quota.units, 3300, 'the shared quota count is kept');
  assert.equal(st.connected, true); assert.equal(st.channel.name, 'Photon Lab'); assert.equal(st.defaults.lastTime, '19:30');
  const bak = path.join(SUPPORT, 'youtube.json.bak-single-channel');
  assert.equal(fs.statSync(bak).mode & 0o777, 0o600); assert.ok(fs.readFileSync(bak, 'utf8').includes('"refresh": ') || fs.readFileSync(bak, 'utf8').includes('"refresh":'), 'the backup is the old file');
  const now = JSON.parse(fs.readFileSync(path.join(SUPPORT, 'youtube.json'), 'utf8'));
  assert.ok(Array.isArray(now.connections) && now.refresh === undefined && now.channel === undefined, 'rewritten once in the new shape');
  assert.equal(fs.statSync(path.join(SUPPORT, 'youtube.json')).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(st).includes('legacy-refresh') && !JSON.stringify(st).includes('GOCSPX'), 'no secret in the answer');
  // the legacy token is unknown to the stand-in, like a permission that expired: the first call says "connect again" and sends nothing
  const fail = await upload('p-4');
  assert.equal(fail.status, 401); assert.equal((await video('p-4')).youtube, undefined);
  assert.equal((await conn(PH.id)).connected, false);
  // signing in to the same channel again renews it and keeps its switch (a channel that is still connected would be refused)
  const page = await signIn(PH);
  assert.match(page, /Connected/); assert.equal((await conn(PH.id)).uploadEnabled, true); assert.equal((await yts()).connections.length, 1);
});

test('Photon Lab after the migration: an older video (no channel) uploads exactly as before', async () => {
  const r = await upload('p-1');
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await settled('p-1');
  const v = await video('p-1');
  assert.equal(v.youtube.stage, 'done', v.youtube.error); assert.equal(v.status, 'scheduled');
  assert.equal(v.youtube.channelId, PH.id); assert.equal(v.channelId, PH.id, 'the video is now locked to its channel'); assert.equal(v.channel, 'Photon Lab');
  assert.equal(fake.ctl.videos.get(v.youtube.videoId)!.channelId, PH.id); assert.equal(fake.ctl.videos.get(v.youtube.videoId)!.thumbDims, '1080x1920');
  assert.equal(fake.ctl.wrongChannel, 0);
});

// ---------------- second channel ----------------
test('a second channel is kept only after the owner confirms it, starts with uploads OFF, and the active channel stays', async () => {
  const page = await signIn(PP);
  assert.match(page, /Connect this channel\?/); assert.match(page, /Plasma Pendulum/); assert.match(page, /Upload from Sim Studio: Off/);
  assert.equal((await yts()).connections.length, 1, 'nothing kept before the confirmation');
  const t = /name="t" value="(\w+)"/.exec(page)![1];
  const done = await (await fetch(`${BASE}/oauth/youtube/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${t}&yes=1` })).text();
  assert.match(done, /Connected/);
  const replay = await (await fetch(`${BASE}/oauth/youtube/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${t}&yes=1` })).text();
  assert.match(replay, /old or was already used/, 'the confirmation is single use');
  const st = await yts();
  assert.equal(st.connections.length, 2);
  const pp = st.connections.find((c: any) => c.id === PP.id);
  assert.equal(pp.uploadEnabled, false); assert.equal(pp.connected, true); assert.equal(pp.active, false);
  assert.equal(st.channel.name, 'Photon Lab', 'the active channel did not change');
  // the same channel again: refused, nothing changes
  const again = await signIn(PP);
  assert.match(again, /already connected/); assert.equal((await yts()).connections.length, 2);
});

test('uploads OFF: check, upload, continue, thumbnail again and the schedule runner all refuse; rendering texts still works', async () => {
  const c = await api('POST', '/api/videos/pp-1/youtube/check', { options: { mode: 'schedule', at: inFuture(120) } });
  assert.match(c.j.problems[0], /turned off for this channel/); assert.equal(c.j.consent, ''); assert.equal(c.j.channel.name, 'Plasma Pendulum');
  const up = await api('POST', '/api/videos/pp-1/youtube/upload', { options: { mode: 'schedule', at: inFuture(120) }, consent: 'x', agree: true });
  assert.equal(up.status, 400); assert.match(up.j.error, /turned off/);
  assert.equal(fake.ctl.insertsBy[PP.id] ?? 0, 0, 'nothing reached the channel');
  // texts and covers stay editable
  assert.equal((await api('PATCH', '/api/videos/pp-1', { title: 'Edited while off' })).status, 200);
  // turning it on for a channel that is not the active one needs its name
  const no = await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: true });
  assert.equal(no.status, 400); assert.match(no.j.error, /Confirm with the channel name/); assert.equal((await conn(PP.id)).uploadEnabled, false);
});

test('two channels: each video goes to its own channel with its own token; Photon Lab is untouched', async () => {
  assert.equal((await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: true, confirmName: 'Plasma Pendulum' })).status, 200);
  const c = await api('POST', '/api/videos/pp-1/youtube/check', { options: { mode: 'schedule', at: inFuture(150) } });
  assert.deepEqual(c.j.problems, []); assert.equal(c.j.channel.id, PP.id);
  const r = await upload('pp-1', { mode: 'schedule', at: inFuture(150) });
  assert.equal(r.status, 200, JSON.stringify(r.j)); await settled('pp-1');
  const r2 = await upload('p-2', { mode: 'schedule', at: inFuture(160) });
  assert.equal(r2.status, 200, JSON.stringify(r2.j)); await settled('p-2');
  const a = await video('pp-1'), b = await video('p-2');
  assert.equal(a.youtube.stage, 'done', a.youtube.error); assert.equal(b.youtube.stage, 'done', b.youtube.error);
  assert.equal(fake.ctl.videos.get(a.youtube.videoId)!.channelId, PP.id); assert.equal(fake.ctl.videos.get(b.youtube.videoId)!.channelId, PH.id);
  assert.ok(fake.ctl.videos.get(a.youtube.videoId)!.thumbBytes > 0, 'the thumbnail went through with Plasma Pendulum\'s token');
  assert.equal(fake.ctl.wrongChannel, 0, 'no call ever used the other channel\'s token');
  const st = await yts();
  assert.equal((await conn(PP.id)).uploadsToday, 1); assert.equal((await conn(PH.id)).uploadsToday, 4, '2 from before + p-1 + p-2');
  assert.equal(st.quota.uploads, 5, 'the shared count adds both channels');
  // a consent made for one channel does not work once the video is meant for the other
  const k1 = (await api('POST', '/api/videos/p-3/youtube/check', { options: { mode: 'schedule', at: inFuture(170) } })).j.consent;
  assert.equal((await api('PUT', '/api/videos/p-3/channel', { channelId: PP.id })).status, 200);
  const k2 = (await api('POST', '/api/videos/p-3/youtube/check', { options: { mode: 'schedule', at: inFuture(170) } })).j.consent;
  assert.ok(k1 && k2 && k1 !== k2, 'the consent names the channel');
  assert.equal((await api('PUT', '/api/videos/p-3/channel', { channelId: PH.id })).status, 200);
});

test('switching uploads OFF again stops continuing and the thumbnail again; turning it on continues as before', async () => {
  assert.equal((await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: false })).status, 200);
  const re = await api('POST', '/api/videos/pp-1/youtube/rethumb', { agree: true });
  assert.equal(re.status, 409); assert.match(re.j.error, /turned off/);
  // a stopped upload of an OFF channel cannot be continued
  const file = JSON.parse(fs.readFileSync(path.join(DATA, 'videos.json'), 'utf8'));
  await stopServer();
  const rec = file.videos.find((x: any) => x.id === 'pp-1'); rec.youtube.stage = 'failed'; rec.youtube.failedAt = 'thumbnail'; rec.youtube.error = 'test';
  fs.writeFileSync(path.join(DATA, 'videos.json'), JSON.stringify(file)); await startServer();
  const res = await api('POST', '/api/videos/pp-1/youtube/resume');
  assert.equal(res.status, 409); assert.match(res.j.error, /turned off/);
  assert.equal((await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: true, confirmName: 'Plasma Pendulum' })).status, 200);
  assert.equal((await api('POST', '/api/videos/pp-1/youtube/resume')).status, 200);
  await until(async () => (await video('pp-1')).youtube.stage === 'done');
  assert.equal(fake.ctl.wrongChannel, 0);
});

test('the channel\'s own upload limit holds only that channel', async () => {
  fake.ctl.uploadLimit.add(PP.id);
  const r = await upload('pp-2', { mode: 'schedule', at: inFuture(200) });
  assert.equal(r.status, 429); assert.match(r.j.error, /upload limit/);
  const pp = await conn(PP.id); assert.ok(pp.limitAt, 'noted on Plasma Pendulum');
  assert.equal((await conn(PH.id)).limitAt, '', 'not on Photon Lab');
  const ok = await upload('p-3', { mode: 'schedule', at: inFuture(210) });
  assert.equal(ok.status, 200, 'Photon Lab keeps uploading'); await settled('p-3');
  assert.equal((await video('p-3')).youtube.stage, 'done');
  fake.ctl.uploadLimit.delete(PP.id);
});

// ---------------- per-video channel, manual uploads ----------------
test('the channel of a video is chosen per video (and for several at once); a scheduled one keeps its channel', async () => {
  const one = await api('PUT', '/api/videos/p-4/channel', { channelId: PP.id });
  assert.equal(one.status, 200); assert.equal((await video('p-4')).channel, 'Plasma Pendulum'); assert.equal((await video('p-4')).channelId, PP.id);
  const locked = await api('PUT', '/api/videos/p-sched/channel', { channelId: PP.id });
  assert.equal(locked.status, 409); assert.equal((await video('p-sched')).channel, 'Photon Lab');
  const many = await api('PUT', '/api/videos/channel', { ids: ['p-4', 'p-sched', 'p-1'], channelId: PH.id });
  assert.equal(many.status, 200); assert.equal(many.j.changed, 1); assert.equal(many.j.skipped.length, 2);
  assert.equal((await video('p-4')).channel, 'Photon Lab');
  assert.equal((await api('PUT', '/api/videos/p-4/channel', { channelId: 'UCnope' })).status, 400);
});

test('new videos get the active channel; a style preset does not change it', async () => {
  assert.equal((await api('PUT', '/api/youtube/active', { channelId: PP.id })).status, 200);
  fs.copyFileSync(path.join(OUT, 'clip.mp4'), path.join(OUT, 'new-render.mp4'));
  fs.writeFileSync(path.join(OUT, 'new-render.job.json'), JSON.stringify({ sceneId: 'galton-board', params: { stylePreset: '{"id":"main-1"}' } }));
  const old = Date.now() / 1000 - 60; fs.utimesSync(path.join(OUT, 'new-render.mp4'), old, old);
  const r = await api('POST', '/api/videos/import', { files: ['new-render.mp4'] });
  assert.equal(r.j.added, 1);
  const v = (await api('GET', '/api/videos')).j.videos.find((x: any) => x.file === 'new-render.mp4');
  assert.equal(v.channel, 'Plasma Pendulum'); assert.equal(v.channelId, PP.id);
  assert.equal((await api('PUT', '/api/youtube/active', { channelId: PH.id })).status, 200);
});

test('"Mark as uploaded manually": Published without calling YouTube, out of every upload path, undoable', async () => {
  const calls = fake.ctl.log.length;
  const bad = await api('POST', '/api/videos/pp-man/manual', { url: 'https://example.com/x' });
  assert.equal(bad.status, 400);
  const r = await api('POST', '/api/videos/pp-man/manual', { url: 'https://youtu.be/abcdefghijk', date: '2026-11-19' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  let v = await video('pp-man');
  assert.equal(v.status, 'published'); assert.equal(v.publishedAt, '2026-11-19'); assert.equal(v.youtubeUrl, 'https://www.youtube.com/shorts/abcdefghijk'); assert.ok(v.uploadedManually);
  assert.equal(fake.ctl.log.length, calls, 'no call to Google');
  const chk = await api('POST', '/api/videos/pp-man/youtube/check', { options: { mode: 'schedule', at: inFuture(300) } });
  assert.ok(chk.j.problems.some((p: string) => /Rendered/.test(p)), 'not an upload candidate');
  assert.equal((await api('PUT', '/api/videos/pp-man/channel', { channelId: PH.id })).status, 409, 'its channel is fixed');
  const u = await api('POST', '/api/videos/pp-man/manual/undo');
  assert.equal(u.status, 200); v = await video('pp-man');
  assert.equal(v.status, 'rendered'); assert.equal(v.youtubeUrl, ''); assert.equal(v.uploadedManually, undefined);
  // a video the studio uploaded itself cannot be marked or unmarked this way
  assert.equal((await api('POST', '/api/videos/p-1/manual', {})).status, 409);
  assert.equal((await api('POST', '/api/videos/p-1/manual/undo')).status, 409);
  // a long video: id → watch link, no date → today
  const l = await api('POST', '/api/videos/l-1/manual', { url: 'abcdefghijk' });
  assert.equal(l.status, 200); assert.equal((await video('l-1')).youtubeUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  // helpers for the manual upload: the cover in Finder, YouTube Studio in the browser (nothing is sent)
  assert.equal((await api('POST', '/api/reveal', { where: 'thumbnails', file: 'tall.jpg' })).status, 200);
  assert.equal((await api('POST', '/api/reveal', { where: 'thumbnails', file: '../videos.json' })).status, 400);
  const o = await api('POST', '/api/open-youtube-studio'); assert.equal(o.j.url, 'https://studio.youtube.com');
});

// ---------------- schedule tools ----------------
test('schedule tools: --channel is required to plan; dry runs write nothing; an OFF channel or another channel\'s plan stops the runner', () => {
  const before = fs.readdirSync(DATA).sort();
  const noCh = run('schedule-plan.ts');
  assert.equal(noCh.status, 2); assert.match(noCh.stderr, /Which channel\?/);
  const dry = run('schedule-plan.ts', '--channel', 'Plasma Pendulum');
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /schedule-plasma-pendulum\.json/);
  assert.deepEqual(fs.readdirSync(DATA).sort(), before, 'a dry run writes nothing');
  // without --channel and without data/schedule.json the runner does not guess
  const r0 = run('schedule-run.ts', '--url', BASE, '--count', '1');
  assert.equal(r0.status, 2); assert.match(r0.stderr, /does not guess/);
  // Plasma Pendulum's plan: dry run unless --yes; OFF stops before anything is sent
  const slot = new Date(Date.now() + 3 * 3600e3).toISOString();
  const plan = { version: 1, channel: 'Plasma Pendulum', createdAt: new Date().toISOString(), seed: 1, timezone: 'WIB (UTC+7)', slotsWib: [], skipped: [], reserve: [], slots: [{ slot, wib: 'x', videoId: 'pp-3', sceneId: 'galton-board', title: 'Test pp-3', status: 'planned' }] };
  fs.writeFileSync(path.join(DATA, 'schedule-plasma-pendulum.json'), JSON.stringify(plan));
  const d = run('schedule-run.ts', '--url', BASE, '--channel', 'Plasma Pendulum', '--count', '1');
  assert.equal(d.status, 0, d.stderr); assert.match(d.stdout, /would upload/); assert.match(d.stdout, /dry run/);
  // the plan for Plasma Pendulum is not the one in data/schedule.json
  fs.writeFileSync(path.join(DATA, 'schedule.json'), JSON.stringify({ ...plan, channel: 'Plasma Pendulum' }));
  const wrong = run('schedule-run.ts', '--url', BASE, '--count', '1');
  assert.equal(wrong.status, 2); assert.match(wrong.stderr, /is the plan for Plasma Pendulum, not Photon Lab/);
  fs.rmSync(path.join(DATA, 'schedule.json'));
});

test('schedule runner: OFF refuses; ON is still held by the upload limit noted for that channel', async () => {
  assert.equal((await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: false })).status, 200);
  const off = run('schedule-run.ts', '--url', BASE, '--channel', 'Plasma Pendulum', '--count', '1', '--yes');
  assert.equal(off.status, 2); assert.match(off.stderr, /turned off for Plasma Pendulum/);
  assert.equal((await api('PUT', '/api/youtube/upload-enabled', { channelId: PP.id, enabled: true, confirmName: 'Plasma Pendulum' })).status, 200);
  // the limit noted earlier still holds this channel for a day
  const held = run('schedule-run.ts', '--url', BASE, '--channel', 'Plasma Pendulum', '--count', '1', '--yes');
  assert.equal(held.status, 2); assert.match(held.stderr, /upload limit reached/);
});

test('Photon Lab regression: the old plan (data/schedule.json, no channel in it) still runs with `--count 1` and no --channel', async () => {
  const slot = new Date(Math.ceil((Date.now() + 5 * 3600e3) / 60e3) * 60e3).toISOString(); // slots are whole minutes
  const plan = { version: 1, createdAt: new Date().toISOString(), seed: 1, timezone: 'WIB (UTC+7)', slotsWib: [], skipped: [], reserve: [], slots: [{ slot, wib: 'x', videoId: 'p-4', sceneId: 'galton-board', title: 'Test p-4', status: 'planned' }] };
  fs.writeFileSync(path.join(DATA, 'schedule.json'), JSON.stringify(plan));
  const r = await runAsync('schedule-run.ts', '--url', BASE, '--count', '1');
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /channel Photon Lab · plan schedule\.json/); assert.match(r.stdout, /finished: 1 uploaded/);
  const after = JSON.parse(fs.readFileSync(path.join(DATA, 'schedule.json'), 'utf8'));
  assert.equal(after.slots[0].status, 'uploaded'); assert.equal(after.channel, undefined, 'the old plan file is not rewritten in a new shape');
  const yv = fake.ctl.videos.get(after.slots[0].youtubeId)!; assert.equal(yv.channelId, PH.id); assert.equal(new Date(yv.publishAt).toISOString(), slot);
});

// ---------------- disconnect one ----------------
test('disconnecting one channel keeps the other connected and uploading; no secret anywhere', async () => {
  const revokes = fake.ctl.revokes;
  const r = await api('POST', '/api/youtube/disconnect', { channelId: PP.id });
  assert.equal(r.status, 200); assert.equal(fake.ctl.revokes, revokes + 1);
  const st = await yts();
  assert.equal(st.connections.length, 1); assert.equal(st.connections[0].id, PH.id); assert.equal(st.connections[0].connected, true);
  assert.equal((await video('pp-1')).youtube.stage, 'done', 'the video record stays');
  const c = await api('POST', '/api/videos/pp-3/youtube/check', { options: { mode: 'schedule', at: inFuture(240) } });
  assert.match(c.j.problems[0], /Plasma Pendulum, which is not connected/);
  assert.equal((await api('POST', '/api/youtube/sync')).status, 200, 'Photon Lab still works');
  const hits: string[] = [];
  for (const s of fake.secrets()) for (const x of responses) if (x.includes(s)) hits.push(s.slice(0, 12));
  for (const s of [...fake.secrets(), '1//legacy-refresh']) if (serverLog.includes(s)) hits.push('log ' + s.slice(0, 12));
  assert.deepEqual(hits, []);
  assert.equal(fake.ctl.deletes, 0);
});
