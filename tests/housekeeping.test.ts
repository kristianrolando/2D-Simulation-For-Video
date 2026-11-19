// Housekeeping: the machine health check, the hourly sweep, the time-stamped and size-limited log, keeping the Mac awake, and the
// state tool. Probes, spawns and clocks are handed in; one real studio checks the pieces together (throw-away folders, other port).
import { usablePort } from './ports.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { checkHealth } from '../apps/server/health.ts';
import { sweepList, sweep } from '../apps/server/sweep.ts';
import { logLine, rotateLog } from '../apps/server/log.ts';
import { createAwake } from '../apps/server/awake.ts';
import { buildStatus } from '../apps/server/status.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-house-'));
const procs: ChildProcess[] = [];
after(() => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } fs.rmSync(T, { recursive: true, force: true }); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('health: a missing ffmpeg, a nearly full disk and a folder that cannot be written are each named in plain words', () => {
  const ok = { has: () => true, freeGB: () => 100, writable: () => true };
  assert.deepEqual(checkHealth({ outDir: '/o', dataDir: '/d', probes: ok }), { problems: [], freeGB: 100 });
  const bad = checkHealth({ outDir: '/o', dataDir: '/d', minFreeGB: 2, probes: { has: c => c !== 'ffprobe', freeGB: () => 0.7, writable: d => d !== '/d' } });
  assert.equal(bad.problems.length, 3);
  assert.match(bad.problems[0], /ffprobe was not found/); assert.match(bad.problems[1], /Only 0\.7 GB/); assert.match(bad.problems[2], /data folder is not writable/);
  assert.equal(checkHealth({ outDir: '/o', dataDir: '/d', probes: { ...ok, freeGB: () => null } }).problems.length, 0, 'unknown free space is not a problem');
  assert.deepEqual(buildStatus([], { nowMs: 1, readOnly: false, pid: 2, uptimeSec: 3, problems: [] }).problems, undefined, 'no problems: the field is absent');
  assert.deepEqual(buildStatus([], { nowMs: 1, readOnly: false, pid: 2, uptimeSec: 3, problems: ['x'] }).problems, ['x']);
});

test('sweep: only old temporary files nobody owns; running jobs, finished renders and fresh files are never touched', () => {
  const out = path.join(T, 'sw-out'), data = path.join(T, 'sw-data'); for (const d of [out, path.join(data, 'thumbnails'), path.join(data, 'backups')]) fs.mkdirSync(d, { recursive: true });
  const now = Date.now(), put = (f: string, ageMin: number) => { fs.writeFileSync(f, 'x'); const t = (now - ageMin * 60e3) / 1000; fs.utimesSync(f, t, t); return f; };
  const stray = [put(path.join(out, 'old.request.json'), 30), put(path.join(out, 'old.wav'), 120), put(path.join(out, 'half.mp4.tmp'), 120), put(path.join(data, 'videos.json.9.1.tmp'), 120), put(path.join(data, 'thumbnails', 'a.tmp.png'), 120), put(path.join(data, 'backups', 'b.tmp'), 120)];
  const keep = [put(path.join(out, 'run.request.json'), 300), put(path.join(out, 'run.wav'), 300), put(path.join(out, 'done.mp4'), 900), put(path.join(out, 'done.job.json'), 900), put(path.join(out, 'new.wav'), 5), put(path.join(out, 'new.request.json'), 2),
    put(path.join(data, 'videos.json'), 900), put(path.join(data, 'thumbnails', 'cover.png'), 900), put(path.join(data, 'jobs.json'), 900)];
  const opts = { outDir: out, dataDir: data, activeBases: new Set(['run']), nowMs: now };
  assert.deepEqual(sweepList(opts).sort(), stray.sort());
  assert.equal(sweep(opts).length, stray.length);
  for (const f of stray) assert.ok(!fs.existsSync(f), f);
  for (const f of keep) assert.ok(fs.existsSync(f), 'kept ' + f);
  assert.deepEqual(sweepList(opts), [], 'nothing left to sweep');
  assert.deepEqual(sweepList({ ...opts, outDir: path.join(T, 'nope'), dataDir: path.join(T, 'nope2') }), [], 'missing folders are fine');
});

test('log: every line has a time stamp and no secret; the file is rotated only when it really is our stdout and over the limit', () => {
  const line = logLine(['youtube:', 'token', 'abc123SECRET', { a: 1 }], s => s.replace('abc123SECRET', '[hidden]'), new Date('2026-11-19T01:02:03.000Z'));
  assert.equal(line, '2026-11-19T01:02:03.000Z youtube: token [hidden] { a: 1 }\n');
  const file = path.join(T, 'x.log'); const fd = fs.openSync(file, 'a'); fs.writeSync(fd, 'a'.repeat(100));
  assert.equal(rotateLog(file, fd, 1000), false, 'under the limit');
  fs.writeSync(fd, 'b'.repeat(1000));
  const other = fs.openSync(path.join(T, 'other.log'), 'a');
  assert.equal(rotateLog(file, other, 1000), false, 'a descriptor of another file is never truncated');
  assert.equal(fs.statSync(file).size, 1100);
  assert.equal(rotateLog(file, fd, 1000), true);
  assert.equal(fs.statSync(file).size, 0); assert.equal(fs.statSync(file + '.1').size, 1100, 'the old part is kept once');
  fs.writeSync(fd, 'new'); assert.equal(fs.readFileSync(file, 'utf8'), 'new', 'appending continues at the start of the fresh file');
  fs.closeSync(fd); fs.closeSync(other);
});

test('awake: caffeinate starts once when there is work, stops when there is none, and never runs off macOS', () => {
  const calls: string[][] = []; let killed = 0;
  const fake: any = (cmd: string, a: string[]) => { calls.push([cmd, ...a]); const h: Record<string, () => void> = {}; return { on: (e: string, f: () => void) => { h[e] = f; }, kill: () => { killed++; h.exit?.(); } }; };
  const a = createAwake({ spawn: fake, pid: 4321, platform: 'darwin' });
  a.set(false); assert.equal(calls.length, 0);
  a.set(true); a.set(true); assert.deepEqual(calls, [['caffeinate', '-i', '-w', '4321']], 'one caffeinate tied to the server pid'); assert.ok(a.active());
  a.set(false); assert.equal(killed, 1); assert.ok(!a.active());
  a.set(true); assert.equal(calls.length, 2, 'starts again for the next batch of work');
  const lin = createAwake({ spawn: fake, platform: 'linux' }); lin.set(true); assert.equal(calls.length, 2); assert.ok(!lin.active());
  const boom: any = () => { throw new Error('no caffeinate'); }; assert.doesNotThrow(() => createAwake({ spawn: boom, platform: 'darwin' }).set(true));
});

test('state tool: read-only summary, JSON mode, "not running" when no studio answers', () => {
  const r = spawnSync(process.execPath, ['tools/state.ts', '--json', '--url', 'http://127.0.0.1:1'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.equal(s.studio.running, false); assert.equal(typeof s.git.branch, 'string'); assert.ok('jobs' in s && 'freeGB' in s && 'handoff' in s);
  assert.match(spawnSync(process.execPath, ['tools/state.ts', '--url', 'http://127.0.0.1:1'], { cwd: ROOT, encoding: 'utf8' }).stdout, /studio {3}not running/);
});

test('a real studio: time-stamped log lines, health problems shown in /api/status, a render refused (clearly) on a full disk, the Mac kept awake only with work', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'srv-')), data = path.join(dir, 'data'), out = path.join(dir, 'out'); fs.mkdirSync(data); fs.mkdirSync(out);
  const port = usablePort(6600 + Math.floor(Math.random() * 300)); // fetch refuses some ports (tests/ports.ts)
  fs.writeFileSync(path.join(out, 'ghost.request.json'), '{}'); fs.writeFileSync(path.join(out, 'ghost.wav'), 'x'); const old = (Date.now() - 3 * 3600e3) / 1000; fs.utimesSync(path.join(out, 'ghost.wav'), old, old);
  let log = ''; const proc = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(dir, 'home'), PORT: String(port), SIM_DATA_DIR: data, SIM_OUT_DIR: out, SIM_MIN_FREE_GB: '99999999' }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc); proc.stdout!.on('data', d => { log += d; }); proc.stderr!.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/status')).ok) break; } catch { /* starting */ } await sleep(150); }
  const st: any = await (await fetch(base + '/api/status')).json();
  assert.ok(Array.isArray(st.problems) && /GB are free/.test(st.problems[0]), JSON.stringify(st));
  const r = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: 'harmonograph', params: { duration: 3 } }) });
  assert.equal(r.status, 507); assert.match(((await r.json()) as any).error, /render was not started/);
  assert.deepEqual(await (await fetch(base + '/api/jobs')).json(), [], 'nothing was queued');
  assert.ok(log.split('\n').filter(Boolean).every(l => /^\d{4}-\d\d-\d\dT[\d:.]+Z /.test(l)), 'every log line starts with a time stamp:\n' + log);
  assert.match(log, /health: \d problem\(s\)/); assert.match(log, /removed 1 leftover request file/, 'start-up recovery removed the stray request'); assert.match(log, /sweep: removed 1 leftover temporary file/, log);
  assert.ok(!fs.existsSync(path.join(out, 'ghost.wav')), 'the old leftover audio was swept at start');
});
