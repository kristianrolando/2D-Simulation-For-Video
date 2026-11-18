// The pure part of thumbnails/covers: which frame is the best one, what the hook text says, and where it may be drawn.
// The server (apps/server/cover.ts) feeds it frame statistics from ffmpeg and draws the pictures; nothing here touches
// a file, so it is unit-tested in Node. Deterministic: the same statistics always pick the same frame.
import { stripEmoji } from './copywriter.ts';

export interface FrameStat { t: number; /** edge energy 0..255 (how much fine structure the frame has) */ detail: number; /** share of pixels that differ from the background 0..1 */ ink: number }
export interface FramePick { t: number; score: number; index: number; reason: string }

/** where the climax is, when the scene itself knows (video seconds): the moment a pattern closes, lines up or the last ball lands */
export function climaxSecFor(sceneId: string, P: Record<string, unknown>): number | undefined {
  const key = { 'galton-board': 'finalAt', 'pendulum-wave': 'alignAt', 'rosette-orbit': 'closeAt', 'resonance-orbits': 'closeAt', billiard: 'endAt', 'focal-reflection': 'finalAt' }[sceneId];
  const x = key ? Number(P[key]) : NaN;
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

const norm = (xs: number[]) => { const m = Math.max(...xs, 1e-9); return xs.map(x => x / m); };
/**
 * The best frame is a busy, tense one near the climax: lots of structure (detail) and lots of the picture in use (ink),
 * weighted by closeness to the climax. The climax is the scene's own (`climaxSec`, e.g. when the pattern closes) or,
 * when it has none, about four fifths into the video. The first 10 % (still empty) and the very end (rewind, end card) are avoided.
 */
export function pickBestFrame(stats: FrameStat[], durationSec: number, climaxSec?: number): FramePick | null {
  const ok = stats.filter(s => Number.isFinite(s.t) && s.t >= 0 && s.t <= durationSec);
  if (!ok.length || !(durationSec > 0)) return null;
  const d = norm(ok.map(s => s.detail)), k = norm(ok.map(s => s.ink));
  const centre = Math.min(0.95, Math.max(0.2, (climaxSec !== undefined ? climaxSec * 0.97 : durationSec * 0.8) / durationSec));
  const width = climaxSec !== undefined ? 0.16 : 0.25;
  let best = -1, bestScore = -1;
  ok.forEach((s, i) => {
    const u = s.t / durationSec;
    const prior = u < 0.1 ? 0.02 : u > 0.97 ? 0.3 : Math.exp(-(((u - centre) / width) ** 2));
    const score = (0.5 * d[i] + 0.5 * k[i]) * (0.35 + 0.65 * prior);
    if (score > bestScore + 1e-12) { bestScore = score; best = i; }
  });
  const s = ok[best];
  return { t: Math.round(s.t * 100) / 100, score: Math.round(bestScore * 1000) / 1000, index: stats.indexOf(s), reason: climaxSec !== undefined ? 'busiest frame near the moment the pattern completes' : 'busiest frame in the last third of the video' };
}

/** the sample times for the analysis: evenly spread, never the first 10 % */
export function sampleTimes(durationSec: number, n = 36): number[] {
  if (!(durationSec > 0)) return [];
  const a = durationSec * 0.1, b = durationSec * 0.985;
  return Array.from({ length: n }, (_, i) => Math.round((a + ((b - a) * i) / Math.max(1, n - 1)) * 100) / 100);
}

// ---------------- hook text ----------------
export const COVER_TEXT_MAX = 56;
/** The cover's hook: short, true to the video, no emoji or hashtags. A question stays a whole question. */
export function coverText(...sources: string[]): string {
  for (const raw of sources) {
    const clean = stripEmoji(String(raw ?? '').replace(/#\w+/g, '')).replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const parts = String(raw).split(/\n| — /).map(p => stripEmoji(p.replace(/#\w+/g, '')).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const q = [...parts].reverse().find(p => p.endsWith('?') && p.length <= COVER_TEXT_MAX);
    if (q) return q;
    if (clean.length <= COVER_TEXT_MAX) return clean.replace(/[.,;:]$/, '');
    const shortPart = parts.find(p => p.length <= COVER_TEXT_MAX);
    if (shortPart) return shortPart.replace(/[.,;:]$/, '');
    const cut = clean.slice(0, COVER_TEXT_MAX - 1).replace(/\s+\S*$/, '').replace(/[,;:\-–—]$/, '');
    return cut + '…';
  }
  return '';
}

// ---------------- layouts (pixels). The red zones are where YouTube's own buttons and text sit over a Short. ----------------
export interface Box { x: number; y: number; w: number; h: number }
export const COVER_TALL = {
  w: 1080, h: 1920,
  /** the hook text goes here: below the top bar, above the side buttons */
  text: { x: 90, y: 250, w: 900, h: 420 } as Box,
  /** the dark band that hides the video's own title strip so the text is not drawn on top of it */
  scrimBottom: 780,
  /** covered by YouTube's interface */
  unsafe: [{ x: 0, y: 0, w: 1080, h: 170 }, { x: 0, y: 1560, w: 1080, h: 360 }, { x: 940, y: 900, w: 140, h: 660 }] as Box[],
};
export const COVER_WIDE = {
  w: 1280, h: 720,
  text: { x: 64, y: 90, w: 540, h: 480 } as Box,
  /** the frame as a framed panel on the right */
  panel: { x: 660, y: 50, w: 570, h: 570 } as Box,
  /** YouTube's duration stamp sits here */
  unsafe: [{ x: 1090, y: 640, w: 190, h: 80 }] as Box[],
};
/** does a box touch any unsafe zone? (used by tests to keep the layout honest) */
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------------- what YouTube does to a Shorts thumbnail ----------------
// YouTube crops a Shorts thumbnail to 9:16 around the centre (thumbnails resource, `shortsAspectRatio`; Help "Add video
// thumbnails": recommended 9:16). A 1280×720 picture therefore loses its left and right thirds: that is what turned the hook text
// into a lone "?" on a channel video. So the picture sent for a Short must already be 9:16.
export const SHORTS_RATIO = 9 / 16;
export const THUMB_MAX_BYTES = 50 * 1024 * 1024; // thumbnails.set limit
/** the part of a w×h picture that is kept when YouTube crops to 9:16 around the centre */
export function shortsCrop(w: number, h: number): Box {
  if (w / h > SHORTS_RATIO) { const cw = Math.round(h * SHORTS_RATIO); return { x: Math.round((w - cw) / 2), y: 0, w: cw, h }; }
  const ch = Math.round(w / SHORTS_RATIO); return { x: 0, y: Math.round((h - ch) / 2), w, h: Math.min(h, ch) };
}
export const isShortsRatio = (w: number, h: number) => h > 0 && Math.abs(w / h - SHORTS_RATIO) < 0.004;
/** is the box entirely inside the kept part? */
export const inside = (b: Box, c: Box) => b.x >= c.x && b.y >= c.y && b.x + b.w <= c.x + c.w && b.y + b.h <= c.y + c.h;
/** pixel size of a JPEG or PNG from its bytes (no decoder needed); null when it is neither */
export function imageSize(d: Uint8Array): { width: number; height: number; type: 'jpeg' | 'png' } | null {
  if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) { const v = new DataView(d.buffer, d.byteOffset, d.byteLength); return { width: v.getUint32(16), height: v.getUint32(20), type: 'png' }; }
  if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) { i++; continue; }
      const m = d[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (d[i + 5] << 8) | d[i + 6], width: (d[i + 7] << 8) | d[i + 8], type: 'jpeg' };
      i += 2 + ((d[i + 2] << 8) | d[i + 3]);
    }
  }
  return null;
}
