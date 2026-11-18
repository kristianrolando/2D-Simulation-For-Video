// Studio server: serves the web UI (Vite middleware, hot reload), the scene catalogue, presets,
// and a render queue whose jobs run in child processes (apps/server/worker.ts).
//   npm run dev            -> http://127.0.0.1:5180
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createVite } from 'vite';
import { validate } from '../../packages/core/index.ts';
import { SCENES, sceneById } from '../../packages/scenes/index.ts';
import { thumbKey, THUMBS } from './thumbs.ts';
import { readThemeFiles } from '../../packages/theme/node.ts';
import { registerThemes, resolveTheme, themeIds, unregisterTheme } from '../../packages/theme/index.ts';
import { checkCustomFile, validId } from '../../packages/theme/editor.ts';
import { saveCustomTheme, deleteCustomTheme } from '../../packages/theme/node.ts';
import { openStore, ReadOnlyError } from './store.ts';
import { findUntrackedRenders } from './scan.ts';
import { buildStatus, isLoopback, isCodeStale } from './status.ts';
import { openJobStore, isOurWorker, killGroup, processAlive, strayRequests, tempFilesOf, partialFilesOf, removeFiles, isComplete, STOPPED_NOTE, type JobRecord } from './job-store.ts';
import * as yt from './youtube.ts';
import { createUploader } from './uploader.ts';
import { uploadProblems, consentKey, fileSig, MIN_LEAD_MIN, uploadThumbName, thumbProblem, type UploadOptions, type FileFacts } from '../../packages/publish/index.ts';
import { patchVideo, type Video } from '../../packages/publish/index.ts';
import { newVideoFor, hookFor } from '../../packages/publish/describe.ts';
import { climaxSecFor, coverText } from '../../packages/publish/cover.ts';
import { makeCovers } from './cover.ts';
import { themeOf, sanitizeStylePreset, serializeStylePreset } from '../../packages/theme/index.ts';
import { readStylePresets, saveStylePreset, deleteStylePreset } from '../../packages/theme/node.ts';
import { slugify } from '../../packages/theme/editor.ts';
import { toFile } from '../../packages/theme/style-preset.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = +(process.env.PORT || 5180);
const CONCURRENCY = Math.max(1, +(process.env.JOBS || 1));
const OUT = process.env.SIM_OUT_DIR ? path.resolve(process.env.SIM_OUT_DIR) : path.join(ROOT, 'output'), PRESETS = process.env.SIM_PRESETS_DIR ? path.resolve(process.env.SIM_PRESETS_DIR) : path.join(ROOT, 'presets'); // SIM_OUT_DIR, SIM_PRESETS_DIR: tests only
const DATA = process.env.SIM_DATA_DIR ? path.resolve(process.env.SIM_DATA_DIR) : path.join(ROOT, 'data'); // video list, backups, thumbnails (never inside references/)
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PRESETS, { recursive: true });
const videos = openStore(DATA, { lock: true }); // data/.lock keeps a second studio from writing; it opens read-only instead
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopWorkers(); videos.close(); process.exit(0); });
process.on('exit', () => { stopWorkers(); videos.close(); });
const THUMB_DIR = path.join(DATA, 'thumbnails');

// ---------------- YouTube (docs/youtube-upload-plan.md) ----------------
const uploader = createUploader({ store: videos, outDir: OUT, thumbDir: THUMB_DIR, log: line => console.log(line) });
if (!videos.readOnly) uploader.recover();
let lastSync = 0;
function syncSoon(force = false) {
  if (videos.readOnly || (!force && Date.now() - lastSync < 5 * 60e3)) return;
  lastSync = Date.now();
  uploader.syncPublished().catch(e => console.log('youtube: status check skipped:', yt.redact(e instanceof Error ? e.message : e)));
}
setInterval(() => syncSoon(true), 15 * 60e3).unref();
const usedConsent = new Set<string>();
/** width/height/duration of an MP4 (ffprobe), plus size and mtime */
function probe(file: string): Promise<FileFacts> {
  if (!file || !fs.existsSync(file)) return Promise.resolve({ exists: false, width: 0, height: 0, durationSec: 0, sizeBytes: 0, mtimeMs: 0 });
  const st = fs.statSync(file);
  return new Promise(ok => {
    const c = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
    let out = ''; c.stdout.on('data', d => { out += d; });
    c.on('close', () => { try { const j = JSON.parse(out); ok({ exists: true, width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0, durationSec: Number(j.format?.duration) || 0, sizeBytes: st.size, mtimeMs: st.mtimeMs }); } catch { ok({ exists: true, width: 0, height: 0, durationSec: 0, sizeBytes: st.size, mtimeMs: st.mtimeMs }); } });
    c.on('error', () => ok({ exists: true, width: 0, height: 0, durationSec: 0, sizeBytes: st.size, mtimeMs: st.mtimeMs }));
  });
}
function uploadOptions(b: any): UploadOptions {
  const d = yt.status().defaults, o = b?.options ?? {};
  return { mode: o.mode === 'now' ? 'now' : 'schedule', at: typeof o.at === 'string' ? o.at : '', categoryId: /^\d{1,3}$/.test(String(o.categoryId ?? '')) ? String(o.categoryId) : d.categoryId,
    language: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(o.language ?? '')) ? String(o.language) : d.language,
    madeForKids: typeof o.madeForKids === 'boolean' ? o.madeForKids : d.madeForKids, synthetic: typeof o.synthetic === 'boolean' ? o.synthetic : d.synthetic, notify: typeof o.notify === 'boolean' ? o.notify : d.notify };
}
const ytPage = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><title>Sim Studio · YouTube</title><meta name="color-scheme" content="light dark"><style>body{font:16px system-ui;background:#0b1020;color:#e8ecf7;display:grid;place-items:center;height:90vh}@media (prefers-color-scheme:light){body{background:#eef1f7;color:#1a2030}}</style><body><div style="max-width:520px"><h2>${title}</h2><p>${text}</p><p style="opacity:.8">You can close this tab and go back to the studio.</p></div>`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------- jobs ----------------
interface JobRec { id: string; sceneId: string; params: Record<string, unknown>; status: 'queued' | 'running' | 'done' | 'error' | 'stopped'; progress: { frame: number; frames: number; fps: number; phase: string }; out: string; report?: unknown; error?: string; created: number; started?: number; finished?: number; size?: number; pid?: number; note?: string; retriedBy?: string }
const jobs: JobRec[] = [];
/** Studio renders from earlier sessions (output/<scene>-...-<timestamp>.mp4 + .job.json) come back as finished jobs, so "where is my video?" survives a restart. */
function loadHistory(keep = 5) {
  const stamped = /-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/;
  const found = fs.readdirSync(OUT).filter(f => f.endsWith('.mp4') && stamped.test(f.slice(0, -4)) && fs.existsSync(path.join(OUT, f.slice(0, -4) + '.job.json')))
    .map(f => ({ f, st: fs.statSync(path.join(OUT, f)) })).sort((a, b) => a.st.mtimeMs - b.st.mtimeMs).slice(-keep);
  for (const { f, st } of found) {
    try {
      const id = f.slice(0, -4), rec = JSON.parse(fs.readFileSync(path.join(OUT, id + '.job.json'), 'utf8'));
      if (!sceneById(rec.sceneId) || jobs.some(x => x.id === id)) continue;
      jobs.push({ id, sceneId: rec.sceneId, params: rec.params ?? {}, status: 'done', progress: { frame: 1, frames: 1, fps: 0, phase: 'done' }, out: path.join(OUT, f), created: st.mtimeMs, finished: st.mtimeMs, size: st.size });
    } catch { /* unreadable record: skip */ }
  }
}
const listeners = new Set<http.ServerResponse>();
const broadcast = (j: JobRec) => { const s = `data: ${JSON.stringify(publicJob(j))}\n\n`; for (const r of listeners) r.write(s); };
const publicJob = ({ pid: _pid, ...j }: JobRec) => ({ ...j, out: '/output/' + path.basename(j.out), file: path.relative(ROOT, j.out), abs: j.out });

// ---------------- the queue on disk (data/jobs.json) ----------------
const WORKER = path.join(ROOT, 'apps/server/worker.ts');
const jobStore = openJobStore(DATA, { canWrite: () => !videos.readOnly });
const toRecord = (j: JobRec): JobRecord => ({ id: j.id, sceneId: j.sceneId, params: j.params, style: String(j.params.style ?? 'classic'), status: j.status, created: j.created, started: j.started, finished: j.finished,
  out: path.basename(j.out), pid: j.pid, progress: j.progress, report: j.report, error: j.error, size: j.size, note: j.note, retriedBy: j.retriedBy });
const saveJobs = () => jobStore.save(jobs.map(toRecord));

function pump() {
  while (jobs.filter(j => j.status === 'running').length < CONCURRENCY) {
    const j = jobs.find(x => x.status === 'queued'); if (!j) return;
    j.status = 'running'; j.started = Date.now(); broadcast(j);
    const jobFile = j.out.replace(/\.mp4$/, '') + '.request.json';
    fs.writeFileSync(jobFile, JSON.stringify({ sceneId: j.sceneId, params: j.params, out: j.out }));
    // `detached` = the worker leads its own process group, so it and its ffmpeg can be stopped together (see stopWorkers / recoverJobs)
    const child = spawn(process.execPath, [WORKER, jobFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    j.pid = child.pid; saveJobs();
    let buf = '', err = '';
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line);
          if (m.type === 'progress') { const first = !j.progress.frames && m.frames > 0; j.progress = m; broadcast(j); if (first) saveJobs(); } // the frame count is what lets a restart tell a finished MP4 from a half-written one
          else if (m.type === 'done') { j.report = m.report; }
          else if (m.type === 'error') { j.error = m.message; }
        } catch { /* ignore non-JSON */ }
      }
    });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (j.status === 'stopped') return; // the studio is shutting down and has already recorded this
      fs.rmSync(jobFile, { force: true });
      j.finished = Date.now(); j.pid = undefined;
      j.status = code === 0 && !j.error ? 'done' : 'error';
      if (j.status === 'done') try { j.size = fs.statSync(j.out).size; } catch { /* file vanished */ }
      if (j.status === 'error' && !j.error) j.error = err.trim().split('\n').slice(-3).join(' | ') || `worker exited with ${code}`;
      trackJob(j); saveJobs();
      broadcast(j); pump();
    });
  }
}
let stopped = false;
/** Shutdown (SIGTERM, SIGINT, normal exit): stop every render worker with its ffmpeg, remember the jobs as Stopped, remove what a
 *  half-finished render leaves behind. Workers are killed outright: a render holds nothing worth saving, and a gentle stop would
 *  let ffmpeg close a half-written MP4 so that it looks finished. Runs once. */
function stopWorkers() {
  if (stopped || typeof jobs === 'undefined') return; stopped = true;
  const open = jobs.filter(j => j.status === 'running' || j.status === 'queued'); if (!open.length) return;
  for (const j of open) {
    const was = j.status; if (j.pid) killGroup(j.pid, 'SIGKILL');
    j.status = 'stopped'; j.note = STOPPED_NOTE; j.finished = Date.now(); j.pid = undefined;
    removeFiles(tempFilesOf(OUT, path.basename(j.out))); if (was === 'running') removeFiles(partialFilesOf(OUT, path.basename(j.out)));
    try { trackJob(j); } catch { /* the video list is safe on its own */ }
  }
  saveJobs();
}
/** At start (only the studio that holds the data lock does this): jobs left Running or Queued by a studio that stopped become Stopped,
 *  an orphan worker of ours is killed, half-finished files are removed, and a render that did finish is recognised as done. */
async function recoverJobs() {
  const recs = jobStore.load(); if (jobStore.notice()) console.warn('render list:', jobStore.notice());
  const owner = !videos.readOnly;
  for (const r of recs) {
    const { style: _style, ...rest } = r;
    const j: JobRec = { ...rest, out: path.join(OUT, r.out) };
    if (r.status === 'running' || r.status === 'queued') {
      if (!owner) continue; // another studio owns the queue and may be rendering right now: leave its jobs alone
      const was = r.status;
      if (j.pid && isOurWorker(j.pid, WORKER, j.id)) { killGroup(j.pid, 'SIGKILL'); for (let i = 0; i < 20 && processAlive(j.pid); i++) await new Promise(ok => setTimeout(ok, 100)); console.log(`render list: stopped the leftover worker of ${j.id}`); }
      j.pid = undefined; removeFiles(tempFilesOf(OUT, r.out));
      const facts = was === 'running' ? await probe(j.out) : null;
      if (facts && facts.exists && isComplete(facts.durationSec, j.progress.frames)) { // it finished just before the studio stopped
        j.status = 'done'; j.size = facts.sizeBytes; j.finished = facts.mtimeMs; j.progress = { ...j.progress, frame: j.progress.frames, phase: 'done' };
      } else {
        if (was === 'running' && !(facts?.exists && facts.durationSec > 0 && !j.progress.frames)) removeFiles(partialFilesOf(OUT, r.out)); // unreadable or too short; a readable MP4 of unknown length is kept
        j.status = 'stopped'; j.note = STOPPED_NOTE; j.finished = j.finished ?? Date.now();
      }
      trackJob(j);
    }
    jobs.push(j);
  }
  if (owner) { const n = removeFiles(strayRequests(OUT)); if (n) console.log(`render list: removed ${n} leftover request file${n === 1 ? '' : 's'}`); saveJobs(); }
}
/** a new render job from a scene and parameters (used by "Render" and "Render again") */
function enqueue(scene: NonNullable<ReturnType<typeof sceneById>>, input: Record<string, unknown>) {
  const { params, errors } = validate(scene.schema, input);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `${scene.meta.id}-${safeName(String(params.layout ?? '')) || 'render'}-${safeName(String(params.style ?? 'classic')) || 'classic'}-${stamp}`.replace(/--+/g, '-');
  const j: JobRec = { id: name, sceneId: scene.meta.id, params, status: 'queued', progress: { frame: 0, frames: 0, fps: 0, phase: 'queued' }, out: path.join(OUT, name + '.mp4'), created: Date.now() };
  jobs.push(j); trackJobStart(j); saveJobs(); broadcast(j); pump();
  return { j, errors };
}

// ---------------- video tracking (the render engine is untouched; this only records what the studio renders) ----------------
/** keep tracking failures away from rendering: a full disk or a damaged list must never fail a render */
const safely = (what: string, fn: () => void) => { try { fn(); } catch (e) { console.warn(`video list: could not ${what}:`, e instanceof Error ? e.message : e); } };
function trackJobStart(j: JobRec) {
  safely('add the new render', () => videos.mutate(vs => { const v = newVideoFor(j.sceneId, j.params, { jobId: j.id }, new Date(), videos.settings().suggestLang); return { videos: v ? [...vs, v] : vs, result: null }; }));
}
/** pick the best frame and draw the cover and thumbnail for one video. `t` set = that frame; unset = chosen automatically. Throws a readable error. */
async function buildCover(id: string, o: { t?: number; text?: string; noText?: boolean } = {}): Promise<Video> {
  const v = videos.get(id); if (!v) throw new Error('This video is no longer in the list.');
  const mp4 = path.join(OUT, v.file);
  if (!v.file || !fs.existsSync(mp4)) throw new Error('The MP4 is not in output/ any more, so a frame cannot be taken.');
  const text = o.noText ? '' : coverText(o.text ?? v.coverText, v.title, hookFor(v.sceneId, v.params));
  const r = await makeCovers({ mp4, id, outDir: THUMB_DIR, theme: themeOf({ ...v.params, style: v.style }), text, t: o.t, durationSec: v.durationSec || 30, climaxSec: climaxSecFor(v.sceneId, v.params) });
  return videos.mutate(vs => { const i = vs.findIndex(x => x.id === id); if (i < 0) throw new Error('This video is no longer in the list.'); vs[i] = patchVideo(vs[i], { thumbSec: r.t, thumbFile: r.thumbFile, coverFile: r.coverFile, ...(o.text !== undefined ? { coverText: o.text } : {}) }); return { videos: vs, result: vs[i] }; });
}
/** after a render: make the cover once, only when the owner has not chosen a thumbnail yet; failure is just logged */
async function autoCover(id: string) {
  try { const v = videos.get(id); if (!v || v.thumbFile || videos.readOnly) return; await buildCover(id); }
  catch (e) { console.warn('cover: automatic thumbnail skipped:', e instanceof Error ? e.message : e); }
}
function trackJob(j: JobRec) {
  safely('update the render entry', () => videos.mutate(vs => {
    const i = vs.findIndex(v => v.jobId === j.id); if (i < 0) return { videos: vs, result: null };
    if (j.status === 'done') {
      const dur = (j.report as { frames?: number } | undefined)?.frames ? (j.report as { frames: number }).frames / 60 : vs[i].durationSec;
      vs[i] = patchVideo({ ...vs[i], file: path.basename(j.out), sizeBytes: j.size ?? 0, durationSec: dur }, { status: 'rendered' });
      const vid = vs[i].id; setTimeout(() => { void autoCover(vid); }, 50); // best frame + hook text, in the background; never affects the render
      return { videos: vs, result: null };
    }
    // a failed render leaves nothing worth keeping unless the user already edited the entry
    return { videos: vs[i].updatedAt === vs[i].createdAt ? vs.filter((_, k) => k !== i) : vs, result: null };
  }));
}
/** renders in output/ that are not in the list: CLI renders and anything made before tracking existed */
function untrackedRenders() {
  return findUntrackedRenders(OUT, { tracked: new Set(videos.list().map(v => v.file)), ignoreIds: new Set(jobs.filter(j => j.status !== 'done').map(j => j.id)), knownScene: id => !!sceneById(id) });
}
const videoView = (v: Video) => ({ ...v, thumbProblem: thumbProblem(v), fileExists: !!v.file && fs.existsSync(path.join(OUT, v.file)), thumbUrl: v.thumbFile ? `/data/thumbnails/${v.thumbFile}?v=${Date.parse(v.updatedAt) || 0}` : '', coverUrl: v.coverFile ? `/data/thumbnails/${v.coverFile}?v=${Date.parse(v.updatedAt) || 0}` : '' });
function extractFrame(mp4: string, t: number, out: string): Promise<void> {
  return new Promise((ok, bad) => {
    const tmp = out.replace(/\.png$/, '.tmp.png');
    const c = spawn('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; c.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => c.kill('SIGKILL'), 30000);
    c.on('error', e => { clearTimeout(timer); bad(e); });
    c.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, out); ok(); }
      else { fs.rmSync(tmp, { force: true }); bad(new Error('ffmpeg failed: ' + (err.trim().split('\n').slice(-2).join(' | ') || `exit ${code}`))); }
    });
  });
}

// thumbnails are generated once, in a child process, and cached on disk
let thumbing = false;
function ensureThumbs() {
  if (thumbing) return; thumbing = true;
  const c = spawn(process.execPath, [path.join(ROOT, 'apps/server/thumbs.ts')], { cwd: ROOT, stdio: 'ignore' });
  c.on('close', () => { thumbing = false; });
}

// per-style thumbnails for the style picker: one child process per scene configuration, deduplicated
const styleThumbing = new Set<string>();
function ensureStyleThumbs(sceneId: string, params: Record<string, unknown>) {
  const k = JSON.stringify([sceneId, params]); if (styleThumbing.has(k)) return; styleThumbing.add(k);
  const c = spawn(process.execPath, [path.join(ROOT, 'apps/server/thumbs.ts'), '--styles', sceneId, JSON.stringify(params)], { cwd: ROOT, stdio: 'ignore' });
  c.on('close', () => styleThumbing.delete(k));
}
/** themes are re-read on every request: dropping a new file into /themes shows up without a restart */
function themeList() {
  const { list, errors } = readThemeFiles();
  const warnings = registerThemes(list);
  const out = themeIds().map(id => {
    const raw = id === 'classic' ? { id } : list.find((t: any) => t?.id === id);
    const t = resolveTheme(raw).theme;
    return { id, name: t.name, icon: t.icon, concept: t.concept, bestFor: t.bestFor, swatch: [t.color.bg[0], ...t.palettes.cyclic.slice(0, 4), t.color.accent], raw, warnings: warnings[id] ?? [] };
  });
  return { themes: out, errors };
}

/** shipped scene presets (presets/*.json); unreadable files and files that do not name a known scene are left out */
function scenePresets(): { name: string; j: { sceneId: string; params?: Record<string, unknown> } }[] {
  const out: { name: string; j: { sceneId: string; params?: Record<string, unknown> } }[] = [];
  for (const f of fs.readdirSync(PRESETS).filter(f => f.endsWith('.json')).sort()) {
    try { const j = JSON.parse(fs.readFileSync(path.join(PRESETS, f), 'utf8')); if (j && typeof j.sceneId === 'string' && sceneById(j.sceneId)) out.push({ name: f.slice(0, -5), j }); }
    catch (e) { console.warn(`[presets] ${f}: ignored (${e instanceof Error ? e.message : e})`); }
  }
  return out;
}
/** style presets for the studio: the value is exactly what the scene parameter `stylePreset` stores; problems = files that were ignored, with the reason */
function stylePresetList() {
  const { presets, problems } = readStylePresets();
  return { presets: presets.map(f => ({ id: f.id, name: f.name, basedOn: f.basedOn, value: serializeStylePreset(f), swatch: [f.background.bg[0], ...f.look.palette.slice(0, 3), f.look.accent] })), problems };
}

// ---------------- http helpers ----------------
const json = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req: http.IncomingMessage) => new Promise<any>((ok, bad) => { let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) bad(new Error('body too large')); }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } }); });
const TYPES: Record<string, string> = { '.wav': 'audio/wav', '.mp4': 'video/mp4', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg' };
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const size = fs.statSync(file).size, type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) { // <video> needs byte ranges to seek
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else { res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }); fs.createReadStream(file).pipe(res); }
}
const safeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** newest modification time of the server-side code (apps/server and packages/publish), looked up at most every 10 s */
const SERVER_STARTED = Date.now();
let staleAt = 0, staleVal = false;
function codeStale(): boolean {
  if (Date.now() - staleAt < 10_000) return staleVal;
  staleAt = Date.now();
  let newest = 0;
  const walk = (dir: string) => { try { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const q = path.join(dir, f.name); if (f.isDirectory()) walk(q); else if (f.name.endsWith('.ts')) newest = Math.max(newest, fs.statSync(q).mtimeMs); } } catch { /* unreadable: ignore */ } };
  walk(path.join(ROOT, 'apps/server')); walk(path.join(ROOT, 'packages/publish'));
  return (staleVal = isCodeStale(newest, SERVER_STARTED));
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  if (p === '/api/status' && req.method === 'GET') { // light status for the macOS menu bar app (localhost only, no parameters or paths)
    if (!isLoopback(req.socket.remoteAddress)) { json(res, 403, { error: 'localhost only' }); return true; }
    json(res, 200, buildStatus(jobs, { nowMs: Date.now(), readOnly: videos.readOnly, pid: process.pid, uptimeSec: process.uptime(), codeStale: codeStale() })); return true;
  }
  if (p === '/api/youtube' && req.method === 'GET') { json(res, 200, { ...yt.status(), live: uploader.live(), resetAt: yt.quotaResetLocal(), minLeadMin: MIN_LEAD_MIN }); return true; }
  if (p === '/api/youtube/client' && req.method === 'POST') {
    const b = await readBody(req);
    if (b.fromDownloads) { const r = yt.importClientFromDownloads(); json(res, 200, { ...yt.status(), imported: r.file, deleted: true }); }
    else json(res, 200, yt.saveClient(String(b.text ?? '')));
    return true;
  }
  if (p === '/api/youtube/connect' && req.method === 'POST') { json(res, 200, { url: yt.loginUrl(`http://127.0.0.1:${PORT}/oauth/youtube`) }); return true; }
  if (p === '/api/youtube/disconnect' && req.method === 'POST') { json(res, 200, await yt.disconnect()); return true; }
  if (p === '/api/youtube/defaults' && req.method === 'PUT') { json(res, 200, yt.setDefaults(await readBody(req))); return true; }
  if (p === '/api/youtube/sync' && req.method === 'POST') { const n = await uploader.syncPublished(); lastSync = Date.now(); json(res, 200, { published: n }); return true; }
  const ym = /^\/api\/videos\/([\w-]+)\/youtube\/(check|upload|resume|skip-thumbnail|rethumb)$/.exec(p);
  if (ym && req.method === 'POST') {
    const v = videos.get(ym[1]); if (!v) { json(res, 404, { error: 'This video is no longer in the list. Reload the page.' }); return true; }
    if (videos.readOnly) throw new ReadOnlyError(videos.readOnlyReason);
    const b = await readBody(req);
    if (ym[2] === 'resume') { uploader.resume(v); json(res, 200, { ok: true }); return true; }
    if (ym[2] === 'rethumb') { // explicit approval only: it uses 50 quota units and changes the channel
      if (b.agree !== true) { json(res, 409, { error: 'Tick the approval box first. Nothing was changed on YouTube.' }); return true; }
      try { await uploader.replaceThumbnail(v); } catch (e) { json(res, e instanceof yt.YtError ? 502 : 400, { error: yt.redact(e instanceof Error ? e.message : String(e)) }); return true; }
      json(res, 200, { ok: true, video: videoView(videos.get(v.id)!) }); return true;
    }
    if (ym[2] === 'skip-thumbnail') { uploader.skipThumbnail(v); json(res, 200, { ok: true }); return true; }
    const ch = yt.channel(), f = await probe(path.join(OUT, v.file)), o = uploadOptions(b);
    const problems = uploadProblems(v, f, o);
    if (!ch) problems.unshift('YouTube is not connected. Open YouTube settings and connect a channel.');
    if (uploader.busy()) problems.push('Another upload is running. Wait until it has finished.');
    if (ym[2] === 'check') {
      json(res, 200, { problems, consent: problems.length ? '' : consentKey(v, f, o, ch!.id), channel: ch ? { name: ch.name, handle: ch.handle } : null,
        file: { width: f.width, height: f.height, durationSec: Math.round(f.durationSec * 10) / 10, sizeBytes: f.sizeBytes }, options: o,
        publishAtLocal: o.mode === 'schedule' && o.at ? new Date(o.at).toString() : '', thumbnail: !!uploadThumbName(v), quota: yt.status().quota, resetAt: yt.quotaResetLocal() });
      return true;
    }
    // upload: the owner's tick + the exact consent key shown in the dialog, used once
    if (problems.length) { json(res, 400, { error: problems[0], problems }); return true; }
    const key = consentKey(v, f, o, ch!.id);
    if (b.agree !== true || b.consent !== key) { json(res, 409, { error: 'The approval does not match what is being uploaded (something changed, or the box was not ticked). Open the dialog again.' }); return true; }
    if (usedConsent.has(key)) { json(res, 409, { error: 'This approval was already used. The studio never uploads the same video twice.' }); return true; }
    usedConsent.add(key);
    await uploader.start(v, f, o);
    if (o.mode === 'schedule') yt.setDefaults({ lastTime: o.at.slice(11, 16) });
    json(res, 200, { ok: true, video: videoView(videos.get(v.id)!) }); return true;
  }
  if (p === '/api/scenes' && req.method === 'GET') { json(res, 200, SCENES.map(s => ({ meta: s.meta, schema: s.schema }))); return true; }
  // Scene presets (presets/*.json, shipped with the studio) are read-only here. A file that cannot be read or does not name a scene is skipped, never fatal.
  if (p === '/api/presets' && req.method === 'GET') { json(res, 200, scenePresets().map(({ name, j }) => ({ name, ...j }))); return true; }
  if (p === '/api/gallery' && req.method === 'GET') {
    const items = SCENES.map(s => ({ kind: 'scene', name: s.meta.name, sceneId: s.meta.id, params: {} as Record<string, unknown> }));
    for (const { name, j } of scenePresets()) {
      const sc = sceneById(j.sceneId); if (!sc) continue;
      // a preset identical to the scene's defaults would only duplicate the scene card
      if (JSON.stringify(validate(sc.schema, j.params ?? {}).params) === JSON.stringify(validate(sc.schema, {}).params)) continue;
      items.push({ kind: 'preset', name, sceneId: j.sceneId, params: j.params ?? {} });
    }
    let missing = 0;
    const out = items.map(it => { const key = thumbKey(it.sceneId, it.params)!; const ready = fs.existsSync(path.join(THUMBS, key + '.png')); if (!ready) missing++; return { ...it, family: sceneById(it.sceneId)!.meta.family, thumb: `/thumbs/${key}.png`, ready }; });
    if (missing) ensureThumbs();
    json(res, 200, out); return true;
  }
  // Style presets (style-presets/<id>.json): a background + colour/font look that can be laid over any style in any scene.
  if (p === '/api/style-presets' && req.method === 'GET') { json(res, 200, stylePresetList()); return true; }
  if (p === '/api/style-presets' && req.method === 'POST') {
    const b = await readBody(req), name = String(b.name ?? '').trim();
    if (!name || name.length > 40) { json(res, 400, { error: 'Give the style preset a name of 1 to 40 characters.' }); return true; }
    const id = slugify(name), { preset, warnings } = sanitizeStylePreset({ ...(b.preset ?? {}), id, name });
    if (!preset) { json(res, 400, { error: warnings[0]?.replace(/^style preset: /, '') ?? 'The look could not be read.' }); return true; }
    try { saveStylePreset(toFile(preset, String(b.basedOn ?? 'classic')), undefined, b.overwrite === true); }
    catch (e) { json(res, 409, { error: e instanceof Error ? e.message : String(e), id }); return true; }
    json(res, 200, { id, ...stylePresetList() }); return true;
  }
  const sp = /^\/api\/style-presets\/([\w-]+)$/.exec(p);
  if (sp && req.method === 'DELETE') {
    try { deleteStylePreset(sp[1]); } catch (e) { json(res, 409, { error: e instanceof Error ? e.message : String(e) }); return true; }
    json(res, 200, stylePresetList()); return true;
  }
  if (p === '/api/themes' && req.method === 'GET') { json(res, 200, themeList()); return true; }
  // styles made in the style editor: themes/<id>.json with "custom": true. Shipped styles are never overwritten or deleted.
  if (p === '/api/themes' && req.method === 'POST') {
    const b = await readBody(req), c = checkCustomFile(b.theme);
    if (!c.ok) { json(res, 400, { error: c.error }); return true; }
    try { saveCustomTheme(c.raw); } catch (e) { json(res, 409, { error: e instanceof Error ? e.message : String(e) }); return true; }
    registerThemes([c.raw]); json(res, 200, { id: c.raw.id, ...themeList() }); return true;
  }
  const tm = /^\/api\/themes\/([\w-]+)$/.exec(p);
  if (tm && req.method === 'DELETE') {
    if (!validId(tm[1])) { json(res, 400, { error: 'Unknown style.' }); return true; }
    try { deleteCustomTheme(tm[1]); } catch (e) { json(res, 409, { error: e instanceof Error ? e.message : String(e) }); return true; }
    unregisterTheme(tm[1]); json(res, 200, themeList()); return true;
  }
  if (p === '/api/style-thumbs' && req.method === 'GET') {
    const scene = sceneById(String(url.searchParams.get('sceneId'))); if (!scene) { json(res, 400, { error: 'unknown scene' }); return true; }
    let params: Record<string, unknown> = {}; try { params = JSON.parse(url.searchParams.get('params') ?? '{}'); } catch { /* defaults */ }
    themeList(); // pick up new theme files
    const out = themeIds().map(style => { const key = thumbKey(scene.meta.id, { ...params, style })!; return { style, thumb: `/thumbs/${key}.png`, ready: fs.existsSync(path.join(THUMBS, key + '.png')) }; });
    if (out.some(o => !o.ready)) ensureStyleThumbs(scene.meta.id, params);
    json(res, 200, out); return true;
  }
  if (p === '/api/jobs' && req.method === 'GET') { json(res, 200, jobs.map(publicJob)); return true; }
  if (p === '/api/jobs' && req.method === 'POST') {
    const b = await readBody(req); const scene = sceneById(String(b.sceneId));
    if (!scene) { json(res, 400, { error: 'unknown scene' }); return true; }
    const { j, errors } = enqueue(scene, b.params ?? {});
    json(res, 200, { ...publicJob(j), warnings: errors }); return true;
  }
  // "Render again": a stopped or failed job runs again from its saved scene and parameters (renders are deterministic: same settings, same video)
  const ag = /^\/api\/jobs\/([\w.-]+)\/again$/.exec(p);
  if (ag && req.method === 'POST') {
    const old = jobs.find(x => x.id === ag[1]);
    if (!old) { json(res, 404, { error: 'This render is no longer in the list.' }); return true; }
    if (old.status !== 'stopped' && old.status !== 'error') { json(res, 409, { error: 'Only a stopped or failed render can be run again.' }); return true; }
    const prev = old.retriedBy ? jobs.find(x => x.id === old.retriedBy) : undefined;
    if (prev && prev.status !== 'error' && prev.status !== 'stopped') { json(res, 409, { error: 'This render was already started again.' }); return true; }
    const scene = sceneById(old.sceneId); if (!scene) { json(res, 400, { error: 'unknown scene' }); return true; }
    const { j, errors } = enqueue(scene, old.params);
    old.retriedBy = j.id; saveJobs(); broadcast(old);
    json(res, 200, { ...publicJob(j), warnings: errors }); return true;
  }
  if (p === '/api/reveal' && req.method === 'POST') {
    // show a finished render in Finder / Explorer; only files inside output/ can be named
    const b = await readBody(req); const file = path.join(OUT, path.basename(String(b.file ?? '')));
    if (!fs.existsSync(file)) { json(res, 404, { error: 'That file is no longer in output/.' }); return true; }
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', file]] : process.platform === 'win32' ? ['explorer', [`/select,${file}`]] : ['xdg-open', [OUT]];
    try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); json(res, 200, { ok: true, path: file }); }
    catch { json(res, 500, { error: 'Could not open the file manager.', path: file }); }
    return true;
  }
  // ---- video list (metadata + tracking). Local files only; nothing is ever sent to YouTube. ----
  if (p === '/api/videos' && req.method === 'GET') {
    if (videos.readOnly && !videos.retryLock()) videos.reload(); // the other studio may be gone (take over), or it changed the list (show the new one)
    if (videos.list().some(v => v.status === 'scheduled' && v.youtube?.videoId)) syncSoon();
    json(res, 200, { videos: videos.list().map(videoView), notice: videos.takeNotice(), untracked: untrackedRenders().length, dataDir: path.relative(ROOT, DATA) || '.', readOnly: videos.readOnly, readOnlyReason: videos.readOnlyReason, settings: videos.settings() }); return true;
  }
  if (p === '/api/videos/export' && req.method === 'GET') {
    const csv = url.searchParams.get('format') !== 'json', day = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { 'content-type': csv ? 'text/csv; charset=utf-8' : 'application/json', 'content-disposition': `attachment; filename="videos-${day}.${csv ? 'csv' : 'json'}"` });
    res.end(csv ? videos.exportCsv() : videos.exportJson()); return true;
  }
  if (p === '/api/videos/import' && req.method === 'POST') {
    // optional { files: ["name.mp4", ...] } limits the import to those renders; without it every unrecorded render is added (the banner button)
    const b = await readBody(req), only = Array.isArray(b.files) ? new Set(b.files.map(String)) : null;
    const found = untrackedRenders().filter(u => !only || only.has(u.file)); let added = 0; const lang = videos.settings().suggestLang;
    videos.mutate(vs => {
      for (const u of found) {
        const v = newVideoFor(u.sceneId, u.params, { jobId: u.id, file: u.file, sizeBytes: u.size, status: 'rendered', createdAt: new Date(u.mtimeMs).toISOString(), updatedAt: new Date(u.mtimeMs).toISOString() }, new Date(u.mtimeMs), lang);
        if (v && !vs.some(x => x.file === u.file)) { vs.push(v); added++; }
      }
      return { videos: vs, result: null };
    });
    json(res, 200, { added, videos: videos.list().map(videoView) }); return true;
  }
  if (p === '/api/settings' && req.method === 'PUT') {
    const b = await readBody(req);
    if (b.suggestLang !== 'en' && b.suggestLang !== 'id') { json(res, 400, { error: 'Language must be "en" or "id".' }); return true; }
    videos.setSuggestLang(b.suggestLang); json(res, 200, videos.settings()); return true;
  }
  if (p === '/api/videos/reveal-data' && req.method === 'POST') {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [DATA]] : process.platform === 'win32' ? ['explorer', [DATA]] : ['xdg-open', [DATA]];
    fs.mkdirSync(DATA, { recursive: true });
    try { const c = spawn(cmd, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); json(res, 200, { ok: true, path: DATA }); } catch { json(res, 500, { error: 'Could not open the folder.', path: DATA }); }
    return true;
  }
  const vm = /^\/api\/videos\/([\w-]+)(\/thumbnail|\/cover)?$/.exec(p);
  if (vm) {
    const id = vm[1], v = videos.get(id);
    if (!v) { json(res, 404, { error: 'This video is no longer in the list. Reload the page.' }); return true; }
    if (vm[2] === '/cover' && req.method === 'POST') {
      if (videos.readOnly) throw new ReadOnlyError(videos.readOnlyReason);
      const b = await readBody(req), t = b.auto === false || b.t !== undefined ? Number(b.t) : undefined;
      if (t !== undefined && (!Number.isFinite(t) || t < 0 || t > (v.durationSec || 600))) { json(res, 400, { error: 'That time is outside the video.' }); return true; }
      try { json(res, 200, videoView(await buildCover(id, { t, text: typeof b.text === 'string' ? b.text.slice(0, 120) : undefined, noText: b.noText === true }))); }
      catch (e) { json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
      return true;
    }
    if (vm[2] === '/thumbnail' && req.method === 'POST') {
      const b = await readBody(req), t = Number(b.t);
      if (videos.readOnly) throw new ReadOnlyError(videos.readOnlyReason);
      const mp4 = path.join(OUT, v.file);
      if (!v.file || !fs.existsSync(mp4)) { json(res, 400, { error: 'The MP4 is not in output/ any more, so a frame cannot be taken.' }); return true; }
      if (!Number.isFinite(t) || t < 0 || t > (v.durationSec || 600)) { json(res, 400, { error: 'That time is outside the video.' }); return true; }
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      await extractFrame(mp4, t, path.join(THUMB_DIR, id + '.png'));
      const out = videos.mutate(vs => { const i = vs.findIndex(x => x.id === id); vs[i] = patchVideo(vs[i], { thumbSec: Math.round(t * 100) / 100, thumbFile: id + '.png', coverFile: '' }); return { videos: vs, result: vs[i] }; });
      json(res, 200, videoView(out)); return true;
    }
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      const out = videos.mutate(vs => { const i = vs.findIndex(x => x.id === id); vs[i] = patchVideo(vs[i], b); return { videos: vs, result: vs[i] }; });
      json(res, 200, videoView(out)); return true;
    }
    if (req.method === 'DELETE') {
      videos.mutate(vs => ({ videos: vs.filter(x => x.id !== id), result: null }));
      if (v.thumbFile) fs.rmSync(path.join(THUMB_DIR, path.basename(v.thumbFile)), { force: true }); // the MP4 stays in output/
      if (v.coverFile) fs.rmSync(path.join(THUMB_DIR, path.basename(v.coverFile)), { force: true });
      json(res, 200, { ok: true }); return true;
    }
  }
  if (p === '/api/jobs/events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n'); listeners.add(res); req.on('close', () => listeners.delete(res)); return true;
  }
  return false;
}

// ---------------- server ----------------
await recoverJobs();
loadHistory();
const vite = await createVite({ root: path.join(ROOT, 'apps/studio'), configFile: false, appType: 'spa', logLevel: 'warn',
  server: { middlewareMode: true, fs: { allow: [ROOT] }, hmr: { port: PORT + 1 } } });

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/oauth/youtube') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      try { const c = await yt.finishLogin(url.searchParams); res.end(ytPage('Connected ✓', `YouTube channel <b>${esc(c.name)}</b>${c.handle ? ` (${esc(c.handle)})` : ''} is connected to Sim Studio.`)); }
      catch (e) { res.end(ytPage('Not connected', esc(e instanceof Error ? yt.redact(e.message) : 'Unknown error.'))); }
      return;
    }
    if (url.pathname.startsWith('/api/')) { if (await api(req, res, url)) return; json(res, 404, { error: 'no such endpoint' }); return; }
    if (url.pathname.startsWith('/thumbs/')) { res.setHeader('cache-control', 'max-age=31536000, immutable'); return sendFile(req, res, path.join(THUMBS, path.basename(url.pathname))); }
    if (url.pathname.startsWith('/data/thumbnails/')) return sendFile(req, res, path.join(THUMB_DIR, path.basename(url.pathname)));
    if (url.pathname.startsWith('/output/')) return sendFile(req, res, path.join(OUT, path.basename(decodeURIComponent(url.pathname))));
    if (url.pathname.startsWith('/assets/fonts/')) return sendFile(req, res, path.join(ROOT, 'assets/fonts', path.basename(url.pathname)));
    if (url.pathname.startsWith('/assets/sfx/')) return sendFile(req, res, path.join(ROOT, 'assets/sfx', path.basename(url.pathname)));
    vite.middlewares(req, res, () => { res.writeHead(404); res.end('not found'); });
  } catch (e) {
    if (e instanceof yt.YtError) { json(res, e.kind === 'auth' ? 401 : e.kind === 'quota' ? 429 : 400, { error: e.message, kind: e.kind }); return; }
    json(res, e instanceof ReadOnlyError ? 423 : 500, { error: e instanceof ReadOnlyError ? `Read-only: ${e.message}` : yt.redact(e instanceof Error ? e.message : String(e)) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`studio: http://127.0.0.1:${PORT}/  (render workers: ${CONCURRENCY})`));
