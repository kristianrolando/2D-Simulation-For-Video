// One YouTube upload at a time, outside the render queue (renders keep running). Each step is written to the video's
// record in the existing store (atomic, with backups), so it can be continued after a failure or a restart:
//   uploading → processing → thumbnail → finishing → done        (stage 'failed' + failedAt = the step to continue)
// The tracking status stays the one the Videos page already has: Scheduled (publishAt) or Published (made public).
// Never: a second videos.insert for the same record, an automatic retry after a quota error, or any delete call.
import fs from 'node:fs';
import path from 'node:path';
import { patchVideo, localDate, sanitizeYoutube, uploadDescription, fileSig, uploadThumbName, type Video, type YoutubeState, type UploadOptions, type FileFacts } from '../../packages/publish/index.ts';
import { imageSize, isShortsRatio, THUMB_MAX_BYTES } from '../../packages/publish/cover.ts';
import * as yt from './youtube.ts';
import type { Store } from './store.ts';

export interface Live { videoId: string; stage: string; sent: number; total: number; startedAt: number }
export interface UploaderDeps { store: Store; outDir: string; thumbDir: string; log?: (line: string) => void }

/** local 'YYYY-MM-DDTHH:mm' (the Mac's time zone) → ISO UTC */
export const localToUtc = (s: string) => new Date(s).toISOString();
/** ISO UTC → local 'YYYY-MM-DDTHH:mm' for the existing scheduledAt field */
export function utcToLocal(iso: string) { const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }

export function createUploader(deps: UploaderDeps) {
  const { store } = deps;
  /** the picture to send for a Short: the tall cover, and only if it really is 9:16 and within YouTube's size limit (YouTube
   *  crops Shorts thumbnails to 9:16 around the centre, so anything else would lose its hook text). null = no picture. */
  function thumbToSend(v: Video): { name: string; file: string } | null {
    const name = uploadThumbName(v) ? path.basename(uploadThumbName(v)) : ''; if (!name) return null;
    const file = path.join(deps.thumbDir, name); if (!fs.existsSync(file)) return null;
    const data = fs.readFileSync(file), dim = imageSize(data);
    if (!dim) throw new yt.YtError('thumbnail', 'The thumbnail is not a JPEG or PNG picture. Draw it again in Videos.');
    if (data.length > THUMB_MAX_BYTES) throw new yt.YtError('thumbnail', 'The thumbnail is larger than 50 MB.');
    if (!isShortsRatio(dim.width, dim.height)) throw new yt.YtError('thumbnail', `The thumbnail is ${dim.width}×${dim.height}, not 9:16. YouTube would crop it and cut off the text. Draw it again in Videos.`);
    return { name, file };
  }
  const log = (s: string) => deps.log?.(yt.redact(s));
  let live: Live | null = null;
  /** what each running/next step needs, kept for the session (the options are also implied by the record) */
  const metaOf = new Map<string, yt.UploadMeta>();

  function write(id: string, fn: (v: Video) => Video): Video {
    return store.mutate(vs => { const i = vs.findIndex(x => x.id === id); if (i < 0) throw new Error('This video is no longer in the list.'); vs[i] = fn(vs[i]); return { videos: vs, result: vs[i] }; });
  }
  const setYt = (id: string, patch: Partial<YoutubeState>, extra: Record<string, unknown> = {}) =>
    write(id, v => { const n = patchVideo(v, extra); n.youtube = sanitizeYoutube({ ...(v.youtube ?? {}), ...patch }); return n; });

  function fail(id: string, step: YoutubeState['failedAt'], e: unknown) {
    const msg = e instanceof yt.YtError ? e.message : yt.redact(e instanceof Error ? e.message : String(e));
    log(`youtube: ${id} stopped at ${step}: ${msg}`);
    try { setYt(id, { stage: 'failed', failedAt: step, error: msg }); } catch { /* read-only or removed */ }
  }

  /** Steps from `from` to the end. Each step is safe to repeat except the upload, which only ever continues its own session. */
  async function run(id: string, from: YoutubeState['failedAt'] | 'start') {
    const v0 = store.get(id)!, mp4 = path.join(deps.outDir, v0.file), meta = metaOf.get(id) ?? metaFromRecord(v0);
    let step: YoutubeState['failedAt'] = 'uploading';
    live = { videoId: id, stage: from === 'start' ? 'uploading' : String(from), sent: v0.youtube?.sent ?? 0, total: v0.youtube?.total ?? 0, startedAt: Date.now() };
    try {
      if (from === 'start' || from === 'uploading') {
        step = 'uploading';
        let ytId = '';
        try {
          ytId = await yt.sendFile(id, mp4, (sent, total) => { if (live) { live.sent = sent; live.total = total; } }, Number(process.env.SIM_YT_CHUNK) || undefined); // SIM_YT_CHUNK: tests only
        } catch (e) {
          if (!(e instanceof yt.YtError) || e.kind !== 'expired') throw e;
          // the session is gone: did the upload arrive anyway? (same title in the last uploads, since it started)
          ytId = await yt.findRecentUpload(meta.title, Date.parse(v0.youtube?.uploadedAt || v0.updatedAt));
          if (!ytId) { yt.dropSession(id); setYt(id, { stage: 'failed', failedAt: 'uploading', error: 'The upload did not finish and its session expired. Nothing was published. Upload again (with a new approval) if you want.', videoId: '' });
            // allow a fresh, explicitly approved upload: clear the technical state but keep the record otherwise
            write(id, v => { const n = { ...v }; delete n.youtube; return n; }); live = null; return; }
        }
        yt.dropSession(id);
        const ch = yt.channel();
        setYt(id, { videoId: ytId, stage: 'processing', failedAt: '', error: '', sent: live?.total ?? 0, channelId: ch?.id ?? v0.youtube?.channelId ?? '' },
          { youtubeUrl: store.get(id)!.youtubeUrl || `https://www.youtube.com/shorts/${ytId}` });
        log(`youtube: ${id} uploaded as ${ytId}`);
      }
      const ytId = store.get(id)!.youtube!.videoId;
      if (from === 'start' || from === 'uploading' || from === 'processing') {
        step = 'processing'; live!.stage = 'processing';
        await yt.waitProcessed(ytId, waitOpts);
        setYt(id, { stage: 'thumbnail' });
      }
      if (from !== 'finishing') {
        step = 'thumbnail'; live!.stage = 'thumbnail';
        const cur = store.get(id)!;
        let pic: ReturnType<typeof thumbToSend> = null, picError: unknown = null;
        try { pic = thumbToSend(cur); } catch (e) { picError = e; }
        if (picError || pic) {
          try { if (picError) throw picError; await yt.setThumbnail(ytId, pic!.file); setYt(id, { thumbnail: 'set', thumbSent: pic!.name, stage: 'finishing' }); }
          catch (e) {
            if (e instanceof yt.YtError && e.kind === 'thumbnail') {
              setYt(id, { thumbnail: 'rejected' });
              // scheduled: YouTube will still publish it (with its own frame) — the tracking says so; 'now' waits for the owner
              if (cur.youtube?.mode === 'schedule') setYt(id, {}, { status: 'scheduled', scheduledAt: utcToLocal(cur.youtube.publishAt) });
              throw e;
            }
            throw e;
          }
        } else setYt(id, { thumbnail: 'skipped', stage: 'finishing' });
      }
      step = 'finishing'; live!.stage = 'finishing';
      const cur = store.get(id)!;
      if (cur.youtube!.mode === 'now') {
        await yt.makePublic(ytId, meta);
        setYt(id, { stage: 'done', failedAt: '', error: '' }, { status: 'published', publishedAt: localDate() });
      } else setYt(id, { stage: 'done', failedAt: '', error: '' }, { status: 'scheduled', scheduledAt: utcToLocal(cur.youtube!.publishAt) });
      log(`youtube: ${id} done (${cur.youtube!.mode})`);
    } catch (e) { fail(id, step, e); }
    finally { live = null; }
  }
  const waitOpts = { every: Number(process.env.SIM_YT_POLL_MS) || 20e3, max: 15 * 60e3 };

  function metaFromRecord(v: Video): yt.UploadMeta {
    const d = yt.status().defaults;
    return { title: v.title, description: uploadDescription(v), tags: v.tags, categoryId: d.categoryId, language: d.language, madeForKids: d.madeForKids, synthetic: d.synthetic, notify: d.notify, publishAt: v.youtube?.publishAt ?? '' };
  }

  return {
    live: () => live,
    busy: () => !!live,
    /** a fresh, approved upload (the caller has checked readiness and consent) */
    async start(v: Video, f: FileFacts, o: UploadOptions) {
      if (live) throw new Error('Another upload is running. Wait until it has finished.');
      const ch = yt.channel(); if (!ch) throw new yt.YtError('auth', 'YouTube is not connected.');
      const publishAt = o.mode === 'schedule' ? localToUtc(o.at) : '';
      const meta: yt.UploadMeta = { title: v.title, description: uploadDescription(v), tags: v.tags, categoryId: o.categoryId, language: o.language, madeForKids: o.madeForKids, synthetic: o.synthetic, notify: o.notify, publishAt };
      metaOf.set(v.id, meta);
      // record first (so a crash right after leaves a trace), then open the session: exactly one videos.insert
      setYt(v.id, { videoId: '', channelId: ch.id, channelName: ch.name, stage: 'uploading', failedAt: '', mode: o.mode, publishAt, uploadedAt: new Date().toISOString(), thumbnail: 'pending', thumbSent: '', fileSig: fileSig(f), error: '', sent: 0, total: f.sizeBytes, autoPublished: false });
      live = { videoId: v.id, stage: 'uploading', sent: 0, total: f.sizeBytes, startedAt: Date.now() };
      try { await yt.startSession(v.id, path.join(deps.outDir, v.file), meta); }
      catch (e) {
        live = null;
        // no session = nothing reached YouTube: clear the record so a later, newly approved upload is possible
        write(v.id, x => { const n = { ...x }; delete n.youtube; return n; });
        throw e;
      }
      live = null;
      void run(v.id, 'start');
    },
    /** continue a stopped upload from the step that failed (never a new videos.insert) */
    resume(v: Video) {
      if (live) throw new Error('Another upload is running. Wait until it has finished.');
      const y = v.youtube; if (!y) throw new Error('This video has no upload to continue.');
      if (y.stage === 'done') throw new Error('This upload has already finished.');
      const from = y.stage === 'failed' ? y.failedAt || 'uploading' : y.stage === 'uploading' ? 'uploading' : y.stage as YoutubeState['failedAt'];
      if (from === 'uploading' && !y.videoId && !yt.hasSession(v.id)) throw new Error('There is no upload session left to continue.');
      setYt(v.id, { stage: from === 'uploading' ? 'uploading' : from === 'processing' ? 'processing' : from === 'thumbnail' ? 'thumbnail' : 'finishing', failedAt: '', error: '' });
      void run(v.id, from);
    },
    /** Put the right (tall 9:16) thumbnail on a video that is already on YouTube. Costs 50 quota units and changes the channel,
     *  so the caller needs the owner's explicit approval first. Touches nothing else: no status, schedule or privacy change. */
    async replaceThumbnail(v: Video) {
      if (live) throw new Error('Another upload is running. Wait until it has finished.');
      const y = v.youtube; if (!y?.videoId) throw new Error('This video is not on YouTube.');
      if (y.stage !== 'done') throw new Error('Finish or continue the upload first.');
      const pic = thumbToSend(v); if (!pic) throw new Error('There is no thumbnail picture to send. Draw it in Videos first.');
      live = { videoId: v.id, stage: 'thumbnail', sent: 0, total: 0, startedAt: Date.now() };
      try {
        await yt.setThumbnail(y.videoId, pic.file);
        setYt(v.id, { thumbnail: 'set', thumbSent: pic.name, error: '' });
        log(`youtube: ${v.id} thumbnail replaced (${pic.name})`);
      } finally { live = null; }
    },
    /** the owner chose to go on without a custom thumbnail after YouTube refused it */
    skipThumbnail(v: Video) {
      if (live) throw new Error('Another upload is running.');
      if (v.youtube?.failedAt !== 'thumbnail') throw new Error('Nothing to skip.');
      setYt(v.id, { thumbnail: 'skipped', stage: 'finishing', failedAt: '', error: '' });
      void run(v.id, 'finishing');
    },
    /** On start: a record left in a running stage by a stopped server becomes "failed at that stage" (so it can be continued). */
    recover() {
      for (const v of store.list()) {
        const y = v.youtube; if (!y || y.stage === 'done' || y.stage === 'failed') continue;
        try { setYt(v.id, { stage: 'failed', failedAt: y.stage === 'uploading' ? 'uploading' : y.stage === 'processing' ? 'processing' : y.stage === 'thumbnail' ? 'thumbnail' : 'finishing', error: 'The studio stopped during the upload. Press Continue to resume from where it was.' }); } catch { /* read-only */ }
      }
    },
    /** Scheduled → Published once YouTube says public (1 unit for ≤50 videos). Never demotes, never twice. */
    async syncPublished(): Promise<number> {
      const due = store.list().filter(v => v.status === 'scheduled' && v.youtube?.videoId && !v.youtube.autoPublished);
      if (!due.length || !yt.channel()) return 0;
      const st = await yt.privacyOf(due.map(v => v.youtube!.videoId));
      let n = 0;
      for (const v of due) if (st[v.youtube!.videoId] === 'public') {
        const day = v.youtube!.publishAt ? localDate(new Date(v.youtube!.publishAt)) : localDate();
        setYt(v.id, { autoPublished: true }, { status: 'published', publishedAt: day }); n++;
      }
      return n;
    },
  };
}
export type Uploader = ReturnType<typeof createUploader>;
