// The studio's side of long videos: the records (data/compilations), the HTTP endpoints of the Compile page, and what happens when a build
// job finishes. The build itself runs in a child process (compile-worker.ts) through the same queue as every render. Local only:
// nothing here talks to YouTube, and nothing here changes a Short or its schedule.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Video } from '../../packages/publish/index.ts';
import { chapterLines, framesOf, outFileFor, startTimes, stamp, totalSeconds, type Compilation } from '../../packages/compile/index.ts';
import { planParts, toClipRef, type Candidate } from '../../packages/compile/select.ts';
import { writeLongTexts } from '../../packages/compile/texts.ts';
import { openCompileStore } from './compile-store.ts';
import { applyReport, buildRequest, issuesOf, library, makeThumbnail, needGB, newCompilation, rewriteTexts, videoFor, type Library } from './compile-ops.ts';
import type { BuildReport } from './compile-build.ts';

type Json = (res: http.ServerResponse, code: number, body: unknown) => void;
export interface JobView { id: string; status: 'queued' | 'running' | 'done' | 'error' | 'stopped'; progress: { frame: number; frames: number; fps: number; phase: string }; report?: unknown; error?: string; params: Record<string, unknown> }
export interface CompileDeps {
  data: string; out: string; thumbDir: string;
  videos: { list(): Video[]; mutate<T>(fn: (vs: Video[]) => { videos: Video[]; result: T }): T; readonly readOnly: boolean; readonly readOnlyReason: string };
  jobs: () => JobView[];
  /** put a build job in the queue; returns its id */
  enqueue: (c: Compilation) => string;
  /** stop a queued or running job (kills its worker); the job becomes Stopped */
  stop: (jobId: string) => void;
  /** '' when there is room for `gb` more, otherwise the plain-words refusal */
  lowDisk: (gb: number) => string;
  json: Json; readBody: (req: http.IncomingMessage) => Promise<any>;
  /** how the server refuses writes while another studio owns the data folder */
  readOnlyError: (reason: string) => Error;
}
const ID = /^c-[\w.-]+$/;

export function createCompileService(d: CompileDeps) {
  const dir = path.join(d.data, 'compilations'), cacheDir = path.join(dir, 'cache');
  const store = openCompileStore(dir, { canWrite: () => !d.videos.readOnly });
  let comps: Compilation[] = [];
  const get = (id: string) => comps.find(c => c.id === id);
  const put = (c: Compilation) => { const i = comps.findIndex(x => x.id === c.id); if (i >= 0) comps[i] = c; else comps.push(c); store.save(c); return c; };
  const lib = (): Library => library(d.videos.list(), d.out);
  const jobOf = (c: Compilation) => (c.jobId ? d.jobs().find(j => j.id === c.jobId) : undefined);
  const live = (c: Compilation) => { const j = jobOf(c); return !!j && (j.status === 'queued' || j.status === 'running'); };

  /** a build can never be "building" after a restart: whatever a stopped studio left is shown as failed, with what to do */
  function reconcile() {
    for (const c of comps) if (c.status === 'building' && !live(c)) put({ ...c, status: 'failed', note: 'The studio stopped while this was building. Nothing was lost: press Build to continue, finished clips are reused.', updatedAt: new Date().toISOString() });
  }
  /** keep the Videos list in step with the built long videos (created once, refreshed after a rebuild) */
  function adopt() {
    if (d.videos.readOnly) return;
    for (const c of comps) {
      if (c.status !== 'built' || !c.file || !fs.existsSync(path.join(d.out, c.file))) continue;
      const v = d.videos.mutate(vs => {
        const i = vs.findIndex(x => x.compilationId === c.id);
        const next = videoFor(c, i >= 0 ? vs[i] : undefined);
        if (i >= 0) vs[i] = next; else vs.push(next);
        return { videos: vs, result: next };
      });
      if (c.videoId !== v.id) put({ ...c, videoId: v.id });
    }
  }
  function init() { comps = store.load(); if (store.notice()) console.warn('long videos:', store.notice()); reconcile(); try { adopt(); } catch (e) { console.warn('long videos: could not update the Videos list:', e instanceof Error ? e.message : e); } }

  // ---------------- the queue calls these ----------------
  /** the build request of a queued job (undefined when the long video is gone) */
  function request(compilationId: string) { const c = get(compilationId); return c ? buildRequest(c, d.out, cacheDir) : undefined; }
  /** a build job ended (done, error or stopped): record the outcome. Never throws. */
  async function onJobFinished(job: JobView) {
    const c = get(String(job.params.compilationId)); if (!c || c.jobId !== job.id) return;
    try {
      if (job.status === 'done' && job.report) {
        let next = applyReport({ ...c, jobId: '' }, job.report as BuildReport);
        put(next);
        try { next = put({ ...next, thumbFile: await makeThumbnail(next, d.videos.list(), d.out, d.thumbDir) }); } catch (e) { put({ ...next, note: `${next.note} The thumbnail could not be made: ${e instanceof Error ? e.message : e}` }); }
        adopt();
      } else if (job.status === 'stopped') put({ ...c, status: 'failed', jobId: '', note: 'The build was stopped. Press Build to continue: finished clips are reused.', updatedAt: new Date().toISOString() });
      else put({ ...c, status: 'failed', jobId: '', error: (job.error ?? 'The build failed.').slice(0, 400), note: 'Press Build to try again: finished clips are reused.', updatedAt: new Date().toISOString() });
    } catch (e) { console.warn('long videos: could not record the end of a build:', e instanceof Error ? e.message : e); }
  }
  /** queue a build (also what "Render again" on a stopped build does). Returns an error text or '' */
  function startBuild(c: Compilation): { error?: string; job?: string } {
    if (live(c)) return { error: 'This long video is already being built.' };
    if (!c.clips.length) return { error: 'There are no clips in this long video.' };
    const usable = new Set(lib().candidates.map(x => x.videoId)), gone = c.clips.filter(k => !usable.has(k.videoId));
    if (gone.length) return { error: `${gone.length} clip${gone.length === 1 ? ' is' : 's are'} no longer usable (${gone[0].label}). Remove ${gone.length === 1 ? 'it' : 'them'} from the list first.` };
    const full = d.lowDisk(needGB(c)); if (full) return { error: full };
    const id = d.enqueue({ ...c, status: 'building' });
    put({ ...c, status: 'building', jobId: id, error: '', note: '', updatedAt: new Date().toISOString() });
    return { job: id };
  }

  // ---------------- views ----------------
  const view = (c: Compilation) => {
    const j = jobOf(c), starts = startTimes(c.clips);
    return { ...c, minutes: +(totalSeconds(c.clips) / 60).toFixed(1), issues: issuesOf(c), job: j ? { id: j.id, status: j.status, progress: j.progress } : null,
      fileExists: !!c.file && fs.existsSync(path.join(d.out, c.file)), thumbUrl: c.thumbFile && fs.existsSync(path.join(d.thumbDir, c.thumbFile)) ? `/data/thumbnails/${c.thumbFile}?v=${Date.parse(c.updatedAt) || 0}` : '',
      chapters: chapterLines(c.clips), starts: starts.map(stamp), cacheGB: cacheGB(c) };
  };
  const cacheGB = (c: Compilation) => { try { const ids = new Set(c.clips.map(k => k.videoId)); return +(fs.readdirSync(cacheDir).filter(f => [...ids].some(i => f.startsWith(`clip-${i}-`) || f.startsWith(`aud-${i}-`))).reduce((s, f) => s + fs.statSync(path.join(cacheDir, f)).size, 0) / 2 ** 30).toFixed(2); } catch { return 0; } };
  const clipMeta = (x: Candidate) => ({ videoId: x.videoId, label: toClipRef(x).label, sceneId: x.sceneId, seconds: Math.round(x.durationSec) });
  const usedBy = () => { const m = new Map<string, string>(); for (const c of comps) for (const k of c.clips) m.set(k.videoId, c.id); return m; };

  /** the plan the studio suggests (not saved): which long videos, which clips, how long, what the title would be */
  function suggest(seed: number) {
    const L = lib(), plan = planParts(L.candidates, seed), used = usedBy();
    return {
      usable: L.candidates.length, total: L.total, left: L.left.length, twins: plan.twins.length,
      parts: plan.parts.map(p => {
        const clips = p.clips.map(toClipRef), t = writeLongTexts({ group: p.group, part: p.part, parts: p.parts, clips, seed });
        return { group: p.group, part: p.part, parts: p.parts, clipIds: p.clips.map(x => x.videoId), count: p.clips.length, minutes: +(p.clips.reduce((s, x) => s + x.durationSec, 0) / 60).toFixed(1), title: t.title, created: p.clips.every(x => used.has(x.videoId)) };
      }),
    };
  }

  // ---------------- HTTP ----------------
  const writable = () => { if (d.videos.readOnly) throw d.readOnlyError(d.videos.readOnlyReason); };
  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    if (p === '/api/compile' && req.method === 'GET') {
      const L = lib(), used = usedBy();
      d.json(res, 200, { compilations: comps.map(view), notice: store.notice(), readOnly: d.videos.readOnly, library: { total: L.total, usable: L.candidates.length, left: L.left.length, clips: L.candidates.map(x => ({ ...clipMeta(x), usedBy: used.get(x.videoId) ?? '' })) } });
      return true;
    }
    if (p === '/api/compile/suggest' && req.method === 'GET') { d.json(res, 200, suggest(Number(url.searchParams.get('seed')) || 20261119)); return true; }
    if (p === '/api/compilations' && req.method === 'POST') {
      writable(); const b = await d.readBody(req), seed = Number(b.seed) || 20261119, L = lib(), byId = new Map(L.candidates.map(x => [x.videoId, x]));
      const made: Compilation[] = [];
      if (b.suggest === true) { // every suggested part whose clips are not in a long video yet
        const used = usedBy();
        for (const part of planParts(L.candidates, seed).parts) if (!part.clips.every(x => used.has(x.videoId))) { const c = newCompilation(part, comps, seed); made.push(put(c)); for (const k of c.clips) used.set(k.videoId, c.id); }
      } else {
        const ids: string[] = Array.isArray(b.clipIds) ? b.clipIds.map(String) : [], clips = ids.map(i => byId.get(i)).filter((x): x is Candidate => !!x);
        if (!clips.length || clips.length !== new Set(ids).size || clips.length !== ids.length) { d.json(res, 400, { error: 'Pick at least one clip from the list (each clip once).' }); return true; }
        made.push(put(newCompilation({ group: String(b.group || 'mix'), part: 1, parts: 1, clips }, comps, seed)));
      }
      d.json(res, 200, { compilations: made.map(view) }); return true;
    }
    const m = /^\/api\/compilations\/([\w.-]+)(\/build|\/stop|\/thumbnail|\/cache)?$/.exec(p);
    if (!m) return false;
    const c = ID.test(m[1]) ? get(m[1]) : undefined;
    if (!c) { d.json(res, 404, { error: 'This long video is no longer in the list. Reload the page.' }); return true; }
    if (m[2] === '/build' && req.method === 'POST') { writable(); const r = startBuild(c); if (r.error) d.json(res, 409, { error: r.error }); else d.json(res, 200, view(get(c.id)!)); return true; }
    if (m[2] === '/stop' && req.method === 'POST') { writable(); if (!live(c)) { d.json(res, 409, { error: 'This long video is not being built.' }); return true; } d.stop(c.jobId); d.json(res, 200, view(get(c.id)!)); return true; }
    if (m[2] === '/thumbnail' && req.method === 'POST') {
      writable();
      try { const name = await makeThumbnail(c, d.videos.list(), d.out, d.thumbDir); const next = put({ ...c, thumbFile: name, updatedAt: new Date().toISOString() }); adopt(); d.json(res, 200, view(next)); }
      catch (e) { d.json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
      return true;
    }
    if (m[2] === '/cache' && req.method === 'DELETE') {
      writable(); if (live(c)) { d.json(res, 409, { error: 'This long video is being built; its clip cache is in use.' }); return true; }
      const ids = c.clips.map(k => k.videoId); let n = 0;
      // only this long video's own cache files, and only those no other long video's clips use
      const keep = new Set(comps.filter(x => x.id !== c.id).flatMap(x => x.clips.map(k => k.videoId)));
      try { for (const f of fs.readdirSync(cacheDir)) if (ids.some(i => !keep.has(i) && (f.startsWith(`clip-${i}-`) || f.startsWith(`aud-${i}-`)))) { fs.rmSync(path.join(cacheDir, f), { force: true }); n++; } } catch { /* no cache yet */ }
      d.json(res, 200, { removed: n, ...view(c) }); return true;
    }
    if (req.method === 'PATCH') {
      writable(); if (live(c)) { d.json(res, 409, { error: 'This long video is being built. Stop the build first, or wait for it.' }); return true; }
      const b = await d.readBody(req); let next: Compilation = { ...c };
      if (Array.isArray(b.clipIds)) {
        const byId = new Map(lib().candidates.map(x => [x.videoId, x])), ids: string[] = b.clipIds.map(String), clips = ids.map(i => byId.get(i));
        if (!ids.length || clips.some(x => !x) || new Set(ids).size !== ids.length) { d.json(res, 400, { error: 'Every clip must be a usable Short, used once.' }); return true; }
        const planned = new Map(c.clips.map(k => [k.videoId, k.frames]));
        next = { ...next, clips: (clips as Candidate[]).map(x => { const r = toClipRef(x); return { ...r, frames: planned.get(x.videoId) ?? r.frames }; }) };
        next = rewriteTexts(next, { keepTitle: false }); // the number of clips and the chapters changed, so the title and description follow
      }
      if (typeof b.titleIndex === 'number') next = rewriteTexts(next, { titleIndex: b.titleIndex });
      if (b.rewrite === true) next = rewriteTexts(next, { keepTitle: true });
      if (typeof b.title === 'string') next.title = b.title.slice(0, 300);
      if (typeof b.description === 'string') next.description = b.description.slice(0, 10000);
      if (Array.isArray(b.tags)) next.tags = b.tags.filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.slice(0, 100)).slice(0, 60);
      if (Array.isArray(b.hashtags)) next.hashtags = b.hashtags.filter((x: unknown): x is string => typeof x === 'string' && /^#\w{1,50}$/.test(x)).slice(0, 10);
      if (typeof b.thumbText === 'string') next.thumbText = b.thumbText.slice(0, 80);
      if (Array.isArray(b.clipIds) && c.status === 'built') next = { ...next, status: 'draft', note: 'The clips changed. Build it again to get a video that matches.' };
      next.updatedAt = new Date().toISOString(); put(next); if (c.status === 'built') adopt();
      d.json(res, 200, view(get(c.id)!)); return true;
    }
    if (req.method === 'DELETE') {
      writable(); if (live(c) || c.status === 'built') { d.json(res, 409, { error: c.status === 'built' ? 'A finished long video is not removed from here: its video stays in output/ and in the Videos list.' : 'This long video is being built.' }); return true; }
      store.remove(c.id); comps = comps.filter(x => x.id !== c.id); d.json(res, 200, { ok: true }); return true;
    }
    return false;
  }
  return { init, api, request, onJobFinished, startBuild, get, list: () => comps, cacheDir, outFileFor, framesOf };
}
export type CompileService = ReturnType<typeof createCompileService>;
