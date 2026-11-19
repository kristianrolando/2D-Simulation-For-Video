// Where does the work stand, right now? Read-only: git, the running studio, the render list, the batch, the disk, the handoff file.
//   node tools/state.ts [--json] [--url http://127.0.0.1:5180]
// Records (HANDOFF.md, notes) can go stale; this asks the real things. It changes nothing and starts nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_BASE = opt('--url', 'http://127.0.0.1:5180'), AS_JSON = args.includes('--json');
const sh = (cmd: string, a: string[]) => { try { return execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return null; } };
const count = (xs: { status?: string }[]) => xs.reduce<Record<string, number>>((m, x) => { const k = x.status ?? '?'; m[k] = (m[k] ?? 0) + 1; return m; }, {});

const git = { branch: sh('git', ['branch', '--show-current']), head: sh('git', ['log', '-1', '--format=%h %s']), changedFiles: sh('git', ['status', '--porcelain']).split('\n').filter(Boolean).length };
let studio: Record<string, unknown> = { running: false };
try {
  const r = await fetch(`${URL_BASE}/api/status`, { signal: AbortSignal.timeout(2000) });
  const s: any = await r.json();
  if (s?.app === 'sim-studio') studio = { running: true, pid: s.pid, uptimeSec: s.uptimeSec, state: s.state, queued: s.queued, errors: s.errors, readOnly: s.readOnly, codeStale: s.codeStale, ...(s.problems ? { problems: s.problems } : {}) };
} catch { /* not running */ }
const jobsFile = readJson('data/jobs.json'), jobs = { saved: Array.isArray(jobsFile?.jobs), byStatus: count(jobsFile?.jobs ?? []) };
const batchState = readJson('data/batch/state.json'), batch = batchState ? { planned: readJson('data/batch/plan.json')?.items?.length ?? null, byStatus: count(Object.values(batchState) as { status?: string }[]) } : null;
let freeGB: number | null = null; try { const s = fs.statfsSync(ROOT); freeGB = +((s.bavail * s.bsize) / 2 ** 30).toFixed(1); } catch { /* unknown */ }
const handoff = (() => { try { const t = fs.readFileSync(path.join(ROOT, 'HANDOFF.md'), 'utf8'); return { updatedAt: /^- updated_at: (.+)$/m.exec(t)?.[1] ?? null, taskStatus: /^- task_status: (.+)$/m.exec(t)?.[1] ?? null, writer: /^- writer: (.+)$/m.exec(t)?.[1] ?? null }; } catch { return null; } })();
const state = { checkedAt: new Date().toISOString(), git, studio, jobs, batch, freeGB, handoff };

if (AS_JSON) console.log(JSON.stringify(state, null, 1));
else {
  console.log(`git      ${git.branch || '(no branch)'} · ${git.head || '?'} · ${git.changedFiles ? `${git.changedFiles} changed file(s) not committed` : 'clean'}`);
  console.log(studio.running ? `studio   running · pid ${studio.pid} · up ${Math.round(Number(studio.uptimeSec) / 60)} min · ${studio.state} · queued ${studio.queued} · ${studio.codeStale ? 'OLD CODE (restart it when no render or upload is running)' : 'code is current'}${studio.readOnly ? ' · READ-ONLY' : ''}` : 'studio   not running');
  if (Array.isArray(studio.problems)) for (const p of studio.problems) console.log(`         ! ${p}`);
  console.log(`renders  ${JSON.stringify(jobs.byStatus)}`);
  if (batch) console.log(`batch    ${JSON.stringify(batch.byStatus)} of ${batch.planned ?? '?'} planned`);
  console.log(`disk     ${freeGB === null ? '?' : `${freeGB} GB free`}`);
  console.log(`handoff  ${handoff ? `${handoff.taskStatus} · writer ${handoff.writer} · updated ${handoff.updatedAt}` : 'HANDOFF.md not found'}`);
}
