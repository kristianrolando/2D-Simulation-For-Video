// The long-video records on disk: data/compilations/<id>.json, one small file per long video (so one damaged file never takes the others).
// Same safety rules as the video list (store.ts) and the render queue (job-store.ts): atomic writes (temp file, fsync, rename), the
// previous version kept as <id>.json.bak, and a damaged or unreadable file never stops the studio from starting: it is set aside
// (kept, never deleted), the .bak is used when it is good, and `notice` says what happened in plain words.
// Clip frame counts and file names only; no credentials, no tokens.
import fs from 'node:fs';
import path from 'node:path';
import { COMPILE_SCHEMA, sanitizeCompilation, type Compilation } from '../../packages/compile/index.ts';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-');
export interface CompileStoreOptions { io?: typeof fs; now?: () => Date; /** false for a second, read-only studio: it must never write */ canWrite?: () => boolean }

export function parseCompilation(text: string): { ok: true; c: Compilation } | { ok: false; detail: string } {
  let raw: unknown; try { raw = JSON.parse(text); } catch { return { ok: false, detail: 'not valid JSON' }; }
  if (typeof raw !== 'object' || raw === null) return { ok: false, detail: 'not a long-video record' };
  const v = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v !== 'number' || v < 1) return { ok: false, detail: 'no schema version' };
  if (v > COMPILE_SCHEMA) return { ok: false, detail: `schema ${v} is newer than this studio understands (${COMPILE_SCHEMA})` };
  const c = sanitizeCompilation((raw as { compilation?: unknown }).compilation);
  return c ? { ok: true, c } : { ok: false, detail: 'no usable long-video record' };
}

export function openCompileStore(dir: string, opts: CompileStoreOptions = {}) {
  const io = opts.io ?? fs, nowFn = opts.now ?? (() => new Date()), canWrite = opts.canWrite ?? (() => true);
  let notice = '', tmp = 0;
  const file = (id: string) => path.join(dir, `${id}.json`);
  const readText = (f: string) => { try { return io.readFileSync(f, 'utf8'); } catch { return null; } };
  function writeAtomic(target: string, text: string) {
    io.mkdirSync(path.dirname(target), { recursive: true });
    const t = `${target}.${process.pid}.${++tmp}.tmp`, fd = io.openSync(t, 'w');
    try { io.writeFileSync(fd, text); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    io.renameSync(t, target);
  }
  /** every stored long video, oldest first. Never throws. */
  function load(): Compilation[] {
    let names: string[] = []; try { names = io.readdirSync(dir).filter(f => /^c-[\w.-]+\.json$/.test(f)).sort(); } catch { return []; }
    const out: Compilation[] = [], problems: string[] = [];
    for (const n of names) {
      const f = path.join(dir, n), text = readText(f); if (text === null) continue;
      const r = parseCompilation(text);
      if (r.ok) { out.push(r.c); continue; }
      if (canWrite()) { try { io.renameSync(f, `${f}.damaged-${stamp(nowFn())}`); } catch { /* leave it */ } }
      const bakText = readText(f + '.bak'), b = bakText === null ? null : parseCompilation(bakText);
      if (b?.ok) { out.push(b.c); problems.push(`${n} was damaged (${r.detail}); the previous copy was used.`); if (canWrite()) { try { writeAtomic(f, bakText!); } catch { /* the copy is still used from memory */ } } } // put the good copy back, or the next start would not find it
      else problems.push(`${n} was damaged (${r.detail}) and was set aside. The long video is not listed; the damaged file was kept.`);
    }
    notice = problems.join(' ');
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  /** write one long video; the file on disk becomes <id>.json.bak first. A read-only studio does nothing. */
  function save(c: Compilation) {
    if (!canWrite()) return;
    try {
      const f = file(c.id), old = readText(f);
      if (old !== null && parseCompilation(old).ok) writeAtomic(f + '.bak', old);
      writeAtomic(f, JSON.stringify({ schemaVersion: COMPILE_SCHEMA, savedAt: nowFn().toISOString(), compilation: c }, null, 1) + '\n');
    } catch (e) { console.warn('long videos: could not save:', e instanceof Error ? e.message : e); } // a full disk must never crash the studio
  }
  /** take a long video out of the list: the file moves to removed/ (never deleted) */
  function remove(id: string) {
    if (!canWrite() || !/^c-[\w.-]+$/.test(id)) return;
    try { io.mkdirSync(path.join(dir, 'removed'), { recursive: true }); io.renameSync(file(id), path.join(dir, 'removed', `${id}-${stamp(nowFn())}.json`)); } catch { /* already gone */ }
  }
  return { dir, load, save, remove, notice: () => notice };
}
export type CompileStore = ReturnType<typeof openCompileStore>;
