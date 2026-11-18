// Render worker process: one job per process (isolates crashes, keeps the HTTP server responsive).
// Input: path to a job JSON file. Output: JSON lines on stdout ({type:'progress'|'done'|'error'}).
import fs from 'node:fs';
import { renderJob, type Job } from './render-job.ts';

const job: Job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n');
try {
  const report = await renderJob(job, p => send({ type: 'progress', ...p }));
  send({ type: 'done', report });
} catch (e) {
  send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
}
