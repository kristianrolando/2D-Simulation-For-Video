// The render queue on disk (data/jobs.json), so a restart (or a crash, or `node --watch`) never loses track of what was running.
// Same safety rules as the video list (apps/server/store.ts): atomic writes (temp file, fsync, rename), a backup before each
// overwrite, and a damaged or missing file never stops the studio from starting (it is set aside and the newest good backup is used).
// Pattern borrowed from the other studio's "terhenti, then Lanjutkan" design: a job that was running when the studio stopped is
// shown as Stopped; because renders are deterministic, "Render again" simply runs the same scene and parameters again.
// What is stored: ids, scene, scene parameters, style, status, times, the result. No credentials, tokens or file contents.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped';
export interface JobRecord {
  id: string; sceneId: string; params: Record<string, unknown>; style: string; status: JobStatus;
  created: number; started?: number; finished?: number;
  /** the MP4's file name inside output/ (never a path) */
  out: string;
  /** pid of the render worker (its own process group), so a later start can stop an orphan */
  pid?: number;
  progress: { frame: number; frames: number; fps: number; phase: string };
  report?: unknown; error?: string; size?: number;
  /** a plain-words reason shown for a stopped job */
  note?: string;
  /** id of the job that re-ran this one ("Render again") */
  retriedBy?: string;
}
export const JOB_SCHEMA = 1;
/** how many records are kept on disk (the newest) */
export const KEEP_JOBS = 30;
const KEEP_BACKUPS = 20;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-');
const STATUSES: JobStatus[] = ['queued', 'running', 'done', 'error', 'stopped'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/** one stored record → a clean record, or null when it cannot be a job (bad id, status or file name) */
export function sanitizeJob(raw: unknown): JobRecord | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && /^[\w.-]{3,160}$/.test(raw.id) ? raw.id : '';
  const out = typeof raw.out === 'string' ? path.basename(raw.out) : '';
  if (!id || !out.endsWith('.mp4') || typeof raw.sceneId !== 'string' || !raw.sceneId) return null;
  const status = STATUSES.includes(raw.status as JobStatus) ? (raw.status as JobStatus) : null; if (!status) return null;
  const pr = isObj(raw.progress) ? raw.progress : {};
  const params = isObj(raw.params) ? raw.params : {};
  const j: JobRecord = {
    id, sceneId: raw.sceneId, params, style: typeof params.style === 'string' ? params.style : 'classic', status, out,
    created: num(raw.created) ?? Date.now(),
    progress: { frame: num(pr.frame) ?? 0, frames: num(pr.frames) ?? 0, fps: num(pr.fps) ?? 0, phase: typeof pr.phase === 'string' ? pr.phase.slice(0, 20) : '' },
  };
  const s = num(raw.started), f = num(raw.finished), z = num(raw.size), p = num(raw.pid);
  if (s !== undefined) j.started = s; if (f !== undefined) j.finished = f; if (z !== undefined) j.size = z;
  if (p !== undefined && Number.isInteger(p) && p > 1) j.pid = p;
  if (isObj(raw.report)) j.report = raw.report;
  if (typeof raw.error === 'string') j.error = raw.error.slice(0, 400);
  if (typeof raw.note === 'string') j.note = raw.note.slice(0, 300);
  if (typeof raw.retriedBy === 'string' && /^[\w.-]{3,160}$/.test(raw.retriedBy)) j.retriedBy = raw.retriedBy;
  return j;
}

export function parseJobs(text: string): { ok: true; jobs: JobRecord[]; skipped: number } | { ok: false; detail: string } {
  let raw: unknown; try { raw = JSON.parse(text); } catch { return { ok: false, detail: 'not valid JSON' }; }
  if (!isObj(raw) || typeof raw.schemaVersion !== 'number' || !Array.isArray(raw.jobs)) return { ok: false, detail: 'not a job list' };
  if (raw.schemaVersion > JOB_SCHEMA) return { ok: false, detail: `schema ${raw.schemaVersion} is newer than this studio understands` };
  const seen = new Set<string>(), jobs: JobRecord[] = []; let skipped = 0;
  for (const r of raw.jobs) { const j = sanitizeJob(r); if (!j || seen.has(j.id)) { skipped++; continue; } seen.add(j.id); jobs.push(j); }
  return { ok: true, jobs, skipped };
}

/** The records worth keeping on disk, oldest first: every queued or running job (never dropped, however many there are, or the
 *  next job to run could vanish from a long queue) plus the newest KEEP_JOBS of the finished ones. */
export function pruneJobs<T extends { status: JobStatus; created: number }>(jobs: T[]): T[] {
  const live = (j: T) => j.status === 'queued' || j.status === 'running';
  const finished = jobs.filter(j => !live(j)).sort((a, b) => b.created - a.created).slice(0, KEEP_JOBS);
  return [...jobs.filter(live), ...finished].sort((a, b) => a.created - b.created);
}

export interface JobStoreOptions { io?: typeof fs; now?: () => Date; /** false for a second, read-only studio: it must never write the file */ canWrite?: () => boolean }
export function openJobStore(dir: string, opts: JobStoreOptions = {}) {
  const io = opts.io ?? fs, nowFn = opts.now ?? (() => new Date()), canWrite = opts.canWrite ?? (() => true);
  const file = path.join(dir, 'jobs.json'), backups = path.join(dir, 'backups');
  let notice = '', tmp = 0;
  const readText = (f: string) => { try { return io.readFileSync(f, 'utf8'); } catch { return null; } };
  const backupFiles = () => { try { return io.readdirSync(backups).filter(f => /^jobs-\d{8}-\d{6}-\d{3}\.json$/.test(f)).sort().reverse(); } catch { return []; } };
  function writeAtomic(target: string, text: string) {
    io.mkdirSync(path.dirname(target), { recursive: true });
    const t = `${target}.${process.pid}.${++tmp}.tmp`, fd = io.openSync(t, 'w');
    try { io.writeFileSync(fd, text); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    io.renameSync(t, target);
  }
  /** the stored jobs. Never throws: a damaged file is moved aside and the newest good backup is used, else the list is empty. */
  function load(): JobRecord[] {
    const text = readText(file);
    if (text === null) return [];
    const r = parseJobs(text);
    if (r.ok) { if (r.skipped) notice = `${r.skipped} entr${r.skipped === 1 ? 'y' : 'ies'} of the render list could not be read and ${r.skipped === 1 ? 'was' : 'were'} skipped.`; return r.jobs; }
    if (canWrite()) { try { io.renameSync(file, `${file}.damaged-${stamp(nowFn())}`); } catch { /* leave it */ } }
    for (const f of backupFiles()) { const t = readText(path.join(backups, f)); const b = t === null ? null : parseJobs(t); if (b?.ok) { notice = `The render list was damaged (${r.detail}); the last good copy was used.`; return b.jobs; } }
    notice = `The render list was damaged (${r.detail}) and started empty. The damaged file was kept next to it.`; return [];
  }
  /** write the newest jobs; the file on disk is copied to backups/ first. A read-only studio does nothing. */
  function save(jobs: JobRecord[]) {
    if (!canWrite()) return;
    const keep = pruneJobs(jobs).map(j => ({ ...j }));
    try {
      const old = readText(file);
      if (old !== null && parseJobs(old).ok) { writeAtomic(path.join(backups, `jobs-${stamp(nowFn())}.json`), old); for (const f of backupFiles().slice(KEEP_BACKUPS)) { try { io.rmSync(path.join(backups, f), { force: true }); } catch { /* ignore */ } } }
      writeAtomic(file, JSON.stringify({ schemaVersion: JOB_SCHEMA, savedAt: nowFn().toISOString(), jobs: keep }, null, 1) + '\n');
    } catch (e) { console.warn('render list: could not save:', e instanceof Error ? e.message : e); } // a full disk must never fail a render
  }
  return { file, load, save, notice: () => notice };
}
export type JobStore = ReturnType<typeof openJobStore>;

// ---------------- processes: only ever our own render workers ----------------
export const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
/** the command line of a process, '' if it is gone */
export const commandOf = (pid: number): string => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return ''; } };
/** Is this pid one of this studio's render workers for this job? (the pid may have been reused by anything else since) */
export function isOurWorker(pid: number, workerScript: string, jobId: string, cmd: (pid: number) => string = commandOf): boolean {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;
  const c = cmd(pid); return c.includes(workerScript) && c.includes(jobId);
}
/** stop a worker and everything it started (ffmpeg) at once: the worker runs in its own process group (spawned `detached`) */
export function killGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL') {
  try { process.kill(-pid, signal); return; } catch { /* no such group */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
}

// ---------------- leftovers ----------------
/** the temporary files of one render, by its MP4 name: the request the worker reads and the audio it mixes */
export const tempFilesOf = (outDir: string, out: string) => { const base = path.join(outDir, out.replace(/\.mp4$/, '')); return [base + '.request.json', base + '.wav']; };
/** files of a render that never finished: the half-written MP4 and the record next to it (it is what makes an MP4 count as a finished render) */
export const partialFilesOf = (outDir: string, out: string) => { const base = path.join(outDir, out.replace(/\.mp4$/, '')); return [path.join(outDir, out), base + '.job.json']; };
/** `*.request.json` files that no running job owns (a worker reads its request once at the start, so they are dead weight) */
export function strayRequests(outDir: string, owned: Set<string> = new Set()): string[] {
  try { return fs.readdirSync(outDir).filter(f => f.endsWith('.request.json') && !owned.has(f)).map(f => path.join(outDir, f)); } catch { return []; }
}
const rm = (f: string) => { try { fs.rmSync(f, { force: true }); return true; } catch { return false; } };
export const removeFiles = (files: string[]) => files.filter(rm).length;

/** an MP4 only counts as the finished render when it is as long as the job's frame count says (a killed ffmpeg can leave a short one) */
export function isComplete(durationSec: number, frames: number, fps = 60): boolean {
  return frames > 0 && durationSec > 0 && durationSec >= (frames / fps) * 0.99;
}

export const STOPPED_NOTE = 'The studio stopped while this was in the queue. Nothing was lost: press Render again to run it with the same settings.';
