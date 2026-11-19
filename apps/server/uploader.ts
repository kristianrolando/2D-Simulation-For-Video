// One YouTube upload at a time, outside the render queue (renders keep running). Each step is written to the video's
// record in the existing store (atomic, with backups), so it can be continued after a failure or a restart:
//   uploading → processing → thumbnail → finishing → done        (stage 'failed' + failedAt = the step to continue)
// The tracking status stays the one the Videos page already has: Scheduled (publishAt) or Published (made public).
// Never: a second videos.insert for the same record, an automatic retry after a quota error, or any delete call.
// Channels: every call of one upload uses the token of the channel recorded on it (youtube.channelId), and every path that sends
// (start, continue, the quota wait, thumbnail again) first checks that this channel is connected and "Upload from Sim Studio" is on.
import fs from 'node:fs';
import path from 'node:path';
import { patchVideo, localDate, sanitizeYoutube, uploadDescription, fileSig, uploadThumbName, MIN_LEAD_MIN, type Video, type YoutubeState, type UploadOptions, type FileFacts } from '../../packages/publish/index.ts';
import { imageSize, isShortsRatio, THUMB_MAX_BYTES } from '../../packages/publish/cover.ts';
import * as yt from './youtube.ts';
import type { Store } from './store.ts';

export interface Live { videoId: string; stage: string; sent: number; total: number; startedAt: number }
export interface UploaderDeps { store: Store; outDir: string; thumbDir: string; log?: (line: string) => void; /** the default channel name (records without channelId) */ defaultChannel?: string }

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
    // the DAILY quota is the one failure that fixes itself: wait for the reset (by the wall clock) and continue. Anything else waits for the owner.
    const quota = e instanceof yt.YtError && e.kind === 'quota' && e.daily;
    const until = quota ? yt.quotaWaitUntil() : null;
    const text = until ? `${msg} The studio continues by itself after ${whenText(until)}; keep it running. Nothing is uploaded twice.` : msg;
    try { setYt(id, { stage: 'failed', failedAt: step, error: text, waitUntil: until ? until.toISOString() : '' }); } catch { /* read-only or removed */ }
  }
  const whenText = (d: Date) => d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  /** The approved upload could not be started after the quota reset (the file or the schedule changed meanwhile): drop the attempt so the
   *  owner can approve a fresh one, and say why. Nothing was ever created on YouTube in this state. */
  function dropWaiting(id: string, why: string): never {
    write(id, x => { const n = { ...x }; delete n.youtube; return n; });
    try { store.setNotice({ level: 'warn', text: why }); } catch { /* read-only */ }
    log(`youtube: ${id} waiting upload dropped: ${why}`);
    throw new Error(why);
  }
  /** After the daily quota reset: the FIRST and only videos.insert of an upload whose insert was refused for quota (no session, no video id).
   *  Refuses unless it can prove nothing exists yet, the file is the one that was approved, and a schedule is still ≥30 minutes ahead. */
  async function startAfterQuota(id: string) {
    const v = store.get(id)!, y = v.youtube!, mp4 = path.join(deps.outDir, v.file);
    if (y.videoId || yt.hasSession(id)) { setYt(id, { needsSession: false, waitUntil: '' }); return run(id, y.videoId ? 'processing' : 'uploading'); } // something exists after all: continue it, never insert again
    let facts: { size: number; mtime: number } | null = null; try { const st = fs.statSync(mp4); facts = { size: st.size, mtime: st.mtimeMs }; } catch { /* missing */ }
    if (!facts || fileSig({ sizeBytes: facts.size, mtimeMs: facts.mtime }) !== y.fileSig) dropWaiting(id, 'The MP4 changed (or is gone) while the upload waited for the YouTube quota. Nothing was uploaded. Approve a new upload.');
    if (y.mode === 'schedule' && Date.parse(y.publishAt) < Date.now() + MIN_LEAD_MIN * 60e3) dropWaiting(id, `The scheduled time passed (or is under ${MIN_LEAD_MIN} minutes away) while the upload waited for the YouTube quota. Nothing was uploaded. Approve a new upload with a new time.`);
    const meta = metaOf.get(id) ?? metaFromRecord(v);
    setYt(id, { stage: 'uploading', failedAt: '', error: '', waitUntil: '' });
    live = { videoId: id, stage: 'uploading', sent: 0, total: y.total, startedAt: Date.now() };
    try { await yt.startSession(id, mp4, meta, chOf(v)); }
    catch (e) {
      live = null;
      if (e instanceof yt.YtError && e.kind === 'quota' && e.daily) { fail(id, 'uploading', e); return; } // refused again: wait for the next reset
      const msg = e instanceof yt.YtError ? e.message : yt.redact(e instanceof Error ? e.message : String(e));
      setYt(id, { stage: 'failed', failedAt: 'uploading', needsSession: true, error: `${msg} Nothing was uploaded. Press Continue to try again.` });
      return;
    }
    live = null;
    setYt(id, { needsSession: false });
    return run(id, 'start');
  }

  /** Steps from `from` to the end. Each step is safe to repeat except the upload, which only ever continues its own session. */
  async function run(id: string, from: YoutubeState['failedAt'] | 'start') {
    const v0 = store.get(id)!, mp4 = path.join(deps.outDir, v0.file), meta = metaOf.get(id) ?? metaFromRecord(v0), ch = chOf(v0);
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
          ytId = await yt.findRecentUpload(meta.title, Date.parse(v0.youtube?.uploadedAt || v0.updatedAt), ch);
          if (!ytId) { yt.dropSession(id); setYt(id, { stage: 'failed', failedAt: 'uploading', error: 'The upload did not finish and its session expired. Nothing was published. Upload again (with a new approval) if you want.', videoId: '' });
            // allow a fresh, explicitly approved upload: clear the technical state but keep the record otherwise
            write(id, v => { const n = { ...v }; delete n.youtube; return n; }); live = null; return; }
        }
        yt.dropSession(id);
        setYt(id, { videoId: ytId, stage: 'processing', failedAt: '', error: '', sent: live?.total ?? 0, channelId: ch },
          { youtubeUrl: store.get(id)!.youtubeUrl || `https://www.youtube.com/shorts/${ytId}` });
        log(`youtube: ${id} uploaded as ${ytId}`);
      }
      const ytId = store.get(id)!.youtube!.videoId;
      if (from === 'start' || from === 'uploading' || from === 'processing') {
        step = 'processing'; live!.stage = 'processing';
        await yt.waitProcessed(ytId, waitOpts, ch);
        setYt(id, { stage: 'thumbnail' });
      }
      if (from !== 'finishing') {
        step = 'thumbnail'; live!.stage = 'thumbnail';
        const cur = store.get(id)!;
        let pic: ReturnType<typeof thumbToSend> = null, picError: unknown = null;
        try { pic = thumbToSend(cur); } catch (e) { picError = e; }
        if (picError || pic) {
          try { if (picError) throw picError; await yt.setThumbnail(ytId, pic!.file, ch); setYt(id, { thumbnail: 'set', thumbSent: pic!.name, stage: 'finishing' }); }
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
        await yt.makePublic(ytId, meta, ch);
        setYt(id, { stage: 'done', failedAt: '', error: '' }, { status: 'published', publishedAt: localDate() });
      } else setYt(id, { stage: 'done', failedAt: '', error: '' }, { status: 'scheduled', scheduledAt: utcToLocal(cur.youtube!.publishAt) });
      log(`youtube: ${id} done (${cur.youtube!.mode})`);
    } catch (e) { fail(id, step, e); }
    finally { live = null; }
  }
  const waitOpts = { every: Number(process.env.SIM_YT_POLL_MS) || 20e3, max: 15 * 60e3 };

  /** the channel an upload record belongs to: the one recorded when it started (older records: the video's own connection) */
  function chOf(v: Video): string { return v.youtube?.channelId || yt.connectionFor(v, deps.defaultChannel ?? 'Photon Lab')?.id || ''; }

  function metaFromRecord(v: Video): yt.UploadMeta {
    const d = yt.status().defaults, o = v.youtube?.opts; // the owner's approved choices win over today's defaults
    return { title: v.title, description: uploadDescription(v), tags: v.tags, categoryId: o?.categoryId || d.categoryId, language: o?.language || d.language, madeForKids: o ? o.madeForKids : d.madeForKids, synthetic: o ? o.synthetic : d.synthetic, notify: o ? o.notify : d.notify, publishAt: v.youtube?.publishAt ?? '' };
  }

  return {
    live: () => live,
    busy: () => !!live,
    /** a fresh, approved upload (the caller has checked readiness and consent) */
    async start(v: Video, f: FileFacts, o: UploadOptions, channelId: string) {
      if (live) throw new Error('Another upload is running. Wait until it has finished.');
      const ch = yt.assertCanUpload(channelId); // connected, switched on — or a clear refusal, before anything is recorded
      const publishAt = o.mode === 'schedule' ? localToUtc(o.at) : '';
      const meta: yt.UploadMeta = { title: v.title, description: uploadDescription(v), tags: v.tags, categoryId: o.categoryId, language: o.language, madeForKids: o.madeForKids, synthetic: o.synthetic, notify: o.notify, publishAt };
      metaOf.set(v.id, meta);
      // record first (so a crash right after leaves a trace), then open the session: exactly one videos.insert
      write(v.id, x => ({ ...x, channelId: ch.id, channel: ch.name })); // from now on the video belongs to this channel (locked)
      setYt(v.id, { videoId: '', channelId: ch.id, channelName: ch.name, stage: 'uploading', failedAt: '', mode: o.mode, publishAt, uploadedAt: new Date().toISOString(), thumbnail: 'pending', thumbSent: '', fileSig: fileSig(f), error: '', sent: 0, total: f.sizeBytes, autoPublished: false, waitUntil: '', needsSession: false,
        opts: { categoryId: o.categoryId, language: o.language, madeForKids: o.madeForKids, synthetic: o.synthetic, notify: o.notify } });
      live = { videoId: v.id, stage: 'uploading', sent: 0, total: f.sizeBytes, startedAt: Date.now() };
      try { await yt.startSession(v.id, path.join(deps.outDir, v.file), meta, ch.id); }
      catch (e) {
        live = null;
        if (e instanceof yt.YtError && e.kind === 'quota' && e.daily) {
          // refused for the daily quota BEFORE anything was created: keep the approved upload and start it after the reset
          const until = yt.quotaWaitUntil();
          setYt(v.id, { stage: 'failed', failedAt: 'uploading', needsSession: true, waitUntil: until.toISOString(), error: `${e.message} Nothing was uploaded. The studio starts this upload by itself after ${whenText(until)}; keep it running.` });
          log(`youtube: ${v.id} waits for the quota reset (${until.toISOString()})`);
          return;
        }
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
      yt.assertCanUpload(chOf(v)); // the channel it was sent to: still connected and switched on (never another one)
      if (y.needsSession) { void startAfterQuota(v.id).catch(e => log(`youtube: ${v.id}: ${yt.redact(e instanceof Error ? e.message : String(e))}`)); return; }
      const from = y.stage === 'failed' ? y.failedAt || 'uploading' : y.stage === 'uploading' ? 'uploading' : y.stage as YoutubeState['failedAt'];
      if (from === 'uploading' && !y.videoId && !yt.hasSession(v.id)) throw new Error('There is no upload session left to continue.');
      setYt(v.id, { stage: from === 'uploading' ? 'uploading' : from === 'processing' ? 'processing' : from === 'thumbnail' ? 'thumbnail' : 'finishing', failedAt: '', error: '', waitUntil: '' });
      void run(v.id, from);
    },
    /** Put the right (tall 9:16) thumbnail on a video that is already on YouTube. Costs 50 quota units and changes the channel,
     *  so the caller needs the owner's explicit approval first. Touches nothing else: no status, schedule or privacy change. */
    async replaceThumbnail(v: Video) {
      if (live) throw new Error('Another upload is running. Wait until it has finished.');
      const y = v.youtube; if (!y?.videoId) throw new Error('This video is not on YouTube.');
      if (y.stage !== 'done') throw new Error('Finish or continue the upload first.');
      yt.assertCanUpload(chOf(v));
      const pic = thumbToSend(v); if (!pic) throw new Error('There is no thumbnail picture to send. Draw it in Videos first.');
      live = { videoId: v.id, stage: 'thumbnail', sent: 0, total: 0, startedAt: Date.now() };
      try {
        await yt.setThumbnail(y.videoId, pic.file, chOf(v));
        setYt(v.id, { thumbnail: 'set', thumbSent: pic.name, error: '' });
        log(`youtube: ${v.id} thumbnail replaced (${pic.name})`);
      } finally { live = null; }
    },
    /** the owner chose to go on without a custom thumbnail after YouTube refused it */
    skipThumbnail(v: Video) {
      if (live) throw new Error('Another upload is running.');
      if (v.youtube?.failedAt !== 'thumbnail') throw new Error('Nothing to skip.');
      yt.assertCanUpload(chOf(v));
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
    /** Uploads waiting for the YouTube daily quota continue once their time has come. Compared with the wall clock (never a timer that
     *  drifts while the Mac sleeps); called every 30 s and at start. Returns how many were continued. */
    tickWaiting(nowMs = Date.now()): number {
      if (live) return 0;
      const due = store.list().find(v => v.youtube?.stage === 'failed' && v.youtube.waitUntil && Date.parse(v.youtube.waitUntil) <= nowMs);
      if (!due) return 0;
      try { this.resume(due); return 1; } catch (e) {
        const msg = yt.redact(e instanceof Error ? e.message : String(e));
        log(`youtube: ${due.id} could not continue by itself: ${msg}`);
        try { setYt(due.id, { waitUntil: '', error: `${msg} It did not continue by itself; nothing was sent.` }); } catch { /* read-only */ } return 0;
      }
    },
    /** Scheduled → Published once YouTube says public (1 unit for ≤50 videos). Never demotes, never twice. */
    async syncPublished(): Promise<number> {
      const due = store.list().filter(v => v.status === 'scheduled' && v.youtube?.videoId && !v.youtube.autoPublished);
      if (!due.length) return 0;
      // read-only (1 unit per channel), each channel with its own token; a channel that is not connected is skipped
      const st: Record<string, string> = {};
      for (const ch of [...new Set(due.map(chOf))]) {
        if (!ch || !yt.connection(ch)?.connected) continue;
        Object.assign(st, await yt.privacyOf(due.filter(v => chOf(v) === ch).map(v => v.youtube!.videoId), ch));
      }
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
