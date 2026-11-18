// YouTube upload, end to end against a local stand-in of Google (tests/fake-google.ts): a real studio server with its own
// HOME (so ~/Library/Application Support is a temp folder), its own data/ and output/. Nothing here talks to Google.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { startFakeGoogle } from './fake-google.ts';
import { uploadProblems, consentKey, sanitizeVideo, type Video, type FileFacts, type UploadOptions } from '../packages/publish/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-yt-'));
const HOME = path.join(T, 'home'), DATA = path.join(T, 'data'), OUT = path.join(T, 'out');
const SUPPORT = path.join(HOME, 'Library', 'Application Support', 'Sim Studio');
const PORT = 5700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let fake: Awaited<ReturnType<typeof startFakeGoogle>>;
let server: ChildProcess | null = null, serverLog = '';
const responses: string[] = []; // every studio API answer, scanned for secrets at the end

const IDS = ['v-sched', 'v-drop', 'v-now', 'v-quota', 'v-thumb', 'v-kill', 'v-expire', 'v-revoked', 'v-cover', 'v-wide'];
function seed() {
  for (const d of [HOME, DATA, OUT, path.join(DATA, 'thumbnails'), path.join(HOME, 'Downloads')]) fs.mkdirSync(d, { recursive: true });
  // a real 1080x1920 H.264 file, big enough for several 256 KB chunks
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'anoisesrc=d=2', '-t', '2', '-c:v', 'libx264', '-crf', '8', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(OUT, 'clip.mp4')]);
  assert.equal(r.status, 0, String(r.stderr));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=1080x1920', '-frames:v', '1', path.join(DATA, 'thumbnails', 'thumb.png')]);
  for (const [name, size] of [['wide.jpg', '1280x720'], ['tall.jpg', '1080x1920'], ['tall2.jpg', '1080x1920']]) spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-frames:v', '1', path.join(DATA, 'thumbnails', name)]);
  const now = new Date().toISOString();
  const pics: Record<string, Record<string, string>> = { 'v-cover': { thumbFile: 'wide.jpg', coverFile: 'tall.jpg' }, 'v-wide': { thumbFile: 'wide.jpg' } };
  const videos = IDS.map(id => sanitizeVideo({ id, title: `Test ${id}`, description: 'A test upload.', tags: ['physics', 'test'], hashtags: ['#Shorts'], status: 'rendered', file: 'clip.mp4', durationSec: 2,
    sceneId: 'galton-board', style: 'classic', thumbFile: 'thumb.png', thumbSec: 1, createdAt: now, updatedAt: now, ...pics[id] }, now));
  fs.writeFileSync(path.join(DATA, 'videos.json'), JSON.stringify({ schemaVersion: 1, savedAt: now, videos }, null, 2));
}
async function startServer() {
  serverLog = '';
  server = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME, PORT: String(PORT), SIM_DATA_DIR: DATA, SIM_OUT_DIR: OUT, SIM_GOOGLE_FAKE: fake.url, SIM_YT_POLL_MS: '150', SIM_YT_CHUNK: String(256 * 1024) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', d => { serverLog += d; }); server.stderr!.on('data', d => { serverLog += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/status`)).ok) return; } catch { /* starting */ } await sleep(150); }
  throw new Error('studio did not start:\n' + serverLog);
}
async function stopServer(sig: NodeJS.Signals = 'SIGTERM') { if (!server) return; const s = server; server = null; const done = new Promise(r => s.on('exit', r)); s.kill(sig); await done; }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); responses.push(text);
  let j: any = {}; try { j = JSON.parse(text); } catch { j = { text }; }
  return { status: r.status, j };
}
const video = async (id: string) => (await api('GET', '/api/videos')).j.videos.find((v: any) => v.id === id);
async function until(fn: () => Promise<boolean>, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw new Error('timed out; server log:\n' + serverLog.slice(-2000)); }
const inFuture = (min: number) => { const d = new Date(Date.now() + min * 60e3), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
/** the full owner path: open the dialog (check), tick the box, send the exact consent */
async function upload(id: string, options: Record<string, unknown>) {
  const c = await api('POST', `/api/videos/${id}/youtube/check`, { options });
  if (c.j.problems?.length) return { status: 400, j: { error: c.j.problems[0] } };
  return api('POST', `/api/videos/${id}/youtube/upload`, { options, consent: c.j.consent, agree: true });
}
const settled = (id: string) => until(async () => { const v = await video(id); return !!v?.youtube && (v.youtube.stage === 'done' || v.youtube.stage === 'failed'); });

before(async () => { fake = await startFakeGoogle(); seed(); await startServer(); });
after(async () => { await stopServer(); fake.close(); fs.rmSync(T, { recursive: true, force: true }); });

// ---------------- pure checks ----------------
test('readiness: only a rendered 1080x1920 MP4 of ≤3 min with valid texts and a schedule ≥30 min ahead', () => {
  const now = new Date('2026-11-18T10:00:00');
  const v = sanitizeVideo({ id: 'v1', title: 'Fine', description: 'd', status: 'rendered', file: 'a.mp4' })!;
  const f: FileFacts = { exists: true, width: 1080, height: 1920, durationSec: 40, sizeBytes: 1, mtimeMs: 1 };
  const o: UploadOptions = { mode: 'schedule', at: '2026-11-18T11:00', categoryId: '28', language: 'en', madeForKids: false, synthetic: false, notify: true };
  assert.deepEqual(uploadProblems(v, f, o, now), []);
  assert.ok(uploadProblems(v, f, { ...o, at: '2026-11-18T10:20' }, now)[0].includes('30 minutes'));
  assert.ok(uploadProblems({ ...v, status: 'draft' }, f, o, now).length);
  assert.ok(uploadProblems(v, { ...f, width: 1920, height: 1080 }, o, now).length);
  assert.ok(uploadProblems(v, { ...f, durationSec: 181 }, o, now).length);
  assert.ok(uploadProblems({ ...v, title: 'a < b' }, f, o, now).length);
  assert.ok(uploadProblems({ ...v, title: 'x'.repeat(101) }, f, o, now).length);
  assert.ok(uploadProblems({ ...v, youtube: { videoId: 'abc' } as any }, f, o, now)[0].includes('never uploads it a second time'));
  // consent changes with anything the owner agreed to
  const k = consentKey(v, f, o, 'UC1');
  assert.equal(k, consentKey(v, f, o, 'UC1'));
  for (const [vv, ff, oo, ch] of [[{ ...v, title: 'Other' }, f, o, 'UC1'], [v, { ...f, mtimeMs: 2 }, o, 'UC1'], [v, f, { ...o, at: '2026-11-18T12:00' }, 'UC1'], [v, f, { ...o, madeForKids: true }, 'UC1'], [v, f, o, 'UC2']] as [Video, FileFacts, UploadOptions, string][])
    assert.notEqual(consentKey(vv, ff, oo, ch), k);
});

test('the YouTube code never calls a delete endpoint', () => {
  for (const f of ['apps/server/youtube.ts', 'apps/server/uploader.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/['"]DELETE['"]/.test(src), `${f}: DELETE method`);
    assert.ok(!/videos\.delete|\/videos\?[^'"]*delete/i.test(src), `${f}: videos.delete`);
  }
});

// ---------------- connect ----------------
test('client file: taken from ~/Downloads, stored with mode 600 in Application Support, the download deleted', async () => {
  const dl = path.join(HOME, 'Downloads', 'client_secret_123-abc.apps.googleusercontent.com.json');
  fs.writeFileSync(dl, JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-fake-secret-123', project_id: 'sim' } }));
  const web = await api('POST', '/api/youtube/client', { text: JSON.stringify({ web: { client_id: 'x' } }) });
  assert.equal(web.status, 400); assert.match(web.j.error, /Desktop app/);
  const r = await api('POST', '/api/youtube/client', { fromDownloads: true });
  assert.equal(r.status, 200); assert.equal(r.j.client, true); assert.equal(r.j.deleted, true);
  assert.equal(fs.existsSync(dl), false, 'the downloaded client file is gone');
  const st = fs.statSync(path.join(SUPPORT, 'youtube.json'));
  assert.equal(st.mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(r.j).includes('GOCSPX'), 'the secret is not in the answer');
});

test('OAuth: PKCE + loopback, state used once, wrong state refused; channel shown', async () => {
  const c = await api('POST', '/api/youtube/connect');
  const auth = new URL(c.j.url);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('redirect_uri'), `${BASE}/oauth/youtube`);
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.force-ssl');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  const bounce = await fetch(c.j.url, { redirect: 'manual' }), back = bounce.headers.get('location')!;
  assert.ok(back.startsWith(`${BASE}/oauth/youtube?`));
  // a forged state is refused before any token request
  const forged = await (await fetch(back.replace(/state=\w+/, 'state=forged'))).text();
  assert.match(forged, /old or was already used/);
  const page = await (await fetch(back)).text();
  assert.match(page, /Connected/); assert.match(page, /Fake Science Channel/);
  const again = await (await fetch(back)).text();
  assert.match(again, /old or was already used/, 'the same callback cannot be replayed');
  const st = (await api('GET', '/api/youtube')).j;
  assert.equal(st.connected, true); assert.equal(st.channel.name, 'Fake Science Channel');
  assert.equal(fs.statSync(path.join(SUPPORT, 'youtube.json')).mode & 0o777, 0o600);
});

// ---------------- uploads ----------------
test('scheduled upload: private + publishAt, thumbnail only after processing, tracking → Scheduled, one insert', async () => {
  const at = inFuture(120);
  const c = await api('POST', '/api/videos/v-sched/youtube/check', { options: { mode: 'schedule', at } });
  assert.deepEqual(c.j.problems, []); assert.equal(c.j.channel.name, 'Fake Science Channel');
  assert.equal((await api('POST', '/api/videos/v-sched/youtube/upload', { options: { mode: 'schedule', at }, consent: c.j.consent })).status, 409, 'not ticked');
  assert.equal((await api('POST', '/api/videos/v-sched/youtube/upload', { options: { mode: 'schedule', at }, consent: 'wrong', agree: true })).status, 409, 'wrong consent');
  const ok = await api('POST', '/api/videos/v-sched/youtube/upload', { options: { mode: 'schedule', at }, consent: c.j.consent, agree: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const dup = await api('POST', '/api/videos/v-sched/youtube/upload', { options: { mode: 'schedule', at }, consent: c.j.consent, agree: true });
  assert.ok(dup.status >= 400, 'a second click does nothing');
  await settled('v-sched');
  const v = await video('v-sched'), yv = fake.ctl.videos.get(v.youtube.videoId)!;
  assert.equal(v.youtube.stage, 'done', v.youtube.error); assert.equal(v.status, 'scheduled');
  assert.equal(v.scheduledAt, at); assert.equal(v.youtubeUrl, `https://www.youtube.com/shorts/${v.youtube.videoId}`);
  assert.equal(yv.privacy, 'private'); assert.equal(new Date(yv.publishAt).getTime(), new Date(at).getTime());
  assert.equal(yv.madeForKids, false); assert.equal(yv.synthetic, false); assert.equal(yv.category, '28'); assert.equal(yv.notify, 'true');
  assert.match(yv.description, /#Shorts/, 'hashtags go into the description');
  assert.ok(yv.thumbBytes > 0 && !yv.thumbBeforeProcessed, 'thumbnail set, after processing');
  assert.equal(v.youtube.thumbnail, 'set');
  assert.equal(fake.ctl.inserts, 1);
  assert.equal(fs.existsSync(path.join(SUPPORT, 'youtube-sessions', 'v-sched.json')), false, 'session file removed when done');
});

test('a dropped connection and a 503 mid-upload continue the SAME session (no second insert)', async () => {
  const before = fake.ctl.inserts; fake.ctl.chunks = 0; fake.ctl.dropAfterChunk = 2; fake.ctl.fail503Once = false;
  setTimeout(() => { fake.ctl.fail503Once = true; }, 300);
  const r = await upload('v-drop', { mode: 'schedule', at: inFuture(200) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await settled('v-drop');
  const v = await video('v-drop');
  assert.equal(v.youtube.stage, 'done', v.youtube.error);
  assert.equal(fake.ctl.inserts, before + 1);
  const s = [...fake.ctl.sessions.values()].find(x => x.videoId === v.youtube.videoId)!;
  assert.equal(s.got, fs.statSync(path.join(OUT, 'clip.mp4')).size, 'every byte arrived exactly once');
});

test('"now": private first, public only after the thumbnail is set; tracking → Published', async () => {
  const r = await upload('v-now', { mode: 'now', madeForKids: false, synthetic: true, notify: false });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await settled('v-now');
  const v = await video('v-now'), yv = fake.ctl.videos.get(v.youtube.videoId)!;
  assert.equal(v.youtube.stage, 'done', v.youtube.error); assert.equal(v.status, 'published'); assert.ok(v.publishedAt);
  assert.equal(yv.privacy, 'public'); assert.equal(yv.synthetic, true); assert.equal(yv.notify, 'false');
  assert.ok(fake.ctl.updates.includes(`${yv.id}:public:thumb=true`), 'made public after the thumbnail');
});

test('quota used up: a clear message with the reset time, no retry, nothing recorded', async () => {
  fake.ctl.quota = true; const before = fake.ctl.log.filter(l => l.path === '/upload/youtube/v3/videos').length;
  const r = await upload('v-quota', { mode: 'schedule', at: inFuture(90) });
  fake.ctl.quota = false;
  assert.equal(r.status, 429); assert.match(r.j.error, /quota is used up/i); assert.match(r.j.error, /Nothing is retried/);
  await sleep(400);
  assert.equal(fake.ctl.log.filter(l => l.path === '/upload/youtube/v3/videos').length, before + 1, 'exactly one attempt');
  const v = await video('v-quota');
  assert.equal(v.youtube, undefined); assert.equal(v.status, 'rendered');
});

test('thumbnail refused: video stays private + scheduled, the owner continues or skips', async () => {
  fake.ctl.thumbReject = 403;
  const r = await upload('v-thumb', { mode: 'schedule', at: inFuture(300) });
  assert.equal(r.status, 200);
  await settled('v-thumb');
  let v = await video('v-thumb');
  assert.equal(v.youtube.stage, 'failed'); assert.equal(v.youtube.failedAt, 'thumbnail'); assert.equal(v.youtube.thumbnail, 'rejected');
  assert.match(v.youtube.error, /not verified/); assert.equal(v.status, 'scheduled', 'YouTube will still publish it at the scheduled time');
  assert.equal(fake.ctl.videos.get(v.youtube.videoId)!.privacy, 'private');
  fake.ctl.thumbReject = 0;
  assert.equal((await api('POST', '/api/videos/v-thumb/youtube/resume')).status, 200);
  await until(async () => (await video('v-thumb')).youtube.stage === 'done');
  v = await video('v-thumb');
  assert.equal(v.youtube.thumbnail, 'set'); assert.equal(v.status, 'scheduled');
});

// ---------------- the thumbnail YouTube gets (Shorts are cropped to 9:16 around the centre) ----------------
test('a Short gets the tall 9:16 picture, never the wide one; the record says which file was sent', async () => {
  const r = await upload('v-cover', { mode: 'schedule', at: inFuture(300) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await settled('v-cover');
  const v = await video('v-cover'), yv = [...fake.ctl.videos.values()].find(x => x.title === 'Test v-cover')!;
  assert.equal(v.youtube.stage, 'done');
  assert.equal(yv.thumbDims, '1080x1920', 'what YouTube received is 9:16, not the 1280x720 thumbFile');
  assert.equal(v.youtube.thumbSent, 'tall.jpg');
  assert.equal(v.thumbProblem, '');
});

test('a wide picture is never sent: the step stops with a clear message and YouTube receives nothing', async () => {
  const r = await upload('v-wide', { mode: 'schedule', at: inFuture(300) });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await settled('v-wide');
  const v = await video('v-wide'), yv = [...fake.ctl.videos.values()].find(x => x.title === 'Test v-wide')!;
  assert.equal(v.youtube.stage, 'failed'); assert.equal(v.youtube.failedAt, 'thumbnail');
  assert.match(v.youtube.error, /1280×720, not 9:16/);
  assert.equal(yv.thumbBytes, 0, 'no thumbnail request reached YouTube');
});

test('setting the thumbnail again needs the owner\'s approval, then sends only the 9:16 picture and changes nothing else', async () => {
  // the owner redraws the cover after the upload: what YouTube has is no longer the current picture
  assert.equal((await api('PATCH', '/api/videos/v-cover', { coverFile: 'tall2.jpg' })).status, 200);
  let v = await video('v-cover');
  assert.match(v.thumbProblem, /not the current|older/i);
  const yv = [...fake.ctl.videos.values()].find(x => x.title === 'Test v-cover')!;
  const before = { dims: yv.thumbDims, privacy: yv.privacy, publishAt: yv.publishAt, updates: fake.ctl.updates.length };
  const no = await api('POST', '/api/videos/v-cover/youtube/rethumb', {});
  assert.equal(no.status, 409); assert.equal(yv.thumbDims, before.dims, 'nothing was sent without approval');
  const ok = await api('POST', '/api/videos/v-cover/youtube/rethumb', { agree: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(yv.thumbDims, '1080x1920');
  v = await video('v-cover');
  assert.equal(v.youtube.thumbSent, 'tall2.jpg'); assert.equal(v.thumbProblem, '');
  assert.equal(yv.privacy, before.privacy); assert.equal(yv.publishAt, before.publishAt); assert.equal(fake.ctl.updates.length, before.updates, 'no videos.update');
  assert.equal(fake.ctl.deletes, 0);
});

test('the studio is killed mid-upload; after a restart "Continue" resumes the same session', async () => {
  fake.ctl.slowChunkMs = 250; fake.ctl.chunks = 0;
  const inserts = fake.ctl.inserts;
  assert.equal((await upload('v-kill', { mode: 'schedule', at: inFuture(400) })).status, 200);
  await until(async () => fake.ctl.chunks >= 2, 10000);
  await stopServer('SIGKILL');
  fake.ctl.slowChunkMs = 0;
  await startServer();
  let v = await video('v-kill');
  assert.equal(v.youtube.stage, 'failed'); assert.equal(v.youtube.failedAt, 'uploading'); assert.match(v.youtube.error, /Continue/);
  assert.equal(fs.statSync(path.join(SUPPORT, 'youtube-sessions', 'v-kill.json')).mode & 0o777, 0o600);
  assert.equal((await api('POST', '/api/videos/v-kill/youtube/resume')).status, 200);
  await settled('v-kill');
  v = await video('v-kill');
  assert.equal(v.youtube.stage, 'done', v.youtube.error); assert.equal(fake.ctl.inserts, inserts + 1, 'no second insert');
});

test('an expired session after a crash: nothing found on the channel → record cleared, a new approval needed', async () => {
  fake.ctl.slowChunkMs = 250; fake.ctl.chunks = 0;
  assert.equal((await upload('v-expire', { mode: 'schedule', at: inFuture(500) })).status, 200);
  await until(async () => fake.ctl.chunks >= 1, 10000);
  await stopServer('SIGKILL'); fake.ctl.slowChunkMs = 0; fake.ctl.expireSessions = true;
  await startServer();
  assert.equal((await api('POST', '/api/videos/v-expire/youtube/resume')).status, 200);
  await until(async () => { const v = await video('v-expire'); return !v.youtube; });
  fake.ctl.expireSessions = false;
  const v = await video('v-expire');
  assert.equal(v.status, 'rendered'); assert.equal(v.youtubeUrl, '');
  const again = await api('POST', '/api/videos/v-expire/youtube/check', { options: { mode: 'schedule', at: inFuture(500) } });
  assert.deepEqual(again.j.problems, [], 'a fresh, newly approved upload is possible');
});

test('expired access token is refreshed silently; a revoked permission stops with "connect again"', async () => {
  // expire every access token: the next call gets 401, refreshes, succeeds
  const refreshes = fake.ctl.tokenRefreshes;
  await fetch(`${fake.url}/revoke`, { method: 'POST' }).catch(() => {}); fake.ctl.revoked = false; fake.ctl.revokes--;
  const ok = await api('POST', '/api/youtube/sync');
  assert.equal(ok.status, 200); assert.ok(fake.ctl.tokenRefreshes > refreshes);
  // now revoke for real
  await fetch(`${fake.url}/revoke`, { method: 'POST' }); fake.ctl.revokes--;
  const r = await upload('v-revoked', { mode: 'schedule', at: inFuture(90) });
  assert.equal(r.status, 401); assert.match(r.j.error, /Connect again/i);
  const st = (await api('GET', '/api/youtube')).j;
  assert.equal(st.connected, false); assert.match(st.disconnected, /Connect again/);
  assert.equal((await video('v-revoked')).youtube, undefined, 'nothing was sent');
});

test('Scheduled → Published once YouTube says public; never twice, never demoted', async () => {
  // reconnect (the previous test revoked the permission)
  const c = await api('POST', '/api/youtube/connect'), back = (await fetch(c.j.url, { redirect: 'manual' })).headers.get('location')!;
  await fetch(back);
  const v0 = await video('v-sched'); fake.ctl.videos.get(v0.youtube.videoId)!.privacy = 'public';
  assert.equal((await api('POST', '/api/youtube/sync')).j.published, 1);
  let v = await video('v-sched');
  assert.equal(v.status, 'published'); assert.equal(v.youtube.autoPublished, true); assert.ok(v.publishedAt);
  // the owner moves it back by hand: the studio does not set it again
  await api('PATCH', '/api/videos/v-sched', { status: 'scheduled' });
  assert.equal((await api('POST', '/api/youtube/sync')).j.published, 0);
  v = await video('v-sched'); assert.equal(v.status, 'scheduled');
});

test('no secret anywhere: workspace, data, output, logs, API answers; only in Application Support (600)', async () => {
  const secrets = fake.secrets(); assert.ok(secrets.length >= 3);
  const hits: string[] = [];
  const scan = (dir: string, skip: (p: string) => boolean = () => false) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name); if (skip(p)) continue;
      if (e.isDirectory()) scan(p, skip);
      else if (fs.statSync(p).size < 5e6) { const t = fs.readFileSync(p, 'latin1'); for (const s of secrets) if (t.includes(s)) hits.push(`${p}: ${s.slice(0, 12)}…`); }
    }
  };
  scan(DATA); scan(OUT);
  scan(ROOT, p => /node_modules|\/output$|\/\.git$|references$|\/data$|\/tests$/.test(p) /* the stand-in's own fixed fake values live in tests/ */ || /\.(mp4|wav|mp3|png|icns)$/.test(p));
  const logs = path.join(os.homedir(), 'Library', 'Logs', 'Sim Studio.log');
  for (const s of secrets) { if (serverLog.includes(s)) hits.push(`server log: ${s.slice(0, 12)}…`); if (fs.existsSync(logs) && fs.readFileSync(logs, 'utf8').includes(s)) hits.push('Sim Studio.log'); }
  for (const r of responses) for (const s of secrets) if (r.includes(s)) hits.push(`API answer: ${s.slice(0, 12)}…`);
  assert.deepEqual(hits, []);
  const file = fs.readFileSync(path.join(SUPPORT, 'youtube.json'), 'utf8');
  assert.ok(file.includes('1//fake-refresh-'), 'the refresh token is kept only here');
  assert.equal(fs.statSync(path.join(SUPPORT, 'youtube.json')).mode & 0o777, 0o600);
  assert.equal(fake.ctl.deletes, 0, 'no DELETE request ever reached YouTube');
});

test('disconnect revokes at Google and forgets the token; uploaded videos keep their records', async () => {
  const revokes = fake.ctl.revokes;
  const r = await api('POST', '/api/youtube/disconnect');
  assert.equal(r.j.connected, false); assert.equal(fake.ctl.revokes, revokes + 1);
  assert.ok(!fs.readFileSync(path.join(SUPPORT, 'youtube.json'), 'utf8').includes('1//fake-refresh-'));
  const v = await video('v-now'); assert.equal(v.status, 'published'); assert.ok(v.youtubeUrl);
});

test('quota reset time: midnight Pacific Time, shown in the Mac\'s own time zone (moves with US daylight saving)', async () => {
  const { quotaResetLocal, ptDay } = await import('../apps/server/youtube.ts');
  const winter = quotaResetLocal(new Date('2026-11-18T05:00:00Z')), summer = quotaResetLocal(new Date('2026-07-01T05:00:00Z'));
  assert.ok(winter && summer, 'never empty');
  // PST = UTC-8 (midnight PT = 08:00 UTC), PDT = UTC-7 (07:00 UTC): the local times differ (by one hour, where the Mac has no DST of its own)
  const local = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  assert.equal(winter, local('2026-11-18T08:00:00Z')); assert.equal(summer, local('2026-07-01T07:00:00Z'));
  assert.equal(ptDay(new Date('2026-11-18T07:59:00Z')), '2026-11-17'); assert.equal(ptDay(new Date('2026-11-18T08:00:00Z')), '2026-11-18');
});
