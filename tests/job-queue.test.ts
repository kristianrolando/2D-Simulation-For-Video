// The render queue survives a restart: jobs are kept in data/jobs.json, a job that was running becomes "Stopped", worker processes
// (one process group each) never outlive the studio, leftovers are swept, and "Render again" reproduces the same video.
// Real studio servers run in throw-away folders; nothing here touches the real data/ or output/.
import { usablePort } from './ports.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { openJobStore, parseJobs, sanitizeJob, isOurWorker, killGroup, processAlive, isComplete, strayRequests, removeFiles, tempFilesOf, partialFilesOf, KEEP_JOBS, pruneJobs, type JobRecord } from '../apps/server/job-store.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER = path.join(ROOT, 'apps/server/worker.ts');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-jobs-'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rec = (id: string, o: Partial<JobRecord> = {}): JobRecord => ({ id, sceneId: 'harmonograph', params: { duration: 5 }, style: 'classic', status: 'done', created: Date.parse('2026-11-18T10:00:00Z'), out: id + '.mp4', progress: { frame: 1, frames: 1, fps: 0, phase: 'done' }, ...o });
after(() => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* gone */ } } fs.rmSync(T, { recursive: true, force: true }); });
const procs: ChildProcess[] = [];

// ---------------- the file ----------------
test('job list file: clean records only, newest kept, atomic with backups, damage never stops the studio', () => {
  const dir = fs.mkdtempSync(path.join(T, 'store-')), s = openJobStore(dir);
  assert.deepEqual(s.load(), [], 'no file yet: empty');
  assert.equal(sanitizeJob({ id: '../x', out: 'a.mp4', sceneId: 's', status: 'done' }), null, 'bad id');
  assert.equal(sanitizeJob({ id: 'abc', out: 'a.txt', sceneId: 's', status: 'done' }), null, 'not an mp4');
  assert.equal(sanitizeJob({ id: 'abc', out: 'a.mp4', sceneId: 's', status: 'weird' }), null, 'unknown status');
  assert.equal(sanitizeJob({ id: 'abc', out: '/etc/x/a.mp4', sceneId: 's', status: 'done' })!.out, 'a.mp4', 'only a file name is kept');
  const many = Array.from({ length: KEEP_JOBS + 8 }, (_, i) => rec(`job-${String(i).padStart(3, '0')}`, { created: 1e12 + i }));
  s.save(many);
  const back = s.load(); assert.equal(back.length, KEEP_JOBS); assert.equal(back[back.length - 1].id, `job-${String(KEEP_JOBS + 7).padStart(3, '0')}`, 'the newest are kept');
  s.save([rec('abc-1', { status: 'running', pid: 4321 })]); s.save([rec('abc-2')]);
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('jobs-')).length, 2, 'a backup before each overwrite');
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0, 'no temp file left');
  assert.ok(!fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8').match(/token|secret|password/i));
  // damaged: set aside, the newest good backup is used
  fs.writeFileSync(path.join(dir, 'jobs.json'), '{ not json');
  const s2 = openJobStore(dir), got = s2.load();
  assert.equal(got.length, 1); assert.equal(got[0].id, 'abc-1', 'newest good backup restored');
  assert.match(s2.notice(), /damaged/); assert.ok(fs.readdirSync(dir).some(f => f.startsWith('jobs.json.damaged-')), 'the damaged file is kept');
  // damaged and no backup: starts empty, still does not throw
  const lone = fs.mkdtempSync(path.join(T, 'lone-')); fs.writeFileSync(path.join(lone, 'jobs.json'), '[]');
  assert.deepEqual(openJobStore(lone).load(), []);
  // a newer schema is not overwritten blindly
  assert.equal(parseJobs(JSON.stringify({ schemaVersion: 99, jobs: [] })).ok, false);
});

test('a long queue is never cut: every queued or running job stays on disk, only finished ones are trimmed', () => {
  const dir = fs.mkdtempSync(path.join(T, 'long-')), s = openJobStore(dir);
  const queued = Array.from({ length: KEEP_JOBS + 20 }, (_, i) => rec(`q-${String(i).padStart(3, '0')}`, { status: i === 0 ? 'running' : 'queued', created: 1e12 + i }));
  const done = Array.from({ length: KEEP_JOBS + 10 }, (_, i) => rec(`d-${String(i).padStart(3, '0')}`, { created: 1e12 + 1000 + i }));
  s.save([...done, ...queued]);
  const back = s.load();
  assert.equal(back.filter(j => j.status === 'queued' || j.status === 'running').length, KEEP_JOBS + 20, 'the oldest queued job (the next to run) is still there');
  assert.ok(back.some(j => j.id === 'q-000' && j.status === 'running'));
  assert.equal(back.filter(j => j.status === 'done').length, KEEP_JOBS, 'finished jobs are still trimmed');
  assert.equal(back.filter(j => j.status === 'done')[0].id, 'd-010', 'the newest finished ones are the ones kept');
  assert.deepEqual(pruneJobs([]), []);
});

test('a read-only studio never writes the job list', () => {
  const dir = fs.mkdtempSync(path.join(T, 'ro-')); const s = openJobStore(dir, { canWrite: () => false });
  s.save([rec('abc-1')]); assert.equal(fs.existsSync(path.join(dir, 'jobs.json')), false);
});

test('finished or not: an MP4 counts only when it is as long as its frame count says', () => {
  assert.equal(isComplete(30, 1800), true); assert.equal(isComplete(29.9, 1800), true);
  assert.equal(isComplete(12, 1800), false, 'a short, finalised MP4 is not a finished render');
  assert.equal(isComplete(30, 0), false, 'unknown length: not proven');
  assert.equal(isComplete(0, 1800), false);
});

// ---------------- processes ----------------
test('only our own worker is ever stopped; killGroup stops a worker and its children together', async () => {
  const cmd = (map: Record<number, string>) => (pid: number) => map[pid] ?? '';
  assert.equal(isOurWorker(111, WORKER, 'job-1', cmd({ 111: `node ${WORKER} /x/out/job-1.request.json` })), true);
  assert.equal(isOurWorker(111, WORKER, 'job-1', cmd({ 111: 'node /somewhere/else.js job-1' })), false, 'another program that reused the pid');
  assert.equal(isOurWorker(111, WORKER, 'job-2', cmd({ 111: `node ${WORKER} /x/out/job-1.request.json` })), false, 'another job');
  assert.equal(isOurWorker(111, WORKER, 'job-1', cmd({})), false, 'gone');
  assert.equal(isOurWorker(process.pid, WORKER, 'x', () => `${WORKER} x`), false, 'never ourselves');
  assert.equal(isOurWorker(1, WORKER, 'x', () => `${WORKER} x`), false);
  // a real process group: a leader and a child it started
  const leader = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  procs.push(leader); leader.unref();
  const childPid = await new Promise<number>(ok => leader.stdout!.once('data', d => ok(Number(String(d).trim()))));
  assert.ok(processAlive(leader.pid!) && processAlive(childPid));
  killGroup(leader.pid!);
  for (let i = 0; i < 30 && (processAlive(leader.pid!) || processAlive(childPid)); i++) await sleep(100);
  assert.equal(processAlive(childPid), false, 'the child died with the group');
});

test('leftover files: only requests nobody owns, temp files and half-written output are removed', () => {
  const out = fs.mkdtempSync(path.join(T, 'out-'));
  for (const f of ['a.request.json', 'b.request.json', 'keep.mp4', 'keep.job.json', 'x-1.mp4', 'x-1.job.json', 'x-1.wav', 'x-1.request.json']) fs.writeFileSync(path.join(out, f), 'x');
  assert.deepEqual(strayRequests(out, new Set(['b.request.json'])).map(f => path.basename(f)).sort(), ['a.request.json', 'x-1.request.json']);
  assert.equal(removeFiles([...tempFilesOf(out, 'x-1.mp4'), ...partialFilesOf(out, 'x-1.mp4')]), 4);
  assert.deepEqual(fs.readdirSync(out).sort(), ['a.request.json', 'b.request.json', 'keep.job.json', 'keep.mp4'], 'finished renders are never touched');
  assert.doesNotThrow(() => removeFiles([path.join(out, 'missing.mp4')]), 'removing a missing file is harmless');
});

// ---------------- real studio servers, restarted ----------------
let nextPort = 6100 + Math.floor(Math.random() * 400) * 4;
interface Studio { proc: ChildProcess; port: number; base: string; log: () => string; stop: (sig?: NodeJS.Signals) => Promise<void> }
const freePort = () => (nextPort = usablePort(nextPort + 4));
async function startStudio(dir: string): Promise<Studio> {
  const port = freePort(), data = path.join(dir, 'data'), out = path.join(dir, 'out'); fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  let log = ''; const proc = spawn(process.execPath, ['apps/server/server.ts'], { cwd: ROOT, env: { ...process.env, HOME: path.join(dir, 'home'), PORT: String(port), SIM_DATA_DIR: data, SIM_OUT_DIR: out }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc); proc.stdout!.on('data', d => { log += d; }); proc.stderr!.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/api/jobs`)).ok) break; } catch { /* starting */ } await sleep(150); if (i === 299) throw new Error('studio did not start:\n' + log); } // up to 45 s: the other tests keep every CPU core busy while this one starts
  return { proc, port, base, log: () => log, stop: async (sig = 'SIGTERM') => { if (proc.exitCode !== null || proc.signalCode) return; const done = new Promise(r => proc.once('exit', r)); proc.kill(sig); await done; } };
}
const jobsOf = async (s: Studio) => (await (await fetch(`${s.base}/api/jobs`)).json()) as any[];
async function until<T>(fn: () => Promise<T | false | undefined>, ms = 60000, every = 150): Promise<T> { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); } throw new Error('timed out'); }
const post = (s: Studio, p: string, body?: unknown) => fetch(s.base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const readJobs = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'jobs.json'), 'utf8')).jobs as JobRecord[];
const startRender = async (s: Studio, duration: number) => { const r = await post(s, '/api/jobs', { sceneId: 'harmonograph', params: { duration } }); assert.equal(r.status, 200); return (await r.json()) as any; };
const runningWithFrames = (s: Studio, id: string) => until(async () => { const j = (await jobsOf(s)).find(x => x.id === id); return j?.status === 'running' && j.progress.frame > 0 ? j : false; });
const leftovers = (dir: string, id: string) => fs.readdirSync(path.join(dir, 'out')).filter(f => f.startsWith(id));
const draftsOf = (dir: string, id: string) => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'videos.json'), 'utf8')).videos.filter((v: any) => v.jobId === id);
const streamHash = (mp4: string) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:v', '-f', 'hash', '-hash', 'sha256', '-', '-map', '0:a', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

test('restart while rendering: the job is Stopped (not lost), no worker survives, no file is left, and Render again gives the same video', { timeout: 240000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'restart-'));
  let s = await startStudio(dir);
  const job = await startRender(s, 15);
  await runningWithFrames(s, job.id);
  const pid = readJobs(dir).find(j => j.id === job.id)!.pid!; assert.ok(pid > 1 && processAlive(pid), 'the worker pid is on disk and alive');
  assert.ok(fs.existsSync(path.join(dir, 'out', job.id + '.request.json')));
  await s.stop('SIGTERM');                                                    // like `node --watch` or Ctrl+C
  assert.equal(processAlive(pid), false, 'the worker did not outlive the studio');
  const stoppedOnDisk = readJobs(dir).find(j => j.id === job.id)!; assert.equal(stoppedOnDisk.status, 'stopped');
  assert.deepEqual(leftovers(dir, job.id), [], 'no request, wav, half-written mp4 or record left');
  assert.deepEqual(draftsOf(dir, job.id), [], 'the empty video entry of the interrupted render is gone');
  // restart
  s = await startStudio(dir);
  const back = (await jobsOf(s)).find(j => j.id === job.id); assert.equal(back.status, 'stopped'); assert.match(back.note, /Render again/); assert.equal(back.pid, undefined, 'the pid is not published');
  const r = await post(s, `/api/jobs/${job.id}/again`); assert.equal(r.status, 200); const again = await r.json() as any;
  assert.notEqual(again.id, job.id); assert.deepEqual(again.params, back.params);
  assert.equal((await post(s, `/api/jobs/${job.id}/again`)).status, 409, 'not twice while the new one runs');
  assert.equal((await post(s, `/api/jobs/${again.id}/again`)).status, 409, 'a running or finished job cannot be run again');
  await until(async () => (await jobsOf(s)).find(j => j.id === again.id)?.status === 'done', 120000);
  assert.equal((await jobsOf(s)).find(j => j.id === job.id).retriedBy, again.id);
  // the control: the same settings rendered directly give the same video
  const control = await startRender(s, 15);
  await until(async () => (await jobsOf(s)).find(j => j.id === control.id)?.status === 'done', 120000);
  assert.equal(streamHash(path.join(dir, 'out', again.id + '.mp4')), streamHash(path.join(dir, 'out', control.id + '.mp4')), 'same settings, same video (video and audio streams)');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')).filter(f => /\.(request\.json|wav)$/.test(f)), [], 'finished renders leave no temp files');
  await s.stop();
});

test('a crash (kill -9): the worker stops by itself, and the next start marks the job Stopped and sweeps the leftovers', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'crash-'));
  let s = await startStudio(dir);
  const job = await startRender(s, 20); await runningWithFrames(s, job.id);
  const pid = readJobs(dir).find(j => j.id === job.id)!.pid!;
  await s.stop('SIGKILL');
  assert.equal(readJobs(dir).find(j => j.id === job.id)!.status, 'running', 'a crash leaves the record as it was');
  await until(async () => !processAlive(pid), 12000, 200);                    // the orphan notices its parent is gone
  s = await startStudio(dir);
  const back = (await jobsOf(s)).find(j => j.id === job.id); assert.equal(back.status, 'stopped');
  assert.deepEqual(leftovers(dir, job.id), [], 'leftovers swept');
  assert.deepEqual(draftsOf(dir, job.id), []);
  assert.match(s.log(), /./); await s.stop();
});

test('an orphan worker that is still running is found and stopped at start; a stranger with that pid is not touched', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'orphan-')); fs.mkdirSync(path.join(dir, 'data'), { recursive: true }); fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const id = 'harmonograph-render-classic-2026-11-18T10-00-00', req = path.join(dir, 'out', id + '.request.json');
  fs.writeFileSync(req, JSON.stringify({ sceneId: 'harmonograph', params: { duration: 90 }, out: path.join(dir, 'out', id + '.mp4') }));
  const worker = spawn(process.execPath, [WORKER, req], { cwd: ROOT, detached: true, stdio: 'ignore' }); procs.push(worker); worker.unref(); // our parent (this test) stays alive: it really is an orphan of the "old studio"
  const stranger = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' }); procs.push(stranger); stranger.unref();
  await sleep(1500); assert.ok(processAlive(worker.pid!) && processAlive(stranger.pid!));
  fs.writeFileSync(path.join(dir, 'data', 'jobs.json'), JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), jobs: [
    rec(id, { status: 'running', pid: worker.pid, params: { duration: 90 }, progress: { frame: 120, frames: 5400, fps: 90, phase: 'video' } }),
    rec('harmonograph-render-classic-2026-11-18T10-05-00', { status: 'queued', pid: stranger.pid, created: Date.parse('2026-11-18T10:05:00Z') }),
  ] }));
  const s = await startStudio(dir);
  await until(async () => !processAlive(worker.pid!), 8000, 200);
  assert.equal(processAlive(stranger.pid!), true, 'a process that is not our worker is left alone');
  const jobs = await jobsOf(s); assert.deepEqual(jobs.map(j => j.status).sort(), ['stopped', 'stopped']);
  assert.equal(fs.existsSync(req), false, 'the request file is swept');
  await s.stop(); try { process.kill(stranger.pid!, 'SIGKILL'); } catch { /* gone */ }
});

test('a damaged or missing job list never stops the studio from starting', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'bad-')); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'jobs.json'), '\u0000\u0000 {{{ not json');
  const s = await startStudio(dir);
  assert.deepEqual(await jobsOf(s), [], 'starts with an empty list');
  assert.ok(fs.readdirSync(path.join(dir, 'data')).some(f => f.startsWith('jobs.json.damaged-')), 'the damaged file is kept aside');
  assert.match(s.log(), /render list: .*damaged/);
  await s.stop();
});

test('a second, read-only studio leaves the first studio\'s running job alone', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(T, 'two-'));
  const a = await startStudio(dir); const job = await startRender(a, 25); await runningWithFrames(a, job.id);
  const pid = readJobs(dir).find(j => j.id === job.id)!.pid!;
  const b = await startStudio(dir);                                            // same data folder: read-only
  assert.equal(processAlive(pid), true, 'the first studio\'s worker is untouched');
  assert.equal((await jobsOf(b)).some(j => j.id === job.id && j.status === 'stopped'), false, 'its job is not shown as stopped');
  assert.equal(readJobs(dir).find(j => j.id === job.id)!.status, 'running', 'and the file was not rewritten');
  await b.stop(); await a.stop();
});
