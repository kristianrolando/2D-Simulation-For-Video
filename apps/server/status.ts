// A tiny, cheap summary of what the studio is doing, for the menu bar icon (GET /api/status, localhost only).
// Pure: the server hands in its job list; nothing here touches the disk. No parameters, paths or texts leave the machine.
export interface StatusJob { id: string; sceneId: string; status: 'queued' | 'running' | 'done' | 'error'; progress: { frame: number; frames: number }; created: number; started?: number; finished?: number }
export interface Status {
  app: 'sim-studio';
  /** ready: nothing running · rendering: a job is running · queued: waiting for a worker */
  state: 'ready' | 'rendering' | 'queued';
  running: { sceneId: string; frame: number; frames: number; percent: number } | null;
  queued: number;
  errors: number;
  /** the most recently finished render (done or failed), if any */
  last: { sceneId: string; ok: boolean; secondsAgo: number } | null;
  readOnly: boolean;
  pid: number;
  uptimeSec: number;
  /** server-side files changed on disk after this server started: it runs older code than the files (restart it) */
  codeStale: boolean;
}

export function buildStatus(jobs: StatusJob[], o: { nowMs: number; readOnly: boolean; pid: number; uptimeSec: number; codeStale?: boolean }): Status {
  const run = jobs.find(j => j.status === 'running');
  const queued = jobs.filter(j => j.status === 'queued').length;
  const finished = jobs.filter(j => (j.status === 'done' || j.status === 'error') && j.finished).sort((a, b) => b.finished! - a.finished!)[0];
  const frames = run ? Math.max(1, run.progress.frames || 1) : 1;
  return {
    app: 'sim-studio',
    state: run ? 'rendering' : queued ? 'queued' : 'ready',
    running: run ? { sceneId: run.sceneId, frame: run.progress.frame, frames: run.progress.frames, percent: Math.min(100, Math.max(0, Math.round((100 * run.progress.frame) / frames))) } : null,
    queued,
    errors: jobs.filter(j => j.status === 'error').length,
    last: finished ? { sceneId: finished.sceneId, ok: finished.status === 'done', secondsAgo: Math.max(0, Math.round((o.nowMs - finished.finished!) / 1000)) } : null,
    readOnly: o.readOnly, pid: o.pid, uptimeSec: Math.round(o.uptimeSec), codeStale: o.codeStale === true,
  };
}

/** only the machine itself may ask (the server also listens on 127.0.0.1 only; this is the second lock) */
export const isLoopback = (addr: string | undefined) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/** pure check: is any file newer than the server's start (with a grace period for edits made while it was starting)? */
export const isCodeStale = (newestFileMs: number, startedMs: number, graceMs = 3000) => newestFileMs > startedMs + graceMs;
