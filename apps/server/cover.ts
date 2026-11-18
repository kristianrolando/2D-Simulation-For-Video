// Cover and thumbnail maker. Picks the best frame of a rendered MP4 (ffmpeg samples a few dozen small frames; the choice
// itself is pure and lives in packages/publish/cover.ts), then draws two pictures in the video's own style:
//   1080×1920  the Shorts thumbnail (the frame, the hook text in the safe zone). THIS is what YouTube gets for a Short: YouTube
//              crops Shorts thumbnails to 9:16 around the centre, and this picture already is 9:16.
//   1280×720   a wide picture (hook text left, frame as a panel right). NOT sent for Shorts: its centre-crop cuts the text.
// Free and local: ffmpeg + @napi-rs/canvas only. It never touches the render engine; it only reads the finished MP4.
import './host.ts'; // bundled fonts + style themes
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pickBestFrame, sampleTimes, COVER_TALL, COVER_WIDE, type FrameStat, type FramePick, type Box } from '../../packages/publish/cover.ts';
import { rgbaOf, type Theme } from '../../packages/theme/index.ts';

const run = (args: string[], timeoutMs = 90000) => new Promise<Buffer>((ok, bad) => {
  const c = spawn('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const out: Buffer[] = []; let err = '';
  c.stdout.on('data', d => out.push(d)); c.stderr.on('data', d => { err += d; });
  const timer = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
  c.on('error', e => { clearTimeout(timer); bad(e); });
  c.on('close', code => { clearTimeout(timer); code === 0 ? ok(Buffer.concat(out)) : bad(new Error('ffmpeg failed: ' + (err.trim().split('\n').slice(-2).join(' | ') || `exit ${code}`))); });
});

/** one full-size frame as PNG bytes */
export const grabFrame = (mp4: string, t: number) => run(['-ss', String(Math.max(0, t)), '-i', mp4, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);

const SW = 54, SH = 96;
/** Looks at the whole video once (tiny grey frames, a few dozen of them) and returns the best frame's time plus the stats. */
export async function analyseVideo(mp4: string, durationSec: number, climaxSec?: number): Promise<{ pick: FramePick | null; stats: FrameStat[] }> {
  const times = sampleTimes(durationSec);
  if (!times.length) return { pick: null, stats: [] };
  // one pass over the file: n evenly spaced small frames, as raw grey bytes
  const fps = (times.length - 1) / Math.max(0.1, times[times.length - 1] - times[0]);
  const raw = await run(['-ss', String(times[0]), '-i', mp4, '-vf', `fps=${fps.toFixed(6)},scale=${SW}:${SH}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
  const size = SW * SH, n = Math.min(times.length, Math.floor(raw.length / size)), stats: FrameStat[] = [];
  for (let f = 0; f < n; f++) {
    const px = raw.subarray(f * size, (f + 1) * size);
    const sorted = Uint8Array.from(px).sort(), med = sorted[size >> 1];
    let ink = 0, edge = 0;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const v = px[y * SW + x];
      if (Math.abs(v - med) > 24) ink++;
      if (x + 1 < SW) edge += Math.abs(v - px[y * SW + x + 1]);
      if (y + 1 < SH) edge += Math.abs(v - px[(y + 1) * SW + x]);
    }
    stats.push({ t: times[f], detail: edge / size, ink: ink / size });
  }
  return { pick: pickBestFrame(stats, durationSec, climaxSec), stats };
}

// ---------------- drawing ----------------
type Ctx = SKRSContext2D;
const fontOf = (T: Theme, size: number) => `${T.font.weight || '800'} ${size}px ${T.font.family}`;
const wrap = (ctx: Ctx, text: string, maxW: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
};
/** the largest font size at which the text fits the box in at most `maxLines` lines */
function fitText(ctx: Ctx, T: Theme, text: string, box: Box, maxLines: number, maxSize: number, minSize = 44) {
  for (let size = maxSize; size >= minSize; size -= 4) {
    ctx.font = fontOf(T, size); const lines = wrap(ctx, text, box.w);
    if (lines.length <= maxLines && lines.length * size * 1.1 <= box.h && lines.every(l => ctx.measureText(l).width <= box.w)) {
      // same number of lines, but as even as possible (no lonely last word): narrow the wrap width while the line count holds
      let lo = box.w * 0.4, hi = box.w, best = lines;
      for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2, tryLines = wrap(ctx, text, mid); if (tryLines.length <= lines.length && tryLines.every(l => ctx.measureText(l).width <= mid || !l.includes(' '))) { best = tryLines; hi = mid; } else lo = mid; }
      return { size, lines: best };
    }
  }
  ctx.font = fontOf(T, minSize); return { size: minSize, lines: wrap(ctx, text, box.w).slice(0, maxLines) };
}
/** outlined text, the last line in the accent colour, an accent bar underneath; returns the bottom edge it used */
function drawHook(ctx: Ctx, T: Theme, text: string, box: Box, maxLines: number, maxSize: number, align: 'center' | 'left'): number {
  const shown = T.font.case === 'upper' ? text.toUpperCase() : T.font.case === 'lower' ? text.toLowerCase() : text;
  const { size, lines } = fitText(ctx, T, shown, box, maxLines, maxSize);
  const lh = size * 1.1, total = lines.length * lh, top = box.y + (box.h - total) / 2;
  ctx.font = fontOf(T, size); ctx.textBaseline = 'middle'; ctx.textAlign = align; ctx.lineJoin = 'round';
  const x = align === 'center' ? box.x + box.w / 2 : box.x;
  lines.forEach((l, i) => {
    const y = top + lh * (i + 0.5);
    ctx.lineWidth = Math.max(6, size * 0.14); ctx.strokeStyle = T.color.bg[0]; ctx.strokeText(l, x, y);
    ctx.fillStyle = i === lines.length - 1 && lines.length > 1 ? T.color.accent : T.color.text; ctx.fillText(l, x, y);
  });
  const barY = top + total + 14, barW = Math.min(box.w, 150);
  ctx.fillStyle = T.color.accent; ctx.beginPath(); ctx.roundRect(align === 'center' ? box.x + (box.w - barW) / 2 : box.x, barY, barW, 10, 5); ctx.fill();
  return barY + 10;
}
const lum = (data: Uint8ClampedArray, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
/** vertical centre of the busy part of a frame (0..1), ignoring the title strip at the top and the counter at the bottom */
function inkCentre(img: { width: number; height: number }, source: Parameters<Ctx['drawImage']>[0]): number {
  const w = 54, h = 96, c = createCanvas(w, h), x = c.getContext('2d'); x.drawImage(source, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, vals: number[] = []; for (let i = 0; i < w * h; i++) vals.push(lum(d, i * 4));
  const med = [...vals].sort((a, b) => a - b)[vals.length >> 1]; let sum = 0, wy = 0;
  for (let yy = Math.round(h * 0.2); yy < Math.round(h * 0.88); yy++) for (let xx = 0; xx < w; xx++) { if (Math.abs(vals[yy * w + xx] - med) > 24) { sum++; wy += yy; } }
  void img; return sum ? wy / sum / h : 0.5;
}

export interface CoverResult { thumb: Buffer; cover: Buffer }
/** draws both pictures from one frame (PNG bytes). `text` empty = frame only, no hook text. */
export async function drawCovers(framePng: Buffer, text: string, T: Theme): Promise<CoverResult> {
  const frame = await loadImage(framePng);
  // ---- tall cover 1080×1920
  const C = COVER_TALL, tall = createCanvas(C.w, C.h), a = tall.getContext('2d');
  a.drawImage(frame, 0, 0, C.w, C.h);
  if (text) {
    const g = a.createLinearGradient(0, 0, 0, C.scrimBottom);
    g.addColorStop(0, rgbaOf(T.color.bg[0], 1)); g.addColorStop(0.8, rgbaOf(T.color.bg[0], 1)); g.addColorStop(1, rgbaOf(T.color.bg[0], 0)); // solid where the video's own title and counter sit, then a fade
    a.fillStyle = g; a.fillRect(0, 0, C.w, C.scrimBottom);
    drawHook(a, T, text, C.text, 4, 132, 'center');
  }
  // ---- wide thumbnail 1280×720
  const W = COVER_WIDE, wide = createCanvas(W.w, W.h), b = wide.getContext('2d');
  const bg = b.createLinearGradient(0, 0, W.w, W.h); bg.addColorStop(0, T.color.bg[0]); bg.addColorStop(1, T.color.bg[T.color.bg.length - 1] ?? T.color.bg[0]);
  b.fillStyle = bg; b.fillRect(0, 0, W.w, W.h);
  b.globalAlpha = 0.22; b.drawImage(frame, 0, (W.h - W.w * (frame.height / frame.width)) / 2, W.w, W.w * (frame.height / frame.width)); b.globalAlpha = 1; // the frame, faint, as a texture
  const sh = b.createLinearGradient(0, 0, W.w * 0.62, 0); sh.addColorStop(0, rgbaOf(T.color.bg[0], 0.92)); sh.addColorStop(1, rgbaOf(T.color.bg[0], 0)); b.fillStyle = sh; b.fillRect(0, 0, W.w, W.h);
  const p = W.panel, side = Math.min(frame.width, Math.round(frame.height * 0.56)), cy = inkCentre(frame, frame) * frame.height;
  const sy = Math.max(0, Math.min(frame.height - side, Math.round(cy - side / 2)));
  b.save(); b.beginPath(); b.roundRect(p.x, p.y, p.w, p.h, 26); b.clip(); b.drawImage(frame, Math.round((frame.width - side) / 2), sy, side, side, p.x, p.y, p.w, p.h); b.restore();
  b.lineWidth = 6; b.strokeStyle = T.color.accent; b.beginPath(); b.roundRect(p.x, p.y, p.w, p.h, 26); b.stroke();
  if (text) drawHook(b, T, text, W.text, 5, 104, 'left');
  return { thumb: wide.toBuffer('image/jpeg', 90), cover: tall.toBuffer('image/jpeg', 90) };
}

/** pick (or take) a frame, draw both pictures, write them as `<id>-cover.jpg` (1080×1920, the one uploaded) and `<id>.jpg` (wide, not uploaded) into outDir */
export async function makeCovers(o: { mp4: string; id: string; outDir: string; theme: Theme; text: string; t?: number; /** needed only when the frame is picked automatically */ durationSec?: number; climaxSec?: number }): Promise<{ t: number; thumbFile: string; coverFile: string; reason: string }> {
  let t = o.t, reason = 'the frame you chose';
  if (t === undefined) {
    const { pick } = await analyseVideo(o.mp4, o.durationSec ?? 0, o.climaxSec);
    if (!pick) throw new Error('Could not analyse the video to pick a frame.');
    t = pick.t; reason = pick.reason;
  }
  const { thumb, cover } = await drawCovers(await grabFrame(o.mp4, t), o.text, o.theme);
  fs.mkdirSync(o.outDir, { recursive: true });
  const thumbFile = `${o.id}.jpg`, coverFile = `${o.id}-cover.jpg`;
  for (const [name, buf] of [[thumbFile, thumb], [coverFile, cover]] as const) { const tmp = path.join(o.outDir, name + '.tmp'); fs.writeFileSync(tmp, buf); fs.renameSync(tmp, path.join(o.outDir, name)); }
  return { t, thumbFile, coverFile, reason };
}
