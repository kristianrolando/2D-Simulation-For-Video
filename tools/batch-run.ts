// Batch runner: sends the videos of data/batch/plan.json to the running studio, a few at a time, gently.
//   node tools/batch-run.ts --dry-run            show what would happen (nothing is sent)
//   node tools/batch-run.ts --limit 3            send only the next 3 videos (a trial)
//   node tools/batch-run.ts                      send everything not done yet, then stop
//   --dir <folder>                               run another plan (its own plan.json, state.json, lock and PAUSE), e.g. --dir data/batch-plasma
//                                                (the Plasma Pendulum plan, tools/batch-plan-plasma.ts). Without it: data/batch, as always.
// It never starts the studio, never touches YouTube, never deletes anything. Ctrl+C stops SENDING; videos already
// in the studio's queue keep going (stop them in the studio if needed). Run it again and it continues where it stopped.
// The studio runs jobs side by side only when it was started with JOBS=N (npm run dev with JOBS=2); default is one at a time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PlanItem } from './batch-plan.ts';
import { headOf, reconcile, lockHolder, type JobLite } from './batch-chain.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BATCH = opt('--dir') ? path.resolve(opt('--dir')!) : process.env.SIM_BATCH_DIR ? path.resolve(process.env.SIM_BATCH_DIR) : path.join(ROOT, 'data/batch'); // SIM_BATCH_DIR: tests only
const LOCK = path.join(BATCH, '.runner.lock');
const PLAN = path.join(BATCH, 'plan.json'), STATE = path.join(BATCH, 'state.json'), PAUSE = path.join(BATCH, 'PAUSE');
const DRY = args.includes('--dry-run');
const BASE = opt('--url', 'http://127.0.0.1:5180')!;
const LIMIT = opt('--limit') ? +opt('--limit')! : Infinity;
const WIDTH = Math.min(3, Math.max(1, +(opt('--concurrency', '2')!)));       // videos in flight (queued + running); never more than 3
const MIN_FREE_GB = +(opt('--min-free-gb', '40')!);
const MAX_LOAD = +(opt('--max-load', String(Math.round(os.cpus().length * 0.8)))!);   // pause sending while the 1-minute load is above this
const MAX_ERRORS = 5;                                                          // stop after this many failed videos in a row
const only = opt('--only');                                                    // substring of a key or scene, e.g. --only hammer

interface Entry { jobId: string; status: string; sentAt: number; doneAt?: number; secs?: number; sizeMB?: number; error?: string }
type State = Record<string, Entry>;
const readState = (): State => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const writeState = (s: State) => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); const t = STATE + '.tmp'; fs.writeFileSync(t, JSON.stringify(s, null, 1)); fs.renameSync(t, STATE); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const freeGB = () => { try { const o = execFileSync('df', ['-k', ROOT]).toString().trim().split('\n').pop()!.split(/\s+/); return +o[3] / 1048576; } catch { return Infinity; } };
async function api(p: string, init?: RequestInit) { const r = await fetch(BASE + p, { ...init, headers: { 'content-type': 'application/json' } }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json() as Promise<any>; }

const plan: { items: PlanItem[] } = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const state = readState();
const wanted = () => plan.items.filter(i => (!only || i.key.includes(only) || i.sceneId.includes(only)) && !(state[i.key] && state[i.key].status !== 'error' && state[i.key].status !== 'stopped'));
// What the studio knows comes first: a render the owner already started again ("Render again") is that same video, not a new one to send.
let studioJobs: JobLite[] | null = null;
try { studioJobs = await api('/api/jobs'); } catch { /* studio not running: a dry run still works from the saved state */ }
if (studioJobs && reconcile(state, studioJobs) && !DRY) writeState(state);
let todo = wanted();
console.log(`plan ${plan.items.length} · done or sent ${Object.values(state).filter(e => e.status === 'done').length} · to send ${Math.min(todo.length, LIMIT)} · width ${WIDTH} · free disk ${freeGB().toFixed(0)} GB · load ${os.loadavg()[0].toFixed(1)} (pause above ${MAX_LOAD})`);
if (DRY) { for (const i of todo.slice(0, Math.min(LIMIT, 15))) console.log('  would send', i.key); if (todo.length > 15 && LIMIT > 15) console.log(`  … and ${Math.min(todo.length, LIMIT) - 15} more`); process.exit(0); }

// one runner at a time on this plan (a second one would send every video twice)
const holder = lockHolder(fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8') : null, pid => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } });
if (holder) throw new Error(`another batch runner is already running (pid ${holder}). Stop it first.`);
fs.mkdirSync(path.dirname(LOCK), { recursive: true }); fs.writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { if (fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.rmSync(LOCK, { force: true }); } catch { /* gone */ } };
process.on('exit', unlock);

// preflight: the studio must be up, idle enough, and running the current code
const st = await api('/api/status');
if (st.readOnly) throw new Error('the studio is read-only; nothing can be rendered');
if (st.codeStale) throw new Error('the studio runs old code (codeStale: true). Restart it first (not while a render runs).');
if (st.running || st.queued) console.log(`note: the studio already has work (running ${JSON.stringify(st.running)}, queued ${st.queued}); this batch will queue behind it`);

let stopping = false; process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('\nstopping: no new videos will be sent; those already in the studio keep going.'); });
let sent = 0, errorsInRow = 0, lastSend = 0;
const inflight = new Map<string, PlanItem>();   // key -> item, sent but not finished
for (const i of plan.items) if (state[i.key] && (state[i.key].status === 'queued' || state[i.key].status === 'running')) inflight.set(i.key, i);   // sent by an earlier run, still going

let jobsNow: JobLite[] = studioJobs ?? [];
async function refresh() {
  const jobs: any[] = await api('/api/jobs'); jobsNow = jobs;
  for (const [key] of inflight) {
    const e = state[key]; const j = headOf(jobs, e.jobId);   // follows "Render again" to the newest job of this video
    if (!j) continue;
    e.jobId = j.id; e.status = j.status;
    if (j.status === 'done') { e.doneAt = Date.now(); e.secs = j.started && j.finished ? Math.round((j.finished - j.started) / 1000) : undefined; e.sizeMB = j.size ? +(j.size / 1e6).toFixed(1) : undefined; errorsInRow = 0; inflight.delete(key); }
    else if (j.status === 'error' || j.status === 'stopped') { e.error = j.error ?? j.note; e.doneAt = Date.now(); errorsInRow++; inflight.delete(key); }
  }
  writeState(state);
}

while ((todo.length || inflight.size) && !stopping) {
  await refresh();
  if (errorsInRow >= MAX_ERRORS) { console.log(`stopped: ${MAX_ERRORS} videos in a row failed. See ${path.relative(ROOT, STATE)}.`); break; }
  if (sent >= LIMIT || !todo.length) { if (!inflight.size) break; await sleep(3000); continue; }
  const why = fs.existsSync(PAUSE) ? 'PAUSE file present' : os.loadavg()[0] > MAX_LOAD ? `load ${os.loadavg()[0].toFixed(1)} too high` : freeGB() < MIN_FREE_GB ? `free disk below ${MIN_FREE_GB} GB` : '';
  if (why) { process.stdout.write(`\rwaiting: ${why}   `); await sleep(10000); continue; }
  if (inflight.size >= WIDTH || Date.now() - lastSend < 1600) { await sleep(2000); continue; }   // 1.6 s apart: the studio names files to the second
  const heavyBusy = [...inflight.values()].some(i => i.heavy);
  const at = todo.findIndex(i => !(i.heavy && heavyBusy));                                      // never two hammer-smash side by side
  if (at < 0) { await sleep(3000); continue; }
  const item = todo.splice(at, 1)[0];
  try {
    // a video that already has a stopped or failed job is run AGAIN through the studio's own link (no duplicate, and the studio refuses
    // with 409 when somebody already started it again); a video never sent gets a new job
    const prev = state[item.key]?.jobId;
    let j: any;
    if (prev && jobsNow.some(x => x.id === prev)) {
      try { j = await api(`/api/jobs/${prev}/again`, { method: 'POST', body: '{}' }); }
      catch (e) { if (/409/.test(String(e))) { console.log('skipped', item.key, '(already started again)'); continue; } throw e; }
    } else j = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ sceneId: item.sceneId, params: item.params }) });
    state[item.key] = { jobId: j.id, status: j.status, sentAt: Date.now() }; inflight.set(item.key, item); sent++; lastSend = Date.now(); writeState(state);
    console.log(`sent ${sent}${LIMIT < Infinity ? '/' + LIMIT : ''} ${item.key}  (${todo.length} left, ${inflight.size} in flight)`);
  } catch (e) { console.log('could not send', item.key, e instanceof Error ? e.message : e); errorsInRow++; }
}
await refresh().catch(() => {});
const all = Object.values(state), done = all.filter(e => e.status === 'done');
console.log(`finished sending. done ${done.length}/${plan.items.length}, failed ${all.filter(e => e.status === 'error' || e.status === 'stopped').length}, still running ${inflight.size}` + (done.length ? ` · avg ${Math.round(done.reduce((a, e) => a + (e.secs ?? 0), 0) / done.length)} s, ${(done.reduce((a, e) => a + (e.sizeMB ?? 0), 0) / 1000).toFixed(1)} GB so far` : ''));
