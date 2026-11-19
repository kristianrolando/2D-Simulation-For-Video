// Sound library manager (credit-safe). Rules: docs/sfx-credits.md.
//   node tools/sfx.ts plan                     -> offline: what is NOT yet in the library (no network)
//   node tools/sfx.ts generate [options]       -> DRY RUN: list, credit estimate, account balance. Nothing is paid.
//   node tools/sfx.ts generate --yes [options] -> generate exactly that list (the only paid command in the project)
//        --only a,b      limit to these request ids
//        --again a       allow ONE more attempt for an id whose last attempt failed
//        --max-credits N / --max-calls N   lower the caps for this run (can never raise them)
//   node tools/sfx.ts import <id> <file>       -> convert a file you already have and register it (no credits)
//   node tools/sfx.ts reprocess                -> re-convert from assets/sfx/src (no credits)
//   node tools/sfx.ts ledger                   -> show the record of paid calls
//   node tools/sfx.ts list                     -> what the library holds
// Every paid call goes through runGeneration() in packages/sfx-guard/guard.ts. Studio and render never call ElevenLabs.
import fs from 'node:fs';
import path from 'node:path';
import { createElevenLabsClient, loadApiKey, supportDir } from '../packages/sfx-guard/client.ts';
import { loadLimits, planGeneration, readLedger, runGeneration } from '../packages/sfx-guard/guard.ts';
import { ffmpegConverter, importSample, readManifest, writeJsonAtomic } from '../packages/sfx-guard/library.ts';

const DIR = path.resolve(import.meta.dirname, '../assets/sfx');
const LEDGER = path.join(DIR, 'ledger.json');
const CONFIG = path.join(supportDir(), 'elevenlabs-guard.json');
const argv = process.argv.slice(2), cmd = argv[0];
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const list = (n: string) => opt(n)?.split(',').map(s => s.trim()).filter(Boolean);

function limitsFromArgs() {
  const lower: Record<string, number> = {};
  if (opt('--max-credits')) lower.maxCreditsPerRun = Number(opt('--max-credits'));
  if (opt('--max-calls')) lower.maxCallsPerRun = Number(opt('--max-calls'));
  const r = loadLimits(CONFIG, lower);
  for (const n of r.notes) console.error('note:', n);
  return r;
}

if (cmd === 'plan') {
  const { limits } = limitsFromArgs();
  const p = planGeneration({ dir: DIR, ledgerFile: LEDGER, limits, only: list('--only') });
  console.log(JSON.stringify({ toGenerate: p.todo.map(t => ({ id: t.id, role: t.role, duration: t.duration, prompt: t.prompt, guardHash: t.guardHash, estimate: t.estimate })), skipped: p.skipped, problems: p.problems, estimate: p.estimate }, null, 2));
} else if (cmd === 'generate') {
  const { limits, source } = limitsFromArgs();
  const k = loadApiKey();
  if (k.warning) console.error('warning:', k.warning);
  const rep = await runGeneration({
    dir: DIR, ledgerFile: LEDGER, limits, only: list('--only'), again: list('--again'),
    client: k.key ? createElevenLabsClient(k.key) : null, approved: flag('--yes'), converter: ffmpegConverter,
  });
  console.log(`Limits (${source}): ${limits.maxCallsPerRun} calls / ${limits.maxCreditsPerRun} credits per run, ${limits.maxCreditsPer24h} per 24 h, ≤ ${limits.maxDurationSec} s each, estimate ${limits.creditsPerSecond} credits/s`);
  console.log(rep.balance ? `Account: ${rep.balance.remaining} credits left (${rep.balance.used} of ${rep.balance.limit} used${rep.balance.resetsAt ? ', resets ' + rep.balance.resetsAt.slice(0, 10) : ''})`
    : `Account balance: unknown (${rep.balanceError}${k.key ? '' : `; put {"apiKey": "..."} in ${k.where}, mode 600`})`);
  console.log(`Spent in the last 24 h (ledger): ${rep.spent24h}`);
  if (rep.todo.length) { console.log('To generate (1 take each):'); for (const t of rep.todo) console.log(`  ${t.id.padEnd(16)} ${String(t.duration).padStart(4)} s  ~${t.estimate} credits  "${t.prompt}"`); }
  console.log(`Estimate: ${rep.estimate} credits`);
  for (const s of rep.skipped) console.log(`  skip ${s.id}: ${s.reason}`);
  for (const r of rep.results) console.log(`  ${r.status} ${r.id}: estimate ${r.estimate}, actual ${r.actual ?? 'unknown'}${r.error ? ' — ' + r.error : ''}`);
  console.log(rep.message);
  process.exit(['dry-run', 'done', 'nothing-to-do'].includes(rep.status) ? 0 : 2);
} else if (cmd === 'import') {
  try { const r = importSample(DIR, argv[1], argv[2]); console.log(`imported ${r.id} -> ${r.file} (${r.duration.toFixed(2)} s)`); }
  catch (e: any) { console.error(e.message); process.exit(2); }
} else if (cmd === 'reprocess') {
  const man = readManifest(DIR);
  for (const smp of man.samples) {
    const src = fs.readdirSync(path.join(DIR, 'src')).find(f => f.startsWith(smp.id + '.'));
    if (!src) { console.log('no source for', smp.id); continue; }
    ffmpegConverter.convert(path.join(DIR, 'src', src), path.join(DIR, smp.file));
    smp.duration = +ffmpegConverter.duration(path.join(DIR, smp.file)).toFixed(3);
    console.log('reprocessed', smp.id);
  }
  writeJsonAtomic(path.join(DIR, 'manifest.json'), man);
} else if (cmd === 'ledger') {
  const l = readLedger(LEDGER);
  if (!l.entries.length) console.log('(no paid calls recorded yet)');
  for (const e of l.entries) console.log(`#${e.seq} ${e.at} ${e.status.padEnd(7)} ${e.id.padEnd(16)} ${e.guardHash} estimate ${e.estimate} actual ${e.actual ?? 'unknown'}${e.error ? ' — ' + e.error : ''}`);
} else {
  const man = readManifest(DIR);
  for (const s of man.samples) console.log(`${s.role.padEnd(8)} ${s.id.padEnd(16)} ${s.duration}s  ${s.source}  ${s.promptHash}`);
  if (!man.samples.length) console.log('(library empty — every role uses the synth fallback)');
}
