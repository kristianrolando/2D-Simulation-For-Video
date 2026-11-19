// Batch runner: a video the owner already re-rendered is never sent twice, a stopped one is run again through the studio's own link,
// and two runners never work on the same plan. A fake studio on a random port stands in (no render, no real data folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { headOf, reconcile, lockHolder, type JobLite, type BatchEntry } from '../tools/batch-chain.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const j = (id: string, status: string, retriedBy?: string): JobLite => ({ id, status, ...(retriedBy ? { retriedBy } : {}) });

test('headOf follows "Render again" links to the newest job and survives loops and gaps', () => {
  const jobs = [j('a', 'stopped', 'b'), j('b', 'error', 'c'), j('c', 'running'), j('x', 'stopped', 'y'), j('l1', 'error', 'l2'), j('l2', 'error', 'l1')];
  assert.equal(headOf(jobs, 'a')?.id, 'c');
  assert.equal(headOf(jobs, 'c')?.id, 'c');
  assert.equal(headOf(jobs, 'x')?.id, 'x', 'a link to a job the studio no longer lists stops at the last known one');
  assert.ok(headOf(jobs, 'l1'), 'a loop does not hang');
  assert.equal(headOf(jobs, 'nope'), undefined);
});

test('reconcile: entries take the status of the newest job in their chain; done entries are never touched', () => {
  const state: Record<string, BatchEntry> = {
    k1: { jobId: 'a', status: 'stopped', sentAt: 1 }, k2: { jobId: 'p', status: 'running', sentAt: 1 }, k3: { jobId: 'z', status: 'done', sentAt: 1, secs: 9 }, k4: { jobId: 'gone', status: 'stopped', sentAt: 1 },
  };
  const jobs: JobLite[] = [{ ...j('a', 'stopped', 'b'), error: 'old' }, { ...j('b', 'done'), started: 1000, finished: 21000, size: 5e6 }, j('p', 'done'), j('z', 'error')];
  assert.equal(reconcile(state, jobs), 2);
  assert.deepEqual([state.k1.jobId, state.k1.status, state.k1.secs, state.k1.sizeMB], ['b', 'done', 20, 5]);
  assert.equal(state.k2.status, 'done');
  assert.deepEqual([state.k3.status, state.k3.jobId], ['done', 'z'], 'a finished video stays finished');
  assert.equal(state.k4.status, 'stopped', 'a job the studio does not list is left alone');
});

test('lockHolder: only a live pid holds the runner lock', () => {
  const alive = (p: number) => p === 4242;
  assert.equal(lockHolder('4242\n', alive), 4242);
  assert.equal(lockHolder('999', alive), null, 'dead pid: stale lock');
  assert.equal(lockHolder('junk', alive), null);
  assert.equal(lockHolder(null, alive), null);
});

// ---------------- a fake studio ----------------
function fakeStudio(initial: JobLite[]) {
  const jobs: JobLite[] = initial.map(x => ({ ...x })); const calls: string[] = []; let n = 0;
  const mk = (): JobLite => ({ id: `new-${++n}`, status: 'done', started: 1000, finished: 9000, size: 3e6 });
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const send = (c: number, v: unknown) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      const url = req.url ?? '', route = `${req.method} ${url.replace(/\/[\w.-]+\/again$/, '/:id/again')}`;
      if (route !== 'GET /api/jobs' && route !== 'GET /api/status') calls.push(route + (route.includes(':id') ? ` ${url.split('/')[3]}` : ''));
      if (route === 'GET /api/status') return send(200, { app: 'sim-studio', state: 'ready', running: null, queued: 0, readOnly: false, codeStale: false });
      if (route === 'GET /api/jobs') return send(200, jobs);
      if (route === 'POST /api/jobs') { const x = mk(); jobs.push(x); return send(200, x); }
      if (route === 'POST /api/jobs/:id/again') {
        const old = jobs.find(x => x.id === url.split('/')[3]); if (!old) return send(404, { error: 'gone' });
        const prev = old.retriedBy ? jobs.find(x => x.id === old.retriedBy) : undefined;
        if (prev && prev.status !== 'error' && prev.status !== 'stopped') return send(409, { error: 'already started again' });
        const x = mk(); jobs.push(x); old.retriedBy = x.id; return send(200, x);
      }
      send(404, {});
    });
  });
  return new Promise<{ port: number; calls: string[]; jobs: JobLite[]; close: () => void }>(ok => server.listen(0, '127.0.0.1', () => ok({ port: (server.address() as { port: number }).port, calls, jobs, close: () => server.close() })));
}
const runner = (dir: string, port: number) => new Promise<{ code: number | null; out: string }>(ok => {
  const c = spawn(process.execPath, [path.join(ROOT, 'tools/batch-run.ts'), '--url', `http://127.0.0.1:${port}`, '--min-free-gb', '0', '--max-load', '1000', '--concurrency', '3'], { cwd: ROOT, env: { ...process.env, SIM_BATCH_DIR: dir } });
  let out = ''; c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; }); c.on('close', code => ok({ code, out }));
});

test('batch runner: no duplicate for a video the owner re-rendered, stopped ones go through "again", new ones are sent once', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-batch-'));
  const item = (key: string) => ({ key, sceneId: 'harmonograph', heavy: false, origin: 'variant', params: {} });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ items: ['A', 'B', 'C', 'D'].map(item) }));
  const entry = (jobId: string, status: string) => ({ jobId, status, sentAt: 1, ...(status === 'done' ? { doneAt: 2, secs: 5 } : {}) });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ A: entry('ja', 'done'), B: entry('jb', 'stopped'), C: entry('jc', 'stopped') }));
  const studio = await fakeStudio([j('ja', 'done'), j('jb', 'stopped', 'jb2'), j('jb2', 'done'), j('jc', 'stopped')]);
  try {
    const r = await runner(dir, studio.port);
    assert.equal(r.code, 0, r.out);
    const posts = studio.calls.filter(c => c === 'POST /api/jobs'), again = studio.calls.filter(c => c.startsWith('POST /api/jobs/:id/again'));
    assert.equal(posts.length, 1, 'only D, never sent before, gets a new job: ' + studio.calls.join(' | '));
    assert.deepEqual(again, ['POST /api/jobs/:id/again jc'], 'C is run again through the studio link; B (already re-rendered) and A (done) are left alone');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.equal(st.B.jobId, 'jb2'); assert.equal(st.B.status, 'done', 'B follows its chain to the finished re-render');
    assert.deepEqual(['A', 'B', 'C', 'D'].map(k => st[k].status), ['done', 'done', 'done', 'done']);
    assert.ok(!fs.existsSync(path.join(dir, '.runner.lock')), 'the lock is released at exit');
  } finally { studio.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('batch runner refuses to start while another runner holds the lock', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-batch-'));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ items: [{ key: 'A', sceneId: 'harmonograph', heavy: false, origin: 'variant', params: {} }] }));
  fs.writeFileSync(path.join(dir, '.runner.lock'), String(process.pid)); // this test process is alive
  const studio = await fakeStudio([]);
  try {
    const r = await runner(dir, studio.port);
    assert.notEqual(r.code, 0); assert.match(r.out, /another batch runner/);
    assert.equal(studio.calls.length, 0, 'nothing was sent');
    assert.equal(fs.readFileSync(path.join(dir, '.runner.lock'), 'utf8'), String(process.pid), 'the other runner\'s lock is untouched');
  } finally { studio.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
