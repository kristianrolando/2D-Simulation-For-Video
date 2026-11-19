// Long-video build worker: one build per process, like apps/server/worker.ts (isolates crashes, keeps the HTTP server responsive).
// Input: path to a request JSON file ({ compilationId, out, cacheDir, clips: [{ videoId, file, label }] }).
// Output: JSON lines on stdout ({type:'progress'|'done'|'error'}).
import fs from 'node:fs';
import { buildCompilation, type BuildRequest } from './compile-build.ts';

// If the studio that started this worker dies without stopping it (kill -9, a crash), do not keep encoding as an orphan.
const parent = process.ppid;
setInterval(() => { try { process.kill(parent, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EPERM') process.exit(75); } }, 2000).unref();

const req: BuildRequest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n');
try {
  const report = await buildCompilation(req, p => send({ type: 'progress', ...p }));
  send({ type: 'done', report });
} catch (e) {
  send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
}
