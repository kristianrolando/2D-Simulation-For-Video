// Thumbnail of a long video: 1280×720. A big number (how many simulations) and two or three words on the left, four real frames from the
// videos on the right, in the look of the clips (the style preset the clips were rendered with). Free and local: ffmpeg + @napi-rs/canvas.
// A long video's thumbnail IS this wide picture (YouTube crops only Shorts thumbnails to 9:16).
import './host.ts';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { grabFrame } from './cover.ts';
import { COVER_WIDE, overlaps, type Box } from '../../packages/publish/cover.ts';

export interface Look { bg0: string; bg1: string; accent: string; text: string; glow: string }
export const DEFAULT_LOOK: Look = { bg0: '#031c2e', bg1: '#000509', accent: '#ffd23f', text: '#eef2ff', glow: '#18d6b4' };
const HEX = /^#[0-9a-f]{6}$/i;
/** the colours of the clips: read from the style preset stored in their parameters (the Main-1 look when there is none) */
export function lookOf(params: Record<string, unknown>): Look {
  try {
    const p = JSON.parse(String(params.stylePreset ?? '')), bg: unknown[] = p?.background?.bg ?? [], pick = (x: unknown, d: string) => (typeof x === 'string' && HEX.test(x) ? x : d);
    return { bg0: pick(bg[0], DEFAULT_LOOK.bg0), bg1: pick(bg[bg.length - 1], DEFAULT_LOOK.bg1), accent: pick(p?.look?.accent, DEFAULT_LOOK.accent), text: pick(p?.look?.text, DEFAULT_LOOK.text), glow: pick(p?.background?.wallGlow, DEFAULT_LOOK.glow) };
  } catch { return DEFAULT_LOOK; }
}

/** the layout, in pixels: the text block on the left, a 2×2 grid of squares on the right, clear of YouTube's duration stamp */
export const LONG_THUMB = (() => {
  const W = COVER_WIDE.w, H = COVER_WIDE.h, gap = 16, side = 290, gx = W - 22 - (side * 2 + gap), gy = 28;
  const cells: Box[] = [0, 1, 2, 3].map(i => ({ x: gx + (i % 2) * (side + gap), y: gy + Math.floor(i / 2) * (side + gap), w: side, h: side }));
  return { w: W, h: H, text: { x: 56, y: 30, w: gx - 56 - 30, h: H - 60 } as Box, cells };
})();
/** does the layout keep clear of the duration stamp? (tests keep it honest) */
export const thumbClear = () => LONG_THUMB.cells.every(c => COVER_WIDE.unsafe.every(u => !overlaps(c, u)));

type Ctx = SKRSContext2D;
const FONT = (size: number) => `bold ${size}px DejaVuSansBold`;
function wrapWords(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } }
  if (cur) out.push(cur); return out;
}
/** frames: PNG bytes of full Shorts frames (1080×1920); the arena is cut out of the middle as a square */
export async function drawLongThumb(frames: Buffer[], number: number, words: string, look: Look): Promise<Buffer> {
  const L = LONG_THUMB, c = createCanvas(L.w, L.h), x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, L.w, L.h); bg.addColorStop(0, look.bg0); bg.addColorStop(1, look.bg1); x.fillStyle = bg; x.fillRect(0, 0, L.w, L.h);
  const imgs = await Promise.all(frames.slice(0, 4).map(f => loadImage(f)));
  if (imgs[0]) { x.globalAlpha = 0.2; const s = L.w / imgs[0].width; x.drawImage(imgs[0], 0, (L.h - imgs[0].height * s) / 2, L.w, imgs[0].height * s); x.globalAlpha = 1; }
  const shade = x.createLinearGradient(0, 0, L.w * 0.55, 0); shade.addColorStop(0, look.bg0 + 'ee'); shade.addColorStop(1, look.bg0 + '00'); x.fillStyle = shade; x.fillRect(0, 0, L.w, L.h);
  imgs.forEach((img, i) => {
    const b = L.cells[i], side = Math.min(img.width, img.height * 0.5625), sy = Math.max(0, Math.min(img.height - side, img.height * 0.52 - side / 2)); // the arena sits around the middle; the title and counter are cut off
    x.save(); x.beginPath(); x.roundRect(b.x, b.y, b.w, b.h, 22); x.clip(); x.fillStyle = look.bg0; x.fillRect(b.x, b.y, b.w, b.h);
    x.drawImage(img, (img.width - side) / 2, sy, side, side, b.x, b.y, b.w, b.h); x.restore();
    x.lineWidth = 5; x.strokeStyle = look.glow; x.beginPath(); x.roundRect(b.x, b.y, b.w, b.h, 22); x.stroke();
  });
  // the number: as big as the text block allows
  const T = L.text; x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.lineJoin = 'round';
  let ns = 360; x.font = FONT(ns); while (x.measureText(String(number)).width > T.w && ns > 120) { ns -= 8; x.font = FONT(ns); }
  const ny = T.y + ns * 0.86;
  x.lineWidth = Math.max(10, ns * 0.07); x.strokeStyle = look.bg0; x.strokeText(String(number), T.x, ny); x.fillStyle = look.accent; x.fillText(String(number), T.x, ny);
  // the words under it, as large as fit in the remaining height, at most three lines
  const room = T.y + T.h - (ny + 30);
  let ws = 96, lines: string[] = [];
  for (; ws >= 40; ws -= 4) { x.font = FONT(ws); lines = wrapWords(x, words, T.w); if (lines.length <= 3 && lines.length * ws * 1.12 <= room && lines.every(l => x.measureText(l).width <= T.w)) break; }
  x.font = FONT(ws); lines.slice(0, 3).forEach((l, i) => {
    const y = ny + 30 + ws * (0.95 + 1.12 * i);
    x.lineWidth = Math.max(7, ws * 0.14); x.strokeStyle = look.bg0; x.strokeText(l, T.x, y); x.fillStyle = look.text; x.fillText(l, T.x, y);
  });
  return c.toBuffer('image/jpeg', 92);
}

/** four frames from the videos (spread over the list), drawn into one thumbnail and written atomically to outFile */
export async function makeLongThumb(o: { clips: { mp4: string; t: number; params: Record<string, unknown> }[]; number: number; words: string; outFile: string }): Promise<{ picked: number[] }> {
  const n = o.clips.length; if (!n) throw new Error('There are no clips to take frames from.');
  const picked = [...new Set([0, 1, 2, 3].map(k => Math.min(n - 1, Math.floor(((k + 0.5) * n) / 4))))];
  const frames = await Promise.all(picked.map(i => grabFrame(o.clips[i].mp4, o.clips[i].t)));
  const jpg = await drawLongThumb(frames, o.number, o.words, lookOf(o.clips[0].params));
  fs.mkdirSync(path.dirname(o.outFile), { recursive: true });
  const tmp = o.outFile + '.tmp'; fs.writeFileSync(tmp, jpg); fs.renameSync(tmp, o.outFile);
  return { picked };
}
