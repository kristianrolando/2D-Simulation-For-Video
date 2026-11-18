// Offline renderer: runs a scene in Node with @napi-rs/canvas (Skia), pipes RGBA frames into ffmpeg
// (H.264 High, yuv420p, BT.709, 60 fps) and muxes the procedural soundtrack, loudness-normalised (EBU R128).
import './host.ts'; // bundled fonts + style themes
import { createCanvas } from '@napi-rs/canvas';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, type Env, type Ctx } from '../../packages/core/index.ts';
import { toWav } from '../../packages/audio/index.ts';
import { setSampleBank, parseWav, type Manifest } from '../../packages/audio/bank.ts';
import { sceneById } from '../../packages/scenes/index.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// sound library: decoded once per process, then shared by every job (scenes fall back to synthesis per role)
loadSampleLibrary();
export function loadSampleLibrary() {
  const man = path.join(ROOT, 'assets/sfx/manifest.json');
  if (!fs.existsSync(man)) { setSampleBank([]); return 0; }
  const m: Manifest = JSON.parse(fs.readFileSync(man, 'utf8'));
  const list = m.samples.filter(s => fs.existsSync(path.join(ROOT, 'assets/sfx', s.file)))
    .map(s => parseWav(new Uint8Array(fs.readFileSync(path.join(ROOT, 'assets/sfx', s.file))), s.id, s.role));
  setSampleBank(list);
  return list.length;
}

export interface Job { sceneId: string; params?: Record<string, unknown>; out: string; crf?: number; preset?: string; hashFile?: string; pngAt?: number[]; pngDir?: string; noVideo?: boolean; noAudio?: boolean; maxFrames?: number }
export interface Progress { frame: number; frames: number; fps: number; phase: 'audio' | 'video' | 'mux' | 'done' }

export async function renderJob(job: Job, onProgress: (p: Progress) => void = () => {}) {
  const scene = sceneById(job.sceneId);
  if (!scene) throw new Error(`unknown scene ${job.sceneId}`);
  const { params, errors } = validate(scene.schema, job.params ?? {});
  const { width: W, height: H, fps } = scene.meta;
  const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: 1 };
  const t0 = performance.now();
  const inst = scene.create(env, params);
  const frames = Math.min(inst.frames, job.maxFrames ?? Infinity);
  const timing = { setupMs: performance.now() - t0, audioMs: 0, drawMs: 0, encodeWaitMs: 0 };
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  // the fully-resolved job is what makes a render reproducible: same JSON => same MP4
  if (!job.noVideo) fs.writeFileSync(job.out.replace(/\.mp4$/, '') + '.job.json', JSON.stringify({ sceneId: scene.meta.id, params }, null, 2) + '\n');

  // ---- audio ----
  let wav: string | null = null, gainDb: number | null = null, measuredLufs: number | null = null;
  if (!job.noVideo && !job.noAudio) {
    onProgress({ frame: 0, frames, fps: 0, phase: 'audio' });
    const a = performance.now();
    wav = job.out.replace(/\.mp4$/, '') + '.wav';
    fs.writeFileSync(wav, toWav(scene.audio(params)));
    const log = spawnSync('ffmpeg', ['-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
    const m = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(log);
    if (m) { measuredLufs = parseFloat(m[1]); gainDb = scene.meta.loudness - measuredLufs; }
    timing.audioMs = performance.now() - a;
  }

  // ---- video ----
  let ff: ReturnType<typeof spawn> | null = null, ffErr = '';
  if (!job.noVideo) {
    const args = ['-v', 'error', '-y', '-probesize', '50M',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
      ...(wav ? ['-i', wav] : []),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', job.preset ?? 'medium', '-crf', String(job.crf ?? 17),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
      ...(wav ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest', ...(gainDb != null ? ['-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.95:level=false`] : [])] : []),
      '-movflags', '+faststart', '-r', String(fps), job.out];
    ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr!.on('data', d => { ffErr += d; });
  }
  const write = (buf: Buffer) => new Promise<void>((res, rej) => {
    if (!ff || !ff.stdin) return res();
    ff.stdin.write(buf, e => (e ? rej(e) : undefined));
    if (ff.stdin.writableNeedDrain) ff.stdin.once('drain', () => res()); else res();
  });
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d') as unknown as Ctx;
  const hashes: string[] = []; const all = createHash('sha256');
  const pngFrames = new Map((job.pngAt ?? []).map(t => [Math.min(frames - 1, Math.round(t * fps)), t]));
  if (pngFrames.size) fs.mkdirSync(job.pngDir!, { recursive: true });
  const loop = performance.now();
  for (let i = 0; i < frames; i++) {
    const a = performance.now();
    inst.renderFrame(ctx, i);
    timing.drawMs += performance.now() - a;
    const data = canvas.data();
    if (job.hashFile) { const h = createHash('sha1').update(data).digest('hex'); hashes.push(h); all.update(h); }
    if (pngFrames.has(i)) fs.writeFileSync(path.join(job.pngDir!, `t${pngFrames.get(i)}.png`), await canvas.encode('png'));
    const b = performance.now();
    await write(Buffer.from(data));
    timing.encodeWaitMs += performance.now() - b;
    if (i % 30 === 0 || i === frames - 1) onProgress({ frame: i + 1, frames, fps: (i + 1) / ((performance.now() - loop) / 1000), phase: 'video' });
  }
  if (ff) {
    onProgress({ frame: frames, frames, fps: 0, phase: 'mux' });
    ff.stdin!.end();
    const code: number = await new Promise(r => ff!.on('close', r));
    if (code !== 0) throw new Error('ffmpeg failed: ' + ffErr.trim().split('\n').slice(-3).join(' | '));
  }
  if (job.hashFile) fs.writeFileSync(job.hashFile, hashes.map((h, i) => `${i} ${h}`).join('\n') + '\n');
  if (wav && fs.existsSync(wav)) fs.unlinkSync(wav);
  const total = (performance.now() - t0) / 1000;
  onProgress({ frame: frames, frames, fps: frames / total, phase: 'done' });
  return {
    scene: scene.meta.id, frames, out: job.noVideo ? null : path.relative(ROOT, job.out), paramErrors: errors,
    setupMs: +timing.setupMs.toFixed(1), audioMs: +timing.audioMs.toFixed(1), drawMsPerFrame: +(timing.drawMs / frames).toFixed(2),
    encodeWaitMsPerFrame: +(timing.encodeWaitMs / frames).toFixed(2), totalSec: +total.toFixed(2),
    realtimeFactor: +((frames / fps) / total).toFixed(2), measuredLufs, targetLufs: scene.meta.loudness, gainDb,
    ...(job.hashFile ? { framesSha256: all.digest('hex') } : {}),
    diagnostics: inst.diagnostics?.() ?? null,
  };
}
