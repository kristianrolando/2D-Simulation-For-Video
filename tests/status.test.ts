// GET /api/status: the light summary the macOS menu bar app polls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildStatus, isLoopback, isCodeStale, type StatusJob } from '../apps/server/status.ts';

const J = (o: Partial<StatusJob> & { id: string }): StatusJob => ({ sceneId: 'galton-board', status: 'queued', progress: { frame: 0, frames: 0 }, created: 0, ...o });
const O = { nowMs: 100_000, readOnly: false, pid: 42, uptimeSec: 12.4 };

test('status: ready when nothing runs, with no last render', () => {
  const s = buildStatus([], O);
  assert.deepEqual(s, { app: 'sim-studio', state: 'ready', running: null, queued: 0, errors: 0, last: null, readOnly: false, pid: 42, uptimeSec: 12, codeStale: false });
});

test('status: codeStale only when the server-side code changed after the server started (3 s grace)', () => {
  assert.equal(isCodeStale(10_000, 10_000), false);
  assert.equal(isCodeStale(12_900, 10_000), false, 'edits made while starting do not count');
  assert.equal(isCodeStale(13_100, 10_000), true);
  assert.equal(buildStatus([], { ...O, codeStale: true }).codeStale, true);
});

test('status: rendering shows the running scene and a percentage; waiting jobs are counted', () => {
  const s = buildStatus([J({ id: 'a', status: 'running', sceneId: 'hammer-smash', progress: { frame: 825, frames: 3300 } }), J({ id: 'b' }), J({ id: 'c' })], O);
  assert.equal(s.state, 'rendering'); assert.equal(s.queued, 2);
  assert.deepEqual(s.running, { sceneId: 'hammer-smash', frame: 825, frames: 3300, percent: 25 });
  // a job that has not reported its frame count yet must not divide by zero or exceed 100
  assert.equal(buildStatus([J({ id: 'a', status: 'running', progress: { frame: 5, frames: 0 } })], O).running!.percent, 100);
  assert.equal(buildStatus([J({ id: 'a', status: 'running', progress: { frame: 0, frames: 0 } })], O).running!.percent, 0);
});

test('status: queued state, last finished render (newest wins, failures flagged) and error count', () => {
  assert.equal(buildStatus([J({ id: 'a' })], O).state, 'queued');
  const s = buildStatus([J({ id: 'a', status: 'done', finished: 40_000 }), J({ id: 'b', status: 'error', sceneId: 'billiard', finished: 70_000 }), J({ id: 'c', status: 'done', finished: 10_000 })], O);
  assert.equal(s.state, 'ready'); assert.equal(s.errors, 1);
  assert.deepEqual(s.last, { sceneId: 'billiard', ok: false, secondsAgo: 30 });
  assert.equal(buildStatus([J({ id: 'a', status: 'done', finished: 99_000 })], O).last!.secondsAgo, 1);
  assert.equal(buildStatus([], { ...O, readOnly: true }).readOnly, true);
});

test('status: carries no parameters, titles or file paths', () => {
  const s = JSON.stringify(buildStatus([J({ id: '/Users/x/secret-title', status: 'running', progress: { frame: 1, frames: 2 } })], O));
  assert.ok(!s.includes('secret') && !s.includes('/Users'));
});

test('status: only loopback callers are accepted', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.ok(isLoopback(a));
  for (const a of ['192.168.1.5', '10.0.0.2', '::ffff:10.0.0.2', '8.8.8.8', '', undefined]) assert.equal(isLoopback(a), false, String(a));
});

test('GET /api/status on a real server: JSON, small, fast, and the server is the studio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-status-')), port = 5300 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['apps/server/server.ts'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(port), SIM_DATA_DIR: dir }, stdio: 'ignore' });
  try {
    let res: Response | null = null;
    for (let i = 0; i < 60 && !res; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/status`); if (r.ok) res = r; } catch { await new Promise(r => setTimeout(r, 250)); } }
    assert.ok(res, 'server did not come up');
    assert.match(res!.headers.get('content-type') ?? '', /json/);
    const t0 = performance.now(), again = await fetch(`http://127.0.0.1:${port}/api/status`), body = await again.text(), ms = performance.now() - t0;
    const j = JSON.parse(body);
    assert.equal(j.app, 'sim-studio'); assert.ok(['ready', 'rendering', 'queued'].includes(j.state)); assert.equal(j.readOnly, false);
    assert.ok(body.length < 600, `${body.length} bytes`); assert.ok(ms < 500, `${ms} ms`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`, { method: 'POST' })).status, 404, 'read-only endpoint');
  } finally { child.kill('SIGTERM'); await new Promise(r => setTimeout(r, 500)); fs.rmSync(dir, { recursive: true, force: true }); }
});
