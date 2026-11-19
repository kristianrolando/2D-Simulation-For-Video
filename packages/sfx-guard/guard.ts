// ElevenLabs credit guard: the single door for every paid call in this project.
//
//   runGeneration()  is the ONLY function that calls client.generateSound (checked by tests/sfx-guard.test.ts).
//
// Rules (docs/sfx-credits.md):
//  1. Default is a dry run: list, estimate, account balance. Nothing paid without `approved: true` (CLI: --yes).
//  2. Before any paid call: balance known and enough; estimate within the per-run and per-24h caps;
//     prompt+parameters never generated before; no file for that id in assets/sfx.
//  3. Every paid call is written to the ledger (assets/sfx/ledger.json) before and after, atomically. No key in it.
//  4. No automatic retry. A failure stops the run. A call already started or done is never sent again.
//  5. Credits exhausted: stop with a plain message. Nothing is bought or changed on the account.
//  6. Per-generation caps (1 take, duration, prompt length) and a cap on calls per run.
// Limits come from ~/Library/Application Support/Sim Studio/elevenlabs-guard.json (owner's file, outside the
// project). Command-line options can only LOWER them, and every value is clamped to HARD_CEILING below.
import fs from 'node:fs';
import path from 'node:path';
import { ElevenLabsError, type Balance, type SfxClient } from './client.ts';
import { existingFiles, guardHash, legacyHash, normalizePrompt, params, readManifest, readRequests, writeJsonAtomic, type Converter, type SfxRequest } from './library.ts';
import { importSample } from './library.ts';

export interface Limits {
  maxCallsPerRun: number;        // paid calls one command may make
  maxCreditsPerRun: number;      // estimated credits one command may spend
  maxCreditsPer24h: number;      // estimated + recorded spend over the last 24 h (from the ledger)
  maxDurationSec: number;        // per generation
  maxPromptChars: number;        // per generation
  creditsPerSecond: number;      // estimate rate (conservative; actual use is recorded next to it)
  maxOverrunFactor: number;      // stop if one call cost more than estimate × this
}
export const DEFAULT_LIMITS: Limits = { maxCallsPerRun: 3, maxCreditsPerRun: 150, maxCreditsPer24h: 300, maxDurationSec: 3, maxPromptChars: 300, creditsPerSecond: 40, maxOverrunFactor: 1.5 };
/** absolute ceiling: no config file or option can go above these */
export const HARD_CEILING: Limits = { maxCallsPerRun: 20, maxCreditsPerRun: 2000, maxCreditsPer24h: 5000, maxDurationSec: 10, maxPromptChars: 450, creditsPerSecond: 1000, maxOverrunFactor: 3 };
const MIN_CREDITS_PER_SECOND = 1;

export function loadLimits(configFile: string | null, lower: Partial<Limits> = {}): { limits: Limits; source: string; notes: string[] } {
  const notes: string[] = [];
  let fromFile: Partial<Limits> = {}, source = 'built-in defaults';
  if (configFile && fs.existsSync(configFile)) {
    try { fromFile = JSON.parse(fs.readFileSync(configFile, 'utf8')); source = configFile; }
    catch { notes.push(`${configFile} is not valid JSON; using built-in defaults`); }
  }
  const limits = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    const v = Number(fromFile[k]);
    if (fromFile[k] !== undefined && Number.isFinite(v) && v > 0) limits[k] = v;
    if (limits[k] > HARD_CEILING[k]) { notes.push(`${k} ${limits[k]} is above the hard ceiling; using ${HARD_CEILING[k]}`); limits[k] = HARD_CEILING[k]; }
  }
  limits.creditsPerSecond = Math.max(MIN_CREDITS_PER_SECOND, limits.creditsPerSecond);
  for (const k of Object.keys(lower) as (keyof Limits)[]) {
    const v = Number(lower[k]);
    if (!Number.isFinite(v) || v <= 0 || k === 'creditsPerSecond') continue; // the estimate rate is not an option
    if (v > limits[k]) notes.push(`option ${k}=${v} ignored: options can only lower a limit (current ${limits[k]})`);
    else limits[k] = v;
  }
  return { limits, source, notes };
}

// ---------- ledger ----------
export type LedgerStatus = 'started' | 'ok' | 'failed';
export interface LedgerEntry {
  seq: number; at: string; finishedAt?: string; id: string; guardHash: string; model: string; duration: number;
  estimate: number; actual: number | null; status: LedgerStatus; error?: string; imported?: boolean; file?: string;
}
export interface Ledger { version: 1; note: string; entries: LedgerEntry[] }
const LEDGER_NOTE = 'ElevenLabs paid calls (written by packages/sfx-guard/guard.ts). Hashes only, no prompts text, no keys. Never edit by hand except to mark a "started" entry as "failed" after checking the account.';
export const readLedger = (file: string): Ledger => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, note: LEDGER_NOTE, entries: [] };

const SECRET_PATTERNS = [/sk_[A-Za-z0-9]{16,}/g, /xi-api-key\s*[:=]\s*\S+/gi];
export function scrub(text: string, secrets: string[]) {
  let s = String(text);
  for (const k of secrets) if (k && k.length >= 6) s = s.split(k).join('[redacted]');
  for (const p of SECRET_PATTERNS) s = s.replace(p, '[redacted]');
  return s.slice(0, 300);
}

export function spentLast24h(ledger: Ledger, now: Date) {
  const since = now.getTime() - 24 * 3600e3;
  let sum = 0;
  for (const e of ledger.entries) {
    if (Date.parse(e.at) < since) continue;
    if (e.status === 'started') sum += e.estimate;                 // unknown outcome: assume it was charged
    else if (e.status === 'ok') sum += e.actual ?? e.estimate;
    else sum += e.actual ?? 0;
  }
  return Math.round(sum * 100) / 100;
}

// ---------- plan ----------
export interface PlannedItem { id: string; role: string; prompt: string; duration: number; guardHash: string; estimate: number; request: SfxRequest }
export interface PlanResult {
  todo: PlannedItem[]; skipped: { id: string; reason: string }[]; problems: string[];
  estimate: number; spent24h: number; limits: Limits;
}
export interface PlanInput { dir: string; ledgerFile: string; limits: Limits; only?: string[]; again?: string[]; now?: Date }

export function estimateCredits(duration: number, limits: Limits) { return Math.ceil(duration * limits.creditsPerSecond); }

export function planGeneration(inp: PlanInput): PlanResult {
  const { dir, limits } = inp, now = inp.now ?? new Date();
  const reqs = readRequests(dir), man = readManifest(dir), ledger = readLedger(inp.ledgerFile);
  const todo: PlannedItem[] = [], skipped: PlanResult['skipped'] = [], problems: string[] = [];
  const manLegacy = new Set(man.samples.map(s => s.promptHash)), manGuard = new Set(man.samples.map(s => s.guardHash).filter(Boolean));
  const manIds = new Set(man.samples.map(s => s.id)), manPrompts = new Map(man.samples.map(s => [normalizePrompt(s.prompt), s.id]));
  const seen = new Set<string>();
  if (inp.only) for (const id of inp.only) if (!reqs.requests.some(r => r.id === id)) problems.push(`--only ${id}: no request with that id in requests.json`);
  for (const r of reqs.requests) {
    if (inp.only && !inp.only.includes(r.id)) continue;
    const gh = guardHash(reqs, r), lh = legacyHash(reqs.model, r);
    const last = [...ledger.entries].reverse().find(e => e.guardHash === gh || e.id === r.id);
    const files = existingFiles(dir, r.id);
    if (manIds.has(r.id)) { skipped.push({ id: r.id, reason: 'already in the library (same id)' }); continue; }
    if (manLegacy.has(lh) || manGuard.has(gh)) { skipped.push({ id: r.id, reason: 'already in the library (same prompt hash)' }); continue; }
    if (manPrompts.has(normalizePrompt(r.prompt))) { skipped.push({ id: r.id, reason: `same prompt already in the library as ${manPrompts.get(normalizePrompt(r.prompt))}` }); continue; }
    if (files.length) { skipped.push({ id: r.id, reason: `file already exists in assets/sfx: ${files.join(', ')} (import it instead of generating)` }); continue; }
    if (seen.has(gh)) { skipped.push({ id: r.id, reason: 'duplicate of another request in this list' }); continue; }
    if (last?.status === 'ok') { skipped.push({ id: r.id, reason: `already generated on ${last.at} (ledger #${last.seq}); not generated again` }); continue; }
    if (last?.status === 'started') { problems.push(`${r.id}: an earlier paid call (ledger #${last.seq}, ${last.at}) never finished. Credits may be spent. Check the account, then mark that entry "failed" in the ledger to allow a new attempt.`); continue; }
    if (last?.status === 'failed' && !inp.again?.includes(r.id)) { skipped.push({ id: r.id, reason: `failed on ${last.at} (${last.error ?? 'error'}); repeat only with --again ${r.id}` }); continue; }
    if (!(r.duration >= 0.5)) problems.push(`${r.id}: duration ${r.duration} s; must be set and at least 0.5 s`);
    if (r.duration > limits.maxDurationSec) problems.push(`${r.id}: duration ${r.duration} s is above the per-generation cap of ${limits.maxDurationSec} s`);
    if (!r.prompt?.trim() || r.prompt.length > limits.maxPromptChars) problems.push(`${r.id}: prompt must be 1–${limits.maxPromptChars} characters`);
    seen.add(gh);
    todo.push({ id: r.id, role: r.role, prompt: r.prompt, duration: r.duration, guardHash: gh, estimate: estimateCredits(r.duration, limits), request: r });
  }
  const estimate = todo.reduce((a, t) => a + t.estimate, 0), spent24h = spentLast24h(ledger, now);
  if (todo.length > limits.maxCallsPerRun) problems.push(`${todo.length} generations requested; the cap is ${limits.maxCallsPerRun} per run (choose some with --only)`);
  if (estimate > limits.maxCreditsPerRun) problems.push(`estimate ${estimate} credits is above the per-run cap of ${limits.maxCreditsPerRun}`);
  if (spent24h + estimate > limits.maxCreditsPer24h) problems.push(`estimate ${estimate} + ${spent24h} already spent in the last 24 h is above the 24 h cap of ${limits.maxCreditsPer24h}`);
  return { todo, skipped, problems, estimate, spent24h, limits };
}

// ---------- run ----------
export type RunStatus = 'nothing-to-do' | 'dry-run' | 'refused' | 'done' | 'failed' | 'credits-exhausted' | 'overrun';
export interface RunReport extends PlanResult {
  status: RunStatus; message: string; balance: Balance | null; balanceError?: string; calls: number;
  results: { id: string; status: 'ok' | 'failed'; estimate: number; actual: number | null; error?: string; file?: string }[];
}
export interface RunInput extends PlanInput {
  client: SfxClient | null;      // null when there is no API key: dry run still lists and estimates
  approved: boolean;             // the owner's explicit yes for THIS list (CLI --yes)
  converter?: Converter;
}

function upsert(ledgerFile: string, e: LedgerEntry) {
  const l = readLedger(ledgerFile);
  const i = l.entries.findIndex(x => x.seq === e.seq);
  if (i >= 0) l.entries[i] = e; else l.entries.push(e);
  writeJsonAtomic(ledgerFile, l);
}

export async function runGeneration(inp: RunInput): Promise<RunReport> {
  const plan = planGeneration(inp), now = () => (inp.now ?? new Date()).toISOString();
  const secrets = inp.client?.secrets() ?? [];
  const rep: RunReport = { ...plan, status: 'dry-run', message: '', balance: null, calls: 0, results: [] };
  if (inp.client) {
    try { rep.balance = await inp.client.getBalance(); }
    catch (e: any) { rep.balanceError = scrub(e?.message ?? String(e), secrets); }
  } else rep.balanceError = 'no API key configured';
  if (!plan.todo.length && !plan.problems.length) return { ...rep, status: 'nothing-to-do', message: 'Nothing to generate: every request is already in the library, generated, or skipped.' };
  if (plan.problems.length) return { ...rep, status: 'refused', message: 'Refused; nothing was generated:\n- ' + plan.problems.join('\n- ') };
  if (!inp.approved) return { ...rep, status: 'dry-run', message: `Dry run: ${plan.todo.length} generation(s), estimate ${plan.estimate} credits. Nothing was generated. To generate exactly this list, run the same command with --yes.` };
  if (!inp.client || !rep.balance) return { ...rep, status: 'refused', message: `Refused: the account balance could not be read (${rep.balanceError}). Nothing is generated without a known balance.` };
  if (rep.balance.remaining < plan.estimate) return { ...rep, status: 'refused', message: `Refused: the account has ${rep.balance.remaining} credits left, the estimate is ${plan.estimate}. Nothing was generated.` };

  const reqs = readRequests(inp.dir), conv = inp.converter;
  let before = rep.balance;
  for (const t of plan.todo) {
    const ledger = readLedger(inp.ledgerFile);
    const entry: LedgerEntry = { seq: (ledger.entries.at(-1)?.seq ?? 0) + 1, at: now(), id: t.id, guardHash: t.guardHash, model: reqs.model, duration: t.duration, estimate: t.estimate, actual: null, status: 'started' };
    upsert(inp.ledgerFile, entry); // written BEFORE the paid call: a crash leaves "started", which blocks a repeat
    rep.calls++;
    let audio: Uint8Array;
    try { audio = await inp.client.generateSound({ text: t.prompt, ...params(reqs, t.request) }); }
    catch (e: any) {
      const err = scrub(`${e?.code ? e.code + ': ' : ''}${e?.message ?? String(e)}`, secrets);
      upsert(inp.ledgerFile, { ...entry, status: 'failed', finishedAt: now(), error: err });
      rep.results.push({ id: t.id, status: 'failed', estimate: t.estimate, actual: null, error: err });
      if (e instanceof ElevenLabsError && e.quota) return { ...rep, status: 'credits-exhausted', message: `ElevenLabs credits are used up (${err}). Stopped; nothing was retried and nothing on the account was changed or bought. Wait for the monthly reset or change the plan yourself on elevenlabs.io.` };
      return { ...rep, status: 'failed', message: `Stopped after a failed call for ${t.id}: ${err}. Not retried. Remaining items were not sent. To try ${t.id} again, run with --again ${t.id}.` };
    }
    // paid for: keep the original first, then convert and register
    const srcDir = path.join(inp.dir, 'src'); fs.mkdirSync(srcDir, { recursive: true });
    const ext = '.' + (params(reqs, t.request).outputFormat.split('_')[0] || 'mp3');
    const src = path.join(srcDir, t.id + ext);
    fs.writeFileSync(src, audio, { flag: 'wx' }); // never overwrite a paid-for original
    let actual: number | null = null;
    try { const after = await inp.client.getBalance(); const d = after.used - before.used; if (d > 0) actual = Math.round(d * 100) / 100; before = after; } catch { /* counter unavailable: actual stays unknown */ }
    let imported = true, importErr: string | undefined;
    try { importSample(inp.dir, t.id, src, conv); } catch (e: any) { imported = false; importErr = scrub(e?.message ?? String(e), secrets); }
    upsert(inp.ledgerFile, { ...entry, status: 'ok', finishedAt: now(), actual, imported, file: path.relative(inp.dir, src), ...(importErr ? { error: 'import: ' + importErr } : {}) });
    rep.results.push({ id: t.id, status: 'ok', estimate: t.estimate, actual, file: path.relative(inp.dir, src), ...(importErr ? { error: 'import: ' + importErr } : {}) });
    if (actual !== null && actual > t.estimate * plan.limits.maxOverrunFactor) return { ...rep, status: 'overrun', message: `Stopped: ${t.id} cost ${actual} credits, estimate was ${t.estimate}. The estimate rate (creditsPerSecond) is too low; remaining items were not sent.` };
  }
  return { ...rep, status: 'done', message: `Generated ${rep.results.length} sound(s).` };
}
