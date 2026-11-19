// `npm run dev:watch` (node --watch apps/server/server.ts): a server file changes while a render runs. The watcher restarts the studio;
// the render must come back as Stopped (never lost), its worker must not survive, nothing may be left behind, and the new server
// must know it is current. Throw-away folders and another port; only the modification time of one server file is touched (no content).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { processAlive } from '../apps/server/job-store.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-watch-'));
let watcher: ChildProcess | null = null;
after(() => { if (watcher?.pid) { try { process.kill(-watcher.pid, 'SIGKILL'); } catch { /* gone */ } } fs.rmSync(T, { recursive: true, force: true }); });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until<V>(fn: () => Promise<V | false>, ms = 60000): Promise<V> { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* not up yet */ } await sleep(150); } throw new Error('timed out'); }

test('dev:watch restarts the studio on a server file change: the running render becomes Stopped, no orphan worker, no leftovers, the new server is current', { timeout: 180000 }, async () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['dev:watch'], 'node --watch apps/server/server.ts', 'the test runs exactly what the script runs');
  const data = path.join(T, 'data'), out = path.join(T, 'out'), port = 6950 + Math.floor(Math.random() * 40), base = `http://127.0.0.1:${port}`;
  fs.mkdirSync(data); fs.mkdirSync(out);
  watcher = spawn(process.execPath, ['--watch', 'apps/server/server.ts'], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, HOME: path.join(T, 'home'), PORT: String(port), SIM_DATA_DIR: data, SIM_OUT_DIR: out } });
  const status = async () => { const s: any = await (await fetch(base + '/api/status', { signal: AbortSignal.timeout(2000) })).json(); return s.app === 'sim-studio' ? s : false; };
  const first = await until(status);
  const r = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: 'harmonograph', params: { duration: 15 } }) });
  const job = (await r.json()) as any;
  await until(async () => { const j = ((await (await fetch(base + '/api/jobs')).json()) as any[]).find(x => x.id === job.id); return j?.status === 'running' && j.progress.frame > 0; });
  const workerPid = JSON.parse(fs.readFileSync(path.join(data, 'jobs.json'), 'utf8')).jobs.find((j: any) => j.id === job.id).pid as number;
  assert.ok(processAlive(workerPid));
  // the edit: only the modification time of a server file changes (git sees nothing)
  const f = path.join(ROOT, 'apps/server/awake.ts'), st = fs.statSync(f), now = new Date();
  fs.utimesSync(f, now, now);
  try {
    const second = await until(async () => { const s = await status(); return s && s.pid !== first.pid ? s : false; }, 60000);
    assert.notEqual(second.pid, first.pid, 'the watcher started a new server');
    assert.equal(processAlive(workerPid), false, 'the old render worker did not survive the restart');
    const back = ((await (await fetch(base + '/api/jobs')).json()) as any[]).find(x => x.id === job.id);
    assert.equal(back.status, 'stopped'); assert.match(back.note, /Render again/);
    assert.deepEqual(fs.readdirSync(out).filter(n => n.startsWith(job.id)), [], 'no request, audio or half-written video left');
    assert.equal(second.codeStale, false, 'the new server loaded the current files');
    assert.equal(second.readOnly, false, 'it took over the data folder lock');
  } finally { fs.utimesSync(f, st.atime, st.mtime); }
});
