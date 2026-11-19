// Channels added by hand and the bulk actions of the Videos list, against a real studio server on its own HOME, data and output (no Google at all:
// there is no connection, so nothing could be sent). A channel added by hand is a name: videos can be marked for it, the studio never uploads to it.
import { usablePort } from './ports.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { sanitizeVideo, sanitizeManualChannels, manualNameProblem } from '../packages/publish/index.ts';
import { parseStore } from '../apps/server/store.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-vch-'));
const HOME = path.join(T, 'home'), DATA = path.join(T, 'data'), OUT = path.join(T, 'out');
const PORT = usablePort(6400 + Math.floor(Math.random() * 200)), BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null, log = '';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const IDS = ['a1', 'a2', 'a3', 'a-sched', 'a-pub', 'a-draft', 'a-yt', 'a-long'];
function seed() {
  for (const d of [HOME, DATA, OUT]) fs.mkdirSync(d, { recursive: true });
  const now = new Date().toISOString(), base = { description: 'd', tags: ['t'], sceneId: 'galton-board', style: 'classic', file: 'x.mp4', durationSec: 30, createdAt: now, updatedAt: now };
  const over: Record<string, Record<string, unknown>> = { 'a-sched': { status: 'scheduled', scheduledAt: '2030-01-01T10:00' }, 'a-pub': { status: 'published', publishedAt: '2026-11-01' }, 'a-draft': { status: 'draft' }, 'a-yt': { youtube: { videoId: 'abcdefghijk', stage: 'done', mode: 'schedule' } }, 'a-long': { kind: 'long', compilationId: 'c1' } };
  const videos = IDS.map(id => sanitizeVideo({ id, title: `T ${id}`, status: 'rendered', ...base, ...over[id] }, now));
  fs.writeFileSync(path.join(DATA, 'videos.json'), JSON.stringify({ schemaVersion: 1, savedAt: now, videos, settings: { suggestLang: 'en' } }, null, 2));
}
async function start() {
  log = ''; server = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME, PORT: String(PORT), SIM_DATA_DIR: DATA, SIM_OUT_DIR: OUT, SIM_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout!.on('data', d => { log += d; }); server.stderr!.on('data', d => { log += d; });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${BASE}/api/status`)).ok) return; } catch { /* starting */ } await sleep(150); }
  throw new Error('studio did not start:\n' + log);
}
async function stop() { if (!server) return; const s = server; server = null; const done = new Promise(r => s.on('exit', r)); s.kill('SIGTERM'); await done; }
async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(BASE + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j: any = {}; try { j = JSON.parse(text); } catch { j = { text }; } return { status: r.status, j };
}
const list = async () => (await api('GET', '/api/videos')).j;
const video = async (id: string) => (await list()).videos.find((v: any) => v.id === id);
before(async () => { seed(); await start(); });
after(async () => { await stop(); fs.rmSync(T, { recursive: true, force: true }); });

test('names: what may be added, and a damaged list is cleaned, never an error', () => {
  assert.equal(manualNameProblem('Fourier Loom'), ''); assert.equal(manualNameProblem("Lab & Co. (2)"), '');
  for (const bad of ['', 'a', 'x'.repeat(61), '<b>', 'a\nb', '\u0001none', ' - lead']) assert.notEqual(manualNameProblem(bad), '', JSON.stringify(bad));
  assert.deepEqual(sanitizeManualChannels(['Fourier Loom', 'Fourier Loom', 5, '<x>', ' Tidy  ', null]), ['Fourier Loom', 'Tidy']);
  assert.deepEqual(sanitizeManualChannels('nope'), []); assert.equal(sanitizeManualChannels(Array.from({ length: 30 }, (_, i) => `Channel ${i}`)).length, 12);
  const r = parseStore(JSON.stringify({ schemaVersion: 1, savedAt: 'x', videos: [], settings: { suggestLang: 'en', manualChannels: ['Ok One', '<bad>'] } })); assert.ok(r.ok && r.store.settings?.manualChannels?.join() === 'Ok One');
});

test('add a channel by hand: validated, stored in the list file, survives a restart, no connection involved', async () => {
  assert.equal((await api('POST', '/api/channels/manual', { name: '<b>' })).status, 400);
  assert.equal((await api('POST', '/api/channels/manual', { name: 'photon lab' })).status, 409, 'the studio\'s own channel name is taken');
  const ok = await api('POST', '/api/channels/manual', { name: 'Fourier Loom' });
  assert.equal(ok.status, 200); assert.deepEqual(ok.j.manualChannels, ['Fourier Loom']);
  assert.equal((await api('POST', '/api/channels/manual', { name: 'fourier loom' })).status, 409, 'twice');
  assert.deepEqual((await list()).settings.manualChannels, ['Fourier Loom']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'videos.json'), 'utf8')).settings.manualChannels, ['Fourier Loom']);
  await stop(); await start(); assert.deepEqual((await list()).settings.manualChannels, ['Fourier Loom']);
  assert.equal((await api('GET', '/api/youtube')).j.connections.length, 0, 'nothing was connected');
});

test('videos can be marked for it (one or many); the name is the tag, there is no channel id; a scheduled or published video keeps its channel', async () => {
  assert.equal((await api('PUT', '/api/videos/a1/channel', { channelName: 'Nobody' })).status, 400, 'a name that was not added');
  const one = await api('PUT', '/api/videos/a1/channel', { channelName: 'Fourier Loom' });
  assert.equal(one.status, 200); let v = await video('a1'); assert.equal(v.channel, 'Fourier Loom'); assert.equal(v.channelId, undefined);
  const many = await api('PUT', '/api/videos/channel', { ids: ['a2', 'a3', 'a-sched', 'a-pub', 'nope'], channelName: 'Fourier Loom' });
  assert.equal(many.status, 200); assert.equal(many.j.changed, 2); assert.equal(many.j.skipped.length, 3);
  assert.equal((await video('a-sched')).channel, 'Photon Lab'); assert.equal((await video('a-pub')).channel, 'Photon Lab');
});

test('the studio never uploads to a channel added by hand: the check says why, and no session is started', async () => {
  const c = await api('POST', '/api/videos/a1/youtube/check', { options: { mode: 'schedule', at: '2030-01-01T10:00' } });
  assert.ok(c.j.problems.some((p: string) => /added by hand/.test(p)), JSON.stringify(c.j.problems)); assert.equal(c.j.consent, '');
  const up = await api('POST', '/api/videos/a1/youtube/upload', { options: { mode: 'schedule', at: '2030-01-01T10:00' }, consent: 'x', agree: true });
  assert.ok(up.status >= 400); assert.equal((await video('a1')).youtube, undefined);
});

test('a channel can be removed from the list only when no video carries it', async () => {
  const no = await api('POST', '/api/channels/manual/remove', { name: 'Fourier Loom' }); assert.equal(no.status, 409); assert.match(no.j.error, /3 videos/);
  await api('POST', '/api/channels/manual', { name: 'Spare Channel' });
  const ok = await api('POST', '/api/channels/manual/remove', { name: 'Spare Channel' }); assert.equal(ok.status, 200); assert.deepEqual(ok.j.manualChannels, ['Fourier Loom']);
});

test('bulk "uploaded by hand": only Rendered videos without an upload record change; Scheduled, Published and uploaded ones are reported and left alone; undo takes the marks back', async () => {
  const before = await list();
  const r = await api('POST', '/api/videos/manual-bulk', { ids: ['a1', 'a2', 'a-sched', 'a-pub', 'a-draft', 'a-yt', 'a-long', 'ghost'], date: '2026-11-20' });
  assert.equal(r.status, 200); assert.equal(r.j.changed, 3, 'a1, a2 and the long video'); assert.equal(r.j.skipped.length, 5);
  const why = Object.fromEntries(r.j.skipped.map((s: any) => [s.id, s.reason]));
  assert.match(why['a-sched'], /scheduled/); assert.match(why['a-pub'], /published/); assert.match(why['a-yt'], /upload record/); assert.match(why['a-draft'], /Rendered/); assert.equal(why.ghost, 'not in the list');
  for (const id of ['a1', 'a2', 'a-long']) { const v = await video(id); assert.equal(v.status, 'published'); assert.equal(v.publishedAt, '2026-11-20'); assert.ok(v.uploadedManually); }
  for (const id of ['a-sched', 'a-pub', 'a-draft', 'a-yt']) assert.deepEqual(await video(id), before.videos.find((v: any) => v.id === id), `${id} is untouched`);
  assert.equal((await video('a3')).status, 'rendered', 'a video that was not chosen is untouched');
  const un = await api('POST', '/api/videos/manual-bulk/undo', { ids: ['a1', 'a2', 'a-long', 'a-pub', 'a3'] });
  assert.equal(un.j.changed, 3); assert.equal(un.j.skipped.length, 2);
  for (const id of ['a1', 'a2', 'a-long']) { const v = await video(id); assert.equal(v.status, 'rendered'); assert.equal(v.uploadedManually, undefined); assert.equal(v.publishedAt, ''); }
  assert.equal((await video('a-pub')).status, 'published', 'a published video is not a mark of this kind');
  assert.equal(fs.existsSync(path.join(HOME, 'Library', 'Application Support', 'Sim Studio', 'youtube.json')), false, 'no credential file was ever made');
});
