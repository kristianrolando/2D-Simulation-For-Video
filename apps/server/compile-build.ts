// The long-video builder: turns a list of finished Shorts (1080×1920) into one 1920×1080 MP4. It runs in its own process
// (apps/server/compile-worker.ts) and only reads output/; it never touches the render engine or the source videos.
//
//   1. every clip is normalised ONCE into a cache file: the Short is centred at full height, the sides are filled with a dark blur of the
//      clip itself, and its number is drawn over the first two seconds. Exact frame count, 60 fps, H.264. A cache file is trusted only if
//      ffprobe still finds the expected size and frame count, so a half-written file is never reused.
//   2. every clip's sound is kept as it is (only a gentle gain to a common loudness, a 60 ms fade at both ends so a cut never clicks) and
//      stored as WAV of exactly frames × 735 samples.
//   3. the cache files are joined without re-encoding; the WAVs are joined and encoded to AAC once (no AAC seams); written as <out>.part.
//   4. the result is checked (size, fps, codecs, frame count, duration, a full decode, black frames) and only then renamed to <out>.
//
// Stop it any time (kill the process group): the next run reuses every finished clip and starts again from the first unfinished one.
import './host.ts'; // bundled fonts for the number badge
import { createCanvas } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { processAlive } from './job-store.ts';
import { FPS, OUT_W, OUT_H, SAMPLE_RATE, SAMPLES_PER_FRAME, clipCacheName, hash8, RECIPE, totalFrames } from '../../packages/compile/index.ts';

export interface BuildClip { videoId: string; /** absolute path of the Short */ file: string; label: string }
export interface BuildRequest { compilationId: string; /** absolute path of the finished MP4 */ out: string; cacheDir: string; clips: BuildClip[] }
export interface BuildProgress { frame: number; frames: number; fps: number; phase: 'normalize' | 'concat' | 'verify' | 'done' }
export interface BuildReport {
  durationSec: number; frames: number; sizeBytes: number; clipFrames: number[]; made: number; reused: number; checks: string[];
  /** what the check found; empty when everything is fine */
  problems: string[];
}
/** the loudness every clip is brought to (LUFS) and how far the gain may go */
export const TARGET_LUFS = -16, MAX_GAIN_DB = 9, MIN_GAIN_DB = -6, FADE_SEC = 0.06;
/** cache files of the clips: how far the work has come, in steps; a clip is worth CLIP_STEPS, joining and checking the rest */
const CLIP_STEPS = 10, JOIN_STEPS = 4, CHECK_STEPS = 8;
export const stepsOf = (clips: number) => clips * CLIP_STEPS + JOIN_STEPS + CHECK_STEPS;

/** run ffmpeg/ffprobe; resolves with stdout and stderr, rejects with the last error lines */
export function run(cmd: string, args: string[], opts: { signal?: AbortSignal } = {}): Promise<{ out: string; err: string }> {
  return new Promise((ok, bad) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    opts.signal?.addEventListener('abort', () => c.kill('SIGKILL'));
    c.on('error', e => bad(new Error(`${cmd} could not be started: ${e.message}`)));
    c.on('close', code => (code === 0 ? ok({ out, err }) : bad(new Error(`${cmd} failed: ${(err.trim().split('\n').slice(-3).join(' | ')) || `exit ${code}`}`))));
  });
}

export interface Facts { width: number; height: number; fps: string; frames: number; durationSec: number; vcodec: string; pix: string; acodec: string; sampleRate: number; channels: number; audioDurationSec: number; sizeBytes: number }
/** what is really in a file (never what it says in the list) */
export async function probeFile(file: string): Promise<Facts> {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const j = JSON.parse(out), v = j.streams?.find((s: { codec_type: string }) => s.codec_type === 'video') ?? {}, a = j.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio') ?? {};
  const dur = Number(v.duration) || Number(j.format?.duration) || 0;
  const fr = Number(v.nb_frames);
  return {
    width: v.width ?? 0, height: v.height ?? 0, fps: String(v.r_frame_rate ?? ''), frames: Number.isFinite(fr) && fr > 0 ? fr : Math.round(dur * FPS), durationSec: dur,
    vcodec: v.codec_name ?? '', pix: v.pix_fmt ?? '', acodec: a.codec_name ?? '', sampleRate: Number(a.sample_rate) || 0, channels: Number(a.channels) || 0,
    audioDurationSec: Number(a.duration) || 0, sizeBytes: Number(j.format?.size) || 0,
  };
}

// ---------------- the number badge ----------------
/** a transparent 1920×1080 picture with the clip's number and name in the left blank area (the Short itself fills the middle) */
export function drawBadge(number: number, label: string): Buffer {
  const c = createCanvas(OUT_W, OUT_H), x = c.getContext('2d'), cx = 328; // the left blank area is 0…656 wide
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  const num = `#${String(number).padStart(2, '0')}`;
  x.font = 'bold 190px DejaVuSansBold'; x.lineWidth = 20; x.strokeStyle = 'rgba(2,12,24,0.92)'; x.strokeText(num, cx, 470); x.fillStyle = '#ffd23f'; x.fillText(num, cx, 470);
  x.font = 'bold 44px DejaVuSansBold'; x.lineWidth = 9; x.strokeStyle = 'rgba(2,12,24,0.92)';
  const words = label.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width <= 560 || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  lines.slice(0, 3).forEach((l, i) => { const y = 600 + i * 54; x.strokeText(l, cx, y); x.fillStyle = '#eef2ff'; x.fillText(l, cx, y); });
  return c.toBuffer('image/png');
}

// ---------------- one clip ----------------
const BG = 'scale=240:136:force_original_aspect_ratio=increase,crop=240:135,gblur=sigma=5:steps=2,scale=1920:1080:flags=bicubic,eq=brightness=0.02:saturation=1.7:gamma=1.15';
export function clipArgs(src: string, badge: string, frames: number, out: string): string[] {
  const fg = `[0:v]split[a][b];[a]${BG}[bg];[b]scale=-2:${OUT_H}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0[base];`
    + `[1:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=1.5:d=0.35:alpha=1[bd];[base][bd]overlay=0:0:eof_action=pass,format=yuv420p[v]`;
  return ['-v', 'error', '-y', '-i', src, '-loop', '1', '-framerate', String(FPS), '-t', '2', '-i', badge, '-filter_complex', fg, '-map', '[v]', '-an', '-r', String(FPS), '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-f', 'mp4', out];
}
/** integrated loudness of a file's audio in LUFS (null when it has none) */
export async function loudness(file: string): Promise<number | null> {
  try { const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-']); const m = /Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/.exec(err); return m ? Number(m[1]) : null; } catch { return null; }
}
export const gainFor = (lufs: number | null) => (lufs === null ? 0 : Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, TARGET_LUFS - lufs)));
export function audioArgs(src: string, frames: number, gainDb: number, out: string): string[] {
  const samples = frames * SAMPLES_PER_FRAME, dur = frames / FPS;
  const af = `aresample=${SAMPLE_RATE},aformat=sample_fmts=s16:channel_layouts=stereo,volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.891:attack=2:release=50:level=disabled,`
    + `afade=t=in:st=0:d=${FADE_SEC},afade=t=out:st=${(dur - FADE_SEC).toFixed(4)}:d=${FADE_SEC},apad=whole_len=${samples},atrim=end_sample=${samples}`;
  return ['-v', 'error', '-y', '-i', src, '-vn', '-af', af, '-c:a', 'pcm_s16le', '-ar', String(SAMPLE_RATE), '-ac', '2', '-f', 'wav', out];
}
/** the number of samples in a WAV (ffprobe), 0 when unreadable; the header size varies, so the file size cannot be compared */
export async function wavSamples(file: string): Promise<number> {
  try { const { out } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration_ts,sample_rate,channels', '-of', 'json', file]); const s = JSON.parse(out).streams?.[0]; return s && Number(s.sample_rate) === SAMPLE_RATE && Number(s.channels) === 2 ? Number(s.duration_ts) || 0 : 0; } catch { return 0; }
}
const wavName = (c: BuildClip, size: number, mtimeMs: number) => `aud-${c.videoId}-${hash8(JSON.stringify([RECIPE, size, Math.round(mtimeMs), TARGET_LUFS]))}.wav`;
const partOf = (f: string) => f.replace(/(\.\w+)$/, '.part$1');
const rm = (f: string) => { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } };

/** Make (or reuse) the cache files of one clip. Returns the 16:9 clip, its WAV and its exact frame count. */
export async function prepareClip(clip: BuildClip, position: number, count: number, cacheDir: string, signal?: AbortSignal): Promise<{ video: string; audio: string; frames: number; reused: boolean }> {
  const st = fs.statSync(clip.file), src = await probeFile(clip.file);
  if (src.width !== 1080 || src.height !== 1920) throw new Error(`${path.basename(clip.file)} is ${src.width}×${src.height}, not 1080×1920.`);
  const frames = src.frames; if (!(frames > 0)) throw new Error(`${path.basename(clip.file)} has no video frames.`);
  const video = path.join(cacheDir, clipCacheName({ videoId: clip.videoId, label: clip.label }, { sizeBytes: st.size, mtimeMs: st.mtimeMs }, position, count)), audio = path.join(cacheDir, wavName(clip, st.size, st.mtimeMs));
  let reused = true;
  const videoOk = async () => { try { const f = await probeFile(video); return f.width === OUT_W && f.height === OUT_H && f.frames === frames && f.vcodec === 'h264'; } catch { return false; } };
  if (!(await videoOk())) {
    reused = false; const badge = path.join(cacheDir, `badge-${clip.videoId}-${position}.png`), tmp = partOf(video);
    fs.writeFileSync(badge, drawBadge(position, clip.label));
    try { await run('ffmpeg', clipArgs(clip.file, badge, frames, tmp), { signal }); const f = await probeFile(tmp); if (f.frames !== frames || f.width !== OUT_W || f.height !== OUT_H) throw new Error(`The prepared clip of ${path.basename(clip.file)} has ${f.frames} frames instead of ${frames}.`); fs.renameSync(tmp, video); }
    finally { rm(badge); rm(tmp); }
  }
  const audioOk = (await wavSamples(audio)) === frames * SAMPLES_PER_FRAME;
  if (!audioOk) {
    reused = false; const tmp = partOf(audio);
    try { await run('ffmpeg', audioArgs(clip.file, frames, gainFor(await loudness(clip.file)), tmp), { signal }); if ((await wavSamples(tmp)) !== frames * SAMPLES_PER_FRAME) throw new Error(`The audio of ${path.basename(clip.file)} does not have the expected length.`); fs.renameSync(tmp, audio); }
    finally { rm(tmp); }
  }
  return { video, audio, frames, reused };
}

// ---------------- join + check ----------------
const listLine = (f: string) => `file '${f.replace(/'/g, `'\\''`)}'`;
export function joinArgs(videoList: string, audioList: string, out: string): string[] {
  return ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', videoList, '-f', 'concat', '-safe', '0', '-i', audioList, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE), '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', out];
}
/** the checks on a finished long video; [] = fine. `expectedFrames` is the sum of the clips' frames. */
export async function verifyOutput(file: string, expectedFrames: number, signal?: AbortSignal): Promise<{ problems: string[]; facts: Facts }> {
  const f = await probeFile(file), p: string[] = [], dur = expectedFrames / FPS;
  if (f.width !== OUT_W || f.height !== OUT_H) p.push(`The video is ${f.width}×${f.height}, not ${OUT_W}×${OUT_H}.`);
  if (f.fps !== `${FPS}/1`) p.push(`The frame rate is ${f.fps}, not ${FPS}.`);
  if (f.vcodec !== 'h264' || f.pix !== 'yuv420p') p.push(`The picture is ${f.vcodec}/${f.pix}, not H.264 yuv420p.`);
  if (f.acodec !== 'aac' || f.sampleRate !== SAMPLE_RATE || f.channels !== 2) p.push(`The sound is ${f.acodec} ${f.sampleRate} Hz ${f.channels} ch, not AAC ${SAMPLE_RATE} Hz stereo.`);
  if (f.frames !== expectedFrames) p.push(`The video has ${f.frames} frames, the clips add up to ${expectedFrames}.`);
  if (Math.abs(f.durationSec - dur) > 0.1) p.push(`The video is ${f.durationSec.toFixed(2)} s, expected ${dur.toFixed(2)} s.`);
  if (Math.abs(f.audioDurationSec - f.durationSec) > 0.1) p.push(`The sound is ${f.audioDurationSec.toFixed(2)} s but the picture ${f.durationSec.toFixed(2)} s.`);
  // one full decode: any decoder complaint means a damaged seam; real black frames (not just a dark scene) are reported too
  try {
    const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.1:pix_th=0.03:pic_th=0.995', '-f', 'null', '-'], { signal });
    const lines = err.split('\n');
    const bad = lines.filter(l => /error|invalid|corrupt|non-monotonic|missing reference|concealing/i.test(l) && !/blackdetect/.test(l));
    if (bad.length) p.push(`The decoder reported ${bad.length} problem(s): ${bad[0].trim().slice(0, 140)}`);
    const black = lines.filter(l => /black_start/.test(l));
    if (black.length) p.push(`${black.length} stretch(es) of black frames: ${black[0].replace(/^.*(black_start)/, '$1').trim().slice(0, 100)}`);
  } catch (e) { p.push(`The decode check failed: ${(e as Error).message}`); }
  return { problems: p, facts: f };
}

/** One builder at a time: two builds writing the same cache would trip over each other (and each wants every core). The lock is a file
 *  holding the pid of the builder; a lock whose process is gone (a killed build) is stale and is taken over. */
export function takeBuilderLock(cacheDir: string, pid = process.pid, alive: (p: number) => boolean = processAlive): () => void {
  fs.mkdirSync(cacheDir, { recursive: true });
  const f = path.join(cacheDir, '.builder.lock');
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, String(pid)); fs.closeSync(fd); return () => { try { if (fs.readFileSync(f, 'utf8').trim() === String(pid)) fs.rmSync(f, { force: true }); } catch { /* gone */ } }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const holder = Number((() => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })().trim());
    if (Number.isInteger(holder) && holder > 1 && holder !== pid && alive(holder)) throw new Error(`Another long-video build is already running (process ${holder}). Wait for it to finish.`);
    try { fs.rmSync(f, { force: true }); } catch { /* retry */ }
  }
  throw new Error('Could not take the long-video build lock.');
}

/** Build the whole long video. `onProgress` is called after every step; throws when something is wrong (the cache stays for next time). */
export async function buildCompilation(req: BuildRequest, onProgress: (p: BuildProgress) => void = () => {}, signal?: AbortSignal): Promise<BuildReport> {
  const release = takeBuilderLock(req.cacheDir);
  try { return await buildLocked(req, onProgress, signal); } finally { release(); }
}
async function buildLocked(req: BuildRequest, onProgress: (p: BuildProgress) => void, signal?: AbortSignal): Promise<BuildReport> {
  fs.mkdirSync(req.cacheDir, { recursive: true }); fs.mkdirSync(path.dirname(req.out), { recursive: true });
  for (const f of fs.readdirSync(req.cacheDir)) if (/\.part\.\w+$/.test(f) || /^badge-.*\.png$/.test(f)) rm(path.join(req.cacheDir, f)); // leftovers of a killed run
  const steps = stepsOf(req.clips.length); let done = 0;
  const tick = (phase: BuildProgress['phase'], by: number) => { done += by; onProgress({ frame: done, frames: steps, fps: 0, phase }); };
  onProgress({ frame: 0, frames: steps, fps: 0, phase: 'normalize' });
  const made: Awaited<ReturnType<typeof prepareClip>>[] = [];
  for (let i = 0; i < req.clips.length; i++) { made.push(await prepareClip(req.clips[i], i + 1, req.clips.length, req.cacheDir, signal)); tick('normalize', CLIP_STEPS); }
  const frames = made.map(m => m.frames), total = totalFrames(frames.map(f => ({ frames: f })));
  const work = path.join(req.cacheDir, `join-${req.compilationId}`); fs.mkdirSync(work, { recursive: true });
  const vl = path.join(work, 'video.txt'), al = path.join(work, 'audio.txt'), tmp = req.out + '.part';
  fs.writeFileSync(vl, made.map(m => listLine(m.video)).join('\n') + '\n'); fs.writeFileSync(al, made.map(m => listLine(m.audio)).join('\n') + '\n');
  try {
    onProgress({ frame: done, frames: steps, fps: 0, phase: 'concat' });
    await run('ffmpeg', joinArgs(vl, al, tmp), { signal }); tick('concat', JOIN_STEPS);
    onProgress({ frame: done, frames: steps, fps: 0, phase: 'verify' });
    const { problems, facts } = await verifyOutput(tmp, total, signal);
    if (problems.length) throw new Error(`The finished video did not pass the check: ${problems.join(' ')}`);
    fs.renameSync(tmp, req.out); tick('verify', CHECK_STEPS);
    onProgress({ frame: steps, frames: steps, fps: 0, phase: 'done' });
    return { durationSec: total / FPS, frames: total, sizeBytes: fs.statSync(req.out).size, clipFrames: frames, made: made.filter(m => !m.reused).length, reused: made.filter(m => m.reused).length, problems: [],
      checks: [`${facts.width}×${facts.height} · ${facts.fps} · ${facts.vcodec} ${facts.pix} · ${facts.acodec} ${facts.sampleRate} Hz ${facts.channels} ch`, `${facts.frames} frames = sum of the clips`, 'full decode without errors', 'no black frames'] };
  } finally { rm(tmp); fs.rmSync(work, { recursive: true, force: true }); }
}
