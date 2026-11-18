// Finds renders in output/ that are not in the video list yet (for example made with `npm run render`).
// A render counts when it is an MP4 in output/ itself with the .job.json that every render writes next to it.
// Duplicates are avoided by file name. Files still being written (recent change) and renders the studio is
// running or has just failed are skipped. Read-only: nothing here changes output/.
import fs from 'node:fs';
import path from 'node:path';

export interface Untracked { file: string; id: string; sceneId: string; params: Record<string, unknown>; size: number; mtimeMs: number }
export interface ScanOptions { tracked: Set<string>; ignoreIds?: Set<string>; nowMs?: number; minAgeMs?: number; knownScene?: (id: string) => boolean }

export function findUntrackedRenders(outDir: string, o: ScanOptions): Untracked[] {
  let names: string[] = [];
  try { names = fs.readdirSync(outDir); } catch { return []; }
  const now = o.nowMs ?? Date.now(), minAge = o.minAgeMs ?? 15000, out: Untracked[] = [];
  for (const f of names) {
    if (!f.endsWith('.mp4')) continue;
    const id = f.slice(0, -4);
    if (o.tracked.has(f) || o.ignoreIds?.has(id)) continue;
    try {
      const st = fs.statSync(path.join(outDir, f)); if (!st.isFile() || st.size === 0 || now - st.mtimeMs < minAge) continue;
      const rec = JSON.parse(fs.readFileSync(path.join(outDir, id + '.job.json'), 'utf8'));
      if (typeof rec?.sceneId !== 'string' || (o.knownScene && !o.knownScene(rec.sceneId))) continue;
      out.push({ file: f, id, sceneId: rec.sceneId, params: rec.params && typeof rec.params === 'object' ? rec.params : {}, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* no readable .job.json: not something we can describe, skip */ }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}
