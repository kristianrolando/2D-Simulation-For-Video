// Pure helpers of the batch runner (tools/batch-run.ts), kept apart so they can be tested without a studio.
// A stopped or failed render can be run again ("Render again" in the studio, or by this runner): the studio then links the old job
// to the new one (`retriedBy`). The batch must follow that link, or a render the owner already restarted would be counted as failed
// and sent a second time (two identical videos).
export interface JobLite { id: string; status: string; retriedBy?: string; started?: number; finished?: number; size?: number; error?: string; note?: string }
export interface BatchEntry { jobId: string; status: string; sentAt: number; doneAt?: number; secs?: number; sizeMB?: number; error?: string }

/** the newest job in the "run again" chain that starts at `id` (itself when it was never run again); undefined if `id` is unknown */
export function headOf(jobs: JobLite[], id: string): JobLite | undefined {
  const byId = new Map(jobs.map(j => [j.id, j]));
  let cur = byId.get(id); if (!cur) return undefined;
  for (let hop = 0; hop < 50 && cur.retriedBy; hop++) { const next = byId.get(cur.retriedBy); if (!next) break; cur = next; }
  return cur;
}

/** bring the saved batch state in line with what the studio knows: an entry follows its chain to the newest job and takes its status.
 *  Returns how many entries changed. Entries whose job the studio no longer lists are left alone. */
export function reconcile(state: Record<string, BatchEntry>, jobs: JobLite[]): number {
  let changed = 0;
  for (const e of Object.values(state)) {
    if (e.status === 'done') continue;
    const h = headOf(jobs, e.jobId); if (!h) continue;
    if (h.id === e.jobId && h.status === e.status) continue;
    e.jobId = h.id; e.status = h.status; changed++;
    if (h.status === 'done') {
      e.doneAt = h.finished ?? Date.now(); delete e.error;
      if (h.started && h.finished) e.secs = Math.round((h.finished - h.started) / 1000);
      if (h.size) e.sizeMB = +(h.size / 1e6).toFixed(1);
    }
  }
  return changed;
}

/** a live runner holds this file with its pid; a second runner on the same plan would send every video twice */
export const lockHolder = (text: string | null, alive: (pid: number) => boolean): number | null => {
  if (!text) return null; const pid = Number(text.trim()); return Number.isInteger(pid) && pid > 1 && alive(pid) ? pid : null;
};
