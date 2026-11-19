// The hourly sweep of leftovers a crash can leave behind (the start-up recovery in server.ts handles what jobs.json knows about).
// Only the studio's own temporary files, only when nothing running owns them and they are old enough: a half-finished atomic write
// (*.tmp), the audio a killed render never deleted (<job>.wav), a request file no worker will read.
import fs from 'node:fs';
import path from 'node:path';

export interface SweepOpts {
  outDir: string; dataDir: string;
  /** base names (no extension) of the queued or running jobs: their request and audio files are in use */
  activeBases: Set<string>;
  nowMs?: number; maxAgeMs?: number;
}
export const SWEEP_AGE_MS = 60 * 60e3;

const list = (dir: string) => { try { return fs.readdirSync(dir).map(f => path.join(dir, f)); } catch { return []; } };
const age = (f: string, now: number) => { try { return now - fs.statSync(f).mtimeMs; } catch { return -1; } };

export function sweepList(o: SweepOpts): string[] {
  const now = o.nowMs ?? Date.now(), max = o.maxAgeMs ?? SWEEP_AGE_MS, out: string[] = [];
  const old = (f: string) => age(f, now) >= max;
  for (const f of list(o.outDir)) {
    const n = path.basename(f);
    if (n.endsWith('.request.json')) { if (!o.activeBases.has(n.replace(/\.request\.json$/, '')) && age(f, now) >= Math.min(max, 10 * 60e3)) out.push(f); }
    else if (n.endsWith('.wav')) { if (!o.activeBases.has(n.replace(/\.wav$/, '')) && old(f)) out.push(f); }
    else if (n.endsWith('.tmp') && old(f)) out.push(f);
  }
  for (const d of [o.dataDir, path.join(o.dataDir, 'thumbnails'), path.join(o.dataDir, 'backups')])
    for (const f of list(d)) if (/\.tmp(\.png)?$/.test(f) && old(f)) out.push(f);
  return out;
}
export function sweep(o: SweepOpts, remove: (f: string) => void = f => fs.rmSync(f, { force: true })): string[] {
  const gone: string[] = [];
  for (const f of sweepList(o)) { try { remove(f); gone.push(f); } catch { /* in use or already gone */ } }
  return gone;
}
