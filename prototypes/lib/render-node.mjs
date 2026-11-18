#!/usr/bin/env node
// Offline renderer: runs a scene module in Node with @napi-rs/canvas (Skia), pipes raw RGBA
// frames into ffmpeg (H.264 High, yuv420p, BT.709, 60 fps) and muxes procedurally synthesised audio.
//
// usage: node prototypes/lib/render-node.mjs <scene.js> [--out file.mp4] [--frames N]
//        [--hash hashes.txt] [--png 0,2.5,10 --pngdir dir] [--no-video] [--params '{"k":v}']
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toWav } from './audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts/DejaVuSans-Bold.ttf'), 'DejaVuSansBold');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const scenePath = path.resolve(args[0]);
const scene = await import(pathToFileURL(scenePath).href);
const params = JSON.parse(opt('--params', '{}'));
const { width: W, height: H, fps, duration } = scene.meta;
const totalFrames = Math.round(duration * fps);
const limit = Math.min(totalFrames, +opt('--frames', totalFrames));
const out = opt('--out', path.join(ROOT, 'prototypes/output', scene.meta.id + '.mp4'));
const hashFile = opt('--hash', null);
const pngTimes = opt('--png', '') ? opt('--png').split(',').map(Number) : [];
const pngFrames = new Map(pngTimes.map(t => [Math.min(limit - 1, Math.round(t * fps)), t]));
const pngDir = opt('--pngdir', path.join(ROOT, 'prototypes/output/frames', scene.meta.id));
const noVideo = flag('--no-video');

const env = { createCanvas: (w, h) => createCanvas(w, h) };
const timing = { setup: 0, audio: 0, draw: 0, readback: 0, encodeWait: 0 };
let t = performance.now();
const inst = scene.create(env, params);
timing.setup = performance.now() - t;

fs.mkdirSync(path.dirname(out), { recursive: true });
let wavPath = null, audioGainDb = null;
if (!noVideo && !flag('--no-audio') && scene.renderAudio) {
  t = performance.now();
  const mix = scene.renderAudio(params);
  wavPath = out.replace(/\.mp4$/, '.wav');
  fs.writeFileSync(wavPath, toWav(mix));
  // two-pass loudness normalisation: measure integrated loudness (EBU R128), then apply a fixed gain
  const target = scene.meta.loudness ?? -18;
  const { spawnSync } = await import('node:child_process');
  const log = spawnSync('ffmpeg', ['-nostats', '-i', wavPath, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
  audioGainDb = null;
  const m = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(log);
  timing.audio = performance.now() - t;
  if (m) audioGainDb = target - parseFloat(m[1]);
}

let ff = null;
if (!noVideo) {
  const ffArgs = ['-v', 'error', '-y', '-probesize', '50M',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
    ...(wavPath ? ['-i', wavPath] : []),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '17',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    ...(wavPath ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest', ...(audioGainDb != null ? ['-af', `volume=${audioGainDb.toFixed(2)}dB,alimiter=limit=0.95:level=false`] : [])] : []),
    '-movflags', '+faststart', '-r', String(fps), out];
  ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
}
const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const hashes = [];
const overall = createHash('sha256');
if (pngFrames.size) fs.mkdirSync(pngDir, { recursive: true });

const t0 = performance.now();
for (let i = 0; i < limit; i++) {
  let a = performance.now();
  inst.renderFrame(ctx, i);
  let b = performance.now(); timing.draw += b - a;
  const data = canvas.data();
  if (hashFile) { const h = createHash('sha1').update(data).digest('hex'); hashes.push(h); overall.update(h); }
  if (pngFrames.has(i)) fs.writeFileSync(path.join(pngDir, `t${pngFrames.get(i)}.png`), await canvas.encode('png'));
  a = performance.now(); timing.readback += a - b;
  if (ff) { await write(Buffer.from(data)); timing.encodeWait += performance.now() - a; }
}
const wall = performance.now() - t0;
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
const total = performance.now() - t0;
if (hashFile) fs.writeFileSync(hashFile, hashes.map((h, i) => `${i} ${h}`).join('\n') + '\n');

const report = {
  scene: scene.meta.id, frames: limit, out: noVideo ? null : path.relative(ROOT, out),
  setupMs: +timing.setup.toFixed(1), audioMs: +timing.audio.toFixed(1),
  drawMsPerFrame: +(timing.draw / limit).toFixed(2), readbackMsPerFrame: +(timing.readback / limit).toFixed(2),
  encodeWaitMsPerFrame: +(timing.encodeWait / limit).toFixed(2),
  loopSec: +(wall / 1000).toFixed(2), totalSec: +(total / 1000).toFixed(2), renderFps: +(limit / (total / 1000)).toFixed(1),
  realtimeFactor: +((limit / fps) / (total / 1000)).toFixed(2),
  ...(hashFile ? { framesSha256: overall.digest('hex') } : {}),
  ...(audioGainDb != null ? { audioGainDb: +audioGainDb.toFixed(2), loudnessTarget: scene.meta.loudness ?? -18 } : {}),
  ...(inst.report ? inst.report() : {}),
};
console.log(JSON.stringify(report, null, 1));
