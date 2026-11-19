// Local file store for the video list (data/videos.json). Built to never lose or corrupt data:
//  - every save writes a temp file, fsyncs it and renames it over the real file (a crash leaves the old file whole);
//  - before each overwrite the current file is copied to data/backups/ (newest 50, plus one snapshot per day for 60 days);
//  - the file carries a schema version; older versions are migrated, newer ones are set aside, never overwritten blindly;
//  - a missing or damaged file never throws: the damaged file is moved aside (kept), the newest good backup is restored,
//    or the list starts empty, and `notice` says what happened in plain words.
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, sanitizeVideo, newId, toCsv, isLang, type SuggestLang, type Video, type VideoStore } from '../../packages/publish/index.ts';

export interface Notice { level: 'info' | 'warn'; text: string }
export interface StoreOptions {
  io?: typeof fs; keepBackups?: number; keepDays?: number; now?: () => Date;
  /** take data/.lock (holds the PID) so only one studio writes; a second one opens read-only */
  lock?: boolean; pid?: number; isAlive?: (pid: number) => boolean;
}
/** is a process with this PID running? (EPERM means it exists but belongs to someone else) */
export const processAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
export class ReadOnlyError extends Error { constructor(msg: string) { super(msg); this.name = 'ReadOnlyError'; } }

/** upgrade an older file to the current shape; add one function per schema bump */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export type ReadResult =
  | { ok: true; store: VideoStore; skipped: number }
  | { ok: false; reason: 'missing' | 'unreadable' | 'newer'; detail: string };

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-'); // 20261118-094412-123

export function parseStore(text: string, now: string = new Date().toISOString()): ReadResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, reason: 'unreadable', detail: 'not valid JSON' }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'unreadable', detail: 'not a video list' };
  let obj = raw as Record<string, unknown>;
  const v = obj.schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, reason: 'unreadable', detail: 'no schema version' };
  if (v > SCHEMA_VERSION) return { ok: false, reason: 'newer', detail: `schema ${v} is newer than this studio understands (${SCHEMA_VERSION})` };
  for (let k = v; k < SCHEMA_VERSION; k++) { const m = MIGRATIONS[k]; if (m) obj = m(obj); }
  if (!Array.isArray(obj.videos)) return { ok: false, reason: 'unreadable', detail: 'no "videos" list' };
  const seen = new Set<string>(); const videos: Video[] = []; let skipped = 0;
  for (const r of obj.videos) {
    const s = sanitizeVideo(r, now);
    if (!s) { skipped++; continue; }
    if (seen.has(s.id)) s.id = newId();
    seen.add(s.id); videos.push(s);
  }
  const st = obj.settings as Record<string, unknown> | undefined;
  const settings = st && typeof st === 'object' && isLang(st.suggestLang) ? { suggestLang: st.suggestLang } : {};
  return { ok: true, skipped, store: { schemaVersion: SCHEMA_VERSION, savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : now, videos, settings } };
}

export function openStore(dir: string, opts: StoreOptions = {}) {
  const io = opts.io ?? fs, keep = opts.keepBackups ?? 50, keepDays = opts.keepDays ?? 60, nowFn = opts.now ?? (() => new Date());
  const file = path.join(dir, 'videos.json'), backups = path.join(dir, 'backups');
  let state: VideoStore = { schemaVersion: SCHEMA_VERSION, savedAt: nowFn().toISOString(), videos: [] };
  let notice: Notice | null = null;
  let tmpCounter = 0;
  const myPid = opts.pid ?? process.pid, alive = opts.isAlive ?? processAlive, lockFile = path.join(dir, '.lock');
  let readOnlyReason = '', owner = false;

  /** take the lock with an exclusive create. A lock whose process is gone (crash, kill -9) is stale and is taken over. */
  function acquire(): boolean {
    if (!opts.lock) return true;
    try { io.mkdirSync(dir, { recursive: true }); } catch (e) { readOnlyReason = `The data folder cannot be created (${(e as Error).message}).`; return false; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = io.openSync(lockFile, 'wx'); io.writeSync(fd, JSON.stringify({ pid: myPid, started: nowFn().toISOString() })); io.fsyncSync(fd); io.closeSync(fd);
        owner = true; readOnlyReason = ''; return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') { readOnlyReason = `The data folder is not writable (${(e as Error).message}).`; return false; }
      }
      let holder = 0; const text = readText(lockFile);
      try { holder = Number(JSON.parse(text ?? '').pid) || 0; } catch { holder = 0; }
      if (holder > 0 && holder !== myPid && alive(holder)) { readOnlyReason = `Another studio (process ${holder}) is already using the data folder.`; return false; }
      if (holder === myPid && owner) return true;
      if (holder === 0) { // unreadable lock: maybe another studio is writing it right now; give it a moment
        try { if (nowFn().getTime() - io.statSync(lockFile).mtimeMs < 3000) { readOnlyReason = 'Another studio is starting up and using the data folder.'; return false; } } catch { /* vanished: retry */ }
      }
      try { io.rmSync(lockFile, { force: true }); } catch { /* retry */ }
    }
    readOnlyReason = 'The data folder lock could not be taken.'; return false;
  }
  const canWrite = () => !opts.lock || owner;
  function release() { if (!owner) return; owner = false; try { if (JSON.parse(readText(lockFile) ?? '{}').pid === myPid) io.rmSync(lockFile, { force: true }); } catch { /* already gone */ } }

  /** write a temp file next to the target, flush it to disk, then rename it over the target */
  function writeAtomic(target: string, text: string) {
    const tmp = `${target}.${process.pid}.${++tmpCounter}.tmp`;
    let fd: number | null = null;
    try {
      io.mkdirSync(path.dirname(target), { recursive: true });
      fd = io.openSync(tmp, 'w'); io.writeSync(fd, text); io.fsyncSync(fd); io.closeSync(fd); fd = null;
      io.renameSync(tmp, target);
    } catch (e) {
      if (fd !== null) { try { io.closeSync(fd); } catch { /* already closed */ } }
      try { io.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
      throw e;
    }
  }
  const readText = (f: string) => { try { return io.readFileSync(f, 'utf8'); } catch { return null; } };
  const backupFiles = () => { try { return io.readdirSync(backups).filter(f => /^videos-\d{8}-\d{6}-\d{3}\.json$/.test(f)).sort().reverse(); } catch { return []; } };
  const dailyFiles = () => { try { return io.readdirSync(backups).filter(f => /^daily-\d{8}\.json$/.test(f)).sort().reverse(); } catch { return []; } };

  function setAside(why: string): string {
    if (!canWrite()) return `videos.json (left untouched: read-only)`;
    const name = `videos.${why}-${stamp(nowFn())}.json`;
    try { io.renameSync(file, path.join(dir, name)); } catch { /* could not move; the next save still backs it up as text */ }
    return name;
  }

  /** copy what is on disk now into backups/ before it gets overwritten */
  function backupCurrent() {
    if (!canWrite()) return;
    const text = readText(file); if (text === null) return;
    if (!parseStore(text).ok) { setAside('damaged'); return; } // never overwrite something unreadable without keeping it
    const d = nowFn();
    writeAtomic(path.join(backups, `videos-${stamp(d)}.json`), text);
    const day = `daily-${d.toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    if (!io.existsSync(path.join(backups, day))) writeAtomic(path.join(backups, day), text);
    for (const f of backupFiles().slice(keep)) { try { io.rmSync(path.join(backups, f), { force: true }); } catch { /* ignore */ } }
    const cutoff = new Date(d.getTime() - keepDays * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    for (const f of dailyFiles()) if (f.slice(6, 14) < cutoff) { try { io.rmSync(path.join(backups, f), { force: true }); } catch { /* ignore */ } }
  }

  function save(next: VideoStore) {
    if (!canWrite()) throw new ReadOnlyError(readOnlyReason || 'The video list is read-only.');
    const out: VideoStore = { schemaVersion: SCHEMA_VERSION, savedAt: nowFn().toISOString(), videos: next.videos, settings: next.settings ?? {} };
    backupCurrent();
    writeAtomic(file, JSON.stringify(out, null, 2) + '\n');
    state = out;
  }

  function load(): VideoStore {
    notice = null;
    const text = readText(file);
    if (text !== null) {
      const r = parseStore(text, nowFn().toISOString());
      if (r.ok) {
        state = r.store;
        if (r.skipped) notice = { level: 'warn', text: `${r.skipped} entr${r.skipped === 1 ? 'y' : 'ies'} in the video list could not be read and ${r.skipped === 1 ? 'was' : 'were'} skipped. The original file is in the data/ folder's backups.` };
        return state;
      }
      // unreadable or from a newer version: keep the file, then fall back to the newest good backup
      const aside = setAside(r.reason === 'newer' ? 'newer' : 'damaged');
      const restored = restoreFromBackup();
      notice = { level: 'warn', text: `The video list file could not be used (${r.detail}). ${canWrite() ? `It was kept as data/${aside}.` : 'It was left untouched (read-only).'} ${restored ? `Restored the newest backup (${restored.videos} videos, saved ${restored.when}).` : 'No backup was available, so the list starts empty.'}` };
      return state;
    }
    // missing: first run, or the file was deleted; a backup may exist
    const restored = backupFiles().length || dailyFiles().length ? restoreFromBackup() : null;
    if (restored) notice = { level: 'warn', text: `The video list file was missing. Restored the newest backup (${restored.videos} videos, saved ${restored.when}).` };
    else state = { schemaVersion: SCHEMA_VERSION, savedAt: nowFn().toISOString(), videos: [] };
    return state;
  }

  function restoreFromBackup(): { videos: number; when: string } | null {
    for (const f of [...backupFiles(), ...dailyFiles()]) {
      const t = readText(path.join(backups, f)); if (t === null) continue;
      const r = parseStore(t, nowFn().toISOString());
      if (r.ok) {
        if (canWrite()) try { writeAtomic(file, JSON.stringify(r.store, null, 2) + '\n'); } catch { /* still usable in memory */ }
        state = r.store;
        return { videos: r.store.videos.length, when: r.store.savedAt.slice(0, 16).replace('T', ' ') };
      }
    }
    return null;
  }

  acquire();
  load();
  return {
    dir, file, backups,
    /** the one-time message from loading (null once taken) */
    takeNotice(): Notice | null { const n = notice; notice = null; return n; },
    /** a message for the next page load (e.g. the uploader explaining why a waiting upload was dropped) */
    setNotice(n: Notice) { notice = n; },
    reload: load,
    get readOnly() { return !canWrite(); },
    get readOnlyReason() { return canWrite() ? '' : readOnlyReason; },
    /** a read-only studio calls this now and then: if the other studio is gone, take over and reload from disk */
    retryLock(): boolean { if (canWrite()) return false; if (acquire()) { load(); return true; } return false; },
    close: release,
    settings(): { suggestLang: SuggestLang } { return { suggestLang: isLang(state.settings?.suggestLang) ? state.settings!.suggestLang! : 'en' }; },
    setSuggestLang(lang: SuggestLang) { save({ ...state, settings: { ...state.settings, suggestLang: lang } }); },
    list(): Video[] { return state.videos; },
    get(id: string): Video | undefined { return state.videos.find(v => v.id === id); },
    /** change the list transactionally: the new list becomes current only if it was saved */
    mutate<T>(fn: (videos: Video[]) => { videos: Video[]; result: T }): T {
      const { videos, result } = fn(state.videos.map(v => ({ ...v })));
      save({ ...state, videos });
      return result;
    },
    exportJson: () => JSON.stringify(state, null, 2) + '\n',
    exportCsv: () => toCsv(state.videos),
    backupList: () => backupFiles(),
  };
}
export type Store = ReturnType<typeof openStore>;
