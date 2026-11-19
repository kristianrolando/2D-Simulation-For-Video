// A short health check of the machine the studio runs on: ffmpeg, free disk, writable folders. Run at start and every hour.
// Pure when its probes are handed in (tests); the defaults look at the real machine. It never changes anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface Health { problems: string[]; freeGB: number | null }
export interface HealthProbes {
  /** can this program be run? */ has: (cmd: string) => boolean;
  /** free space (GiB) on the disk holding `dir`, null when unknown */ freeGB: (dir: string) => number | null;
  /** can the studio write into `dir`? */ writable: (dir: string) => boolean;
}
export const realProbes: HealthProbes = {
  has: cmd => { try { return spawnSync(cmd, ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0; } catch { return false; } },
  freeGB: dir => { try { const s = fs.statfsSync(dir); return (s.bavail * s.bsize) / 2 ** 30; } catch { return null; } },
  writable: dir => { try { const f = path.join(dir, `.write-test-${process.pid}`); fs.writeFileSync(f, ''); fs.rmSync(f); return true; } catch { return false; } },
};
/** each render is roughly 5–110 MB, a batch of hundreds several GB: below this the studio says so before an ffmpeg error does */
export const MIN_FREE_GB = 2;

export function checkHealth(o: { outDir: string; dataDir: string; minFreeGB?: number; probes?: Partial<HealthProbes> }): Health {
  const p = { ...realProbes, ...o.probes }, min = o.minFreeGB ?? MIN_FREE_GB, problems: string[] = [];
  for (const cmd of ['ffmpeg', 'ffprobe']) if (!p.has(cmd)) problems.push(`${cmd} was not found: renders and thumbnails cannot be made until it is installed.`);
  const free = p.freeGB(o.outDir);
  if (free !== null && free < min) problems.push(`Only ${free.toFixed(1)} GB are free on the disk: renders may fail (keep at least ${min} GB free).`);
  for (const [name, dir] of [['output', o.outDir], ['data', o.dataDir]] as const) if (!p.writable(dir)) problems.push(`The ${name} folder is not writable, so nothing can be saved there.`);
  return { problems, freeGB: free };
}
