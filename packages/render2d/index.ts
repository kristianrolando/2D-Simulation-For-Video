// @sim/render2d — Canvas2D drawing kit. Standard Canvas2D API only, so it runs unchanged on a browser
// canvas and on @napi-rs/canvas (Skia) in Node.
//
// Every builder takes the active Theme (packages/theme) as its last argument and defaults to CLASSIC.
// Static art (background + texture, walls, sprites) is built ONCE per scene instance, so a theme costs
// nothing per frame: the frame loop only blits layers and sprites, whatever the style.
import type { Canvas, Ctx, Env } from '../core/scene.ts';
import { clamp, type RGB, rgbToHex, mulberry32, smoothstep, ease } from '../core/index.ts';
import { CLASSIC, rgbStr, type Theme } from '../theme/index.ts';

/** classic tokens under their old names (kept for compatibility) */
export const STYLE = {
  bgTop: CLASSIC.color.bg[0], bgMid: CLASSIC.color.bg[1], bgBottom: CLASSIC.color.bg[2],
  wall: CLASSIC.color.wall, wallGlow: CLASSIC.color.wallGlow,
  text: CLASSIC.color.text, accent: CLASSIC.color.accent,
  focusDim: CLASSIC.color.focus, focusLit: CLASSIC.color.focusLit,
  font: CLASSIC.font.family,
};

// ---------- layers (offscreen canvases in logical coordinates, any device scale) ----------

/** op: how bakeStatic / drawLayer should composite this layer (additive glow vs. ink) */
export interface Layer { canvas: Canvas; ctx: Ctx; W: number; H: number; res: number; op?: GlobalCompositeOperation }

/** Offscreen layer in logical units. res < 1 renders at reduced resolution (cheap blur when upscaled). */
export function createLayer(env: Env, W: number, H: number, res = 1): Layer {
  const s = env.scale * res;
  const canvas = env.createCanvas(Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { canvas, ctx, W, H, res };
}
export function drawLayer(ctx: Ctx, l: Layer) { ctx.drawImage(l.canvas as CanvasImageSource, 0, 0, l.W, l.H); }
/** Multiply alpha by keep (0..1): deterministic exponential fade. */
export function fadeLayer(l: Layer, keep: number) {
  const g = l.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = `rgba(0,0,0,${1 - keep})`;
  g.fillRect(0, 0, l.canvas.width, l.canvas.height); g.restore();
}
export function copyLayer(env: Env, l: Layer): Canvas {
  const c = env.createCanvas(l.canvas.width, l.canvas.height);
  (c.getContext('2d') as Ctx).drawImage(l.canvas as CanvasImageSource, 0, 0);
  return c;
}
export function restoreLayer(l: Layer, from: Canvas) {
  const g = l.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy';
  g.drawImage(from as CanvasImageSource, 0, 0); g.restore();
}

// ---------- static art (built once per scene instance) ----------

/** Bake static layers (e.g. walls) into the background once: one full-screen blit per frame instead of
 *  two. Each layer is composited with its own op ('lighter' for neon, ink blends for light themes). */
export function bakeStatic(bg: Layer, ...adds: (Layer | null | undefined)[]): Layer {
  const g = bg.ctx; g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  for (const l of adds) if (l) { g.globalCompositeOperation = l.op ?? 'lighter'; g.drawImage(l.canvas as CanvasImageSource, 0, 0, bg.canvas.width, bg.canvas.height); }
  g.restore(); return bg;
}

export function makeBackground(env: Env, W: number, H: number, T: Theme = CLASSIC): Layer {
  const l = createLayer(env, W, H), g = l.ctx, stops = T.color.bg;
  if (stops.length === 1) g.fillStyle = stops[0];
  else {
    const C = T.color, cx = C.bgCx * W, cy = C.bgCy * H;
    let grad: CanvasGradient;
    if (C.bgMode === 'radial') grad = g.createRadialGradient(cx, cy, 0, cx, cy, H * 0.72);
    else if (C.bgAngle === 0 && C.bgCx === 0.5 && C.bgCy === 0.5) grad = g.createLinearGradient(0, 0, 0, H);
    else { // rotated gradient through the focus point, long enough to cover the whole frame
      const a = (C.bgAngle * Math.PI) / 180, dx = Math.sin(a), dy = Math.cos(a), L = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
      grad = g.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
    }
    stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, W, H);
  if (T.texture.kind !== 'none' && T.texture.amount > 0) paintTexture(g, W, H, T);
  if (T.texture.vignette > 0) {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.62);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${T.texture.vignette})`);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
  return l;
}

/** procedural, seeded texture painted once into the background */
function paintTexture(g: Ctx, W: number, H: number, T: Theme) {
  const { kind, color, amount: a, spacing: sp } = T.texture, rgb = rgbStr(color), rnd = mulberry32(0x5eed);
  g.save();
  const speckle = (n: number, alpha: number, maxSize: number) => {
    // 4 alpha buckets -> 4 fillStyle changes instead of n
    for (let b = 1; b <= 4; b++) {
      g.fillStyle = `rgba(${rgb},${(alpha * b) / 4})`;
      for (let i = 0; i < n / 4; i++) { const s = 0.6 + rnd() * maxSize; g.fillRect(rnd() * W, rnd() * H, s, s); }
    }
  };
  switch (kind) {
    case 'grain': speckle((W * H) / 90, a, 1.8); break;
    case 'grid': {
      const ox = (W / 2) % sp, oy = (H / 2) % sp;
      for (const major of [false, true]) {
        g.strokeStyle = `rgba(${rgb},${major ? a : a * 0.45})`; g.lineWidth = major ? 2 : 1; g.beginPath();
        for (let k = -1, x = ox; x <= W; x += sp, k++) if (((Math.round((x - W / 2) / sp) % 5) === 0) === major) { g.moveTo(x, 0); g.lineTo(x, H); }
        for (let y = oy; y <= H; y += sp) if (((Math.round((y - H / 2) / sp) % 5) === 0) === major) { g.moveTo(0, y); g.lineTo(W, y); }
        g.stroke();
      }
      break;
    }
    case 'scanlines': {
      g.fillStyle = `rgba(${rgb},${a})`;
      for (let y = 0; y < H; y += sp) g.fillRect(0, y, W, sp * 0.45);
      speckle((W * H) / 400, a * 0.35, 1.2);
      break;
    }
    case 'chalk': {
      for (let i = 0; i < 26; i++) {
        const x = rnd() * W, y = rnd() * H, r = 120 + rnd() * 280, s = g.createRadialGradient(x, y, 0, x, y, r);
        s.addColorStop(0, `rgba(${rgb},${a * 0.55})`); s.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = s; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      // wiped-off strokes of an eraser
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = `rgba(${rgb},${a * 0.3})`; g.lineWidth = 40 + rnd() * 50;
        const y = rnd() * H, x0 = rnd() * W * 0.3; g.beginPath(); g.moveTo(x0, y);
        g.bezierCurveTo(x0 + 250, y - 60 + rnd() * 120, x0 + 500, y - 60 + rnd() * 120, x0 + 650 + rnd() * 300, y + rnd() * 80 - 40); g.stroke();
      }
      speckle((W * H) / 110, a * 0.9, 1.6);
      break;
    }
    case 'halftone': {
      g.fillStyle = `rgba(${rgb},${a})`;
      for (let y = sp / 2, row = 0; y < H; y += sp * 0.866, row++) {
        const f = 0.12 + 0.88 * smoothstep(0.55, 1, y / H) + 0.5 * smoothstep(0.18, 0, y / H);
        const r = sp * 0.42 * Math.min(1, f); if (r < 0.6) continue;
        g.beginPath();
        for (let x = (row & 1 ? sp / 2 : 0); x < W + sp; x += sp) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
        g.fill();
      }
      speckle((W * H) / 160, a * 0.5, 1.4);
      break;
    }
    case 'sunburst': {
      const cx = W / 2, cy = H * 0.52, R = H, n = 2 * Math.round(Math.max(8, sp || 32) / 2);
      g.fillStyle = `rgba(${rgb},${a})`; g.beginPath();
      for (let k = 0; k < n; k += 2) { const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2; g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0)); g.lineTo(cx + R * Math.cos(a1), cy + R * Math.sin(a1)); g.closePath(); }
      g.fill();
      // dotted confetti sprinkles
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${rgb},${a * (0.6 + rnd())})`; const r = 3 + rnd() * 6; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill(); }
      break;
    }
  }
  g.restore();
}

/** Static line art (walls, mirrors, tables). The theme's line style decides how it looks: neon glow,
 *  flat ink, misregistered riso print, wobbly chalk, technical double line, sticker, or pixels. */
export function makeNeon(env: Env, W: number, H: number, path: (g: Ctx) => void,
  { core, glow, width = 9, blur = 18 }: { core?: string; glow?: string; width?: number; blur?: number } = {}, T: Theme = CLASSIC): Layer {
  const l = createLayer(env, W, H); const g = l.ctx;
  const s = env.scale, c = core ?? T.color.wall, c2 = glow ?? T.color.wallGlow, w = width * T.line.width, k = T.line.glow;
  const stroke = (col: string, lw: number, alpha = 1) => { g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = alpha; g.beginPath(); path(g); g.stroke(); g.globalAlpha = 1; };
  const rnd = mulberry32(0x11ae);
  switch (T.line.style) {
    case 'neon': {
      l.op = 'lighter';
      if (env.quality?.glow === false || k <= 0) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); path(g); g.stroke(); return l; }
      g.save(); g.filter = `blur(${blur * s}px)`; g.strokeStyle = c2; g.globalAlpha = 0.9 * k; g.lineWidth = w * 2.2;
      g.beginPath(); path(g); g.stroke(); g.restore();
      g.save(); g.filter = `blur(${(blur / 3) * s}px)`; g.strokeStyle = c; g.globalAlpha = 0.8 * k; g.lineWidth = w * 1.2;
      g.beginPath(); path(g); g.stroke(); g.restore();
      g.strokeStyle = c; g.lineWidth = w; g.beginPath(); path(g); g.stroke();
      g.strokeStyle = 'rgba(235,255,255,0.85)'; g.lineWidth = w * 0.35; g.beginPath(); path(g); g.stroke();
      return l;
    }
    case 'flat': l.op = 'source-over'; stroke(c, w); return l;
    case 'misprint': {
      l.op = 'multiply';
      g.save(); g.translate(5, 4); stroke(c2, w, 0.9); g.restore();
      g.globalCompositeOperation = 'multiply'; stroke(c, w); g.globalCompositeOperation = 'source-over';
      return l;
    }
    case 'sketch': {
      l.op = 'source-over';
      for (let i = 0; i < 4; i++) { g.save(); g.translate(rnd() * 5 - 2.5, rnd() * 5 - 2.5); stroke(i === 0 ? c2 : c, w * (0.5 + 0.35 * rnd()), i === 0 ? 0.35 : 0.55); g.restore(); }
      // chalk grain: knock tiny holes into the strokes. One repeating 192 px tile, applied as a pattern in a
      // single destination-out fill: 30k individual destination-out rects took 29 s in Skia (measured).
      const tile = env.createCanvas(192, 192), tg = tile.getContext('2d') as Ctx;
      tg.fillStyle = 'rgba(0,0,0,0.75)';
      for (let i = 0; i < (192 * 192) / 70; i++) { const sz = 0.8 + rnd() * 1.8; tg.fillRect(rnd() * 192, rnd() * 192, sz, sz); }
      g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = g.createPattern(tile as CanvasImageSource, 'repeat')!;
      g.fillRect(0, 0, W, H); g.restore();
      return l;
    }
    case 'technical': {
      l.op = 'source-over';
      const outer = Math.max(6, w * 2);
      stroke(c, outer);
      // hollow it out through a second layer: a destination-out *stroke* of a large arc is only partly
      // applied by Skia (measured), a destination-out *drawImage* is exact everywhere
      const cut = createLayer(env, W, H); cut.ctx.strokeStyle = '#000'; cut.ctx.lineWidth = outer - 3.2; cut.ctx.beginPath(); path(cut.ctx); cut.ctx.stroke();
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out'; g.drawImage(cut.canvas as CanvasImageSource, 0, 0); g.restore();
      g.setLineDash([30, 8, 4, 8]); stroke(c2, 1.4, 0.8); g.setLineDash([]);
      return l;
    }
    case 'sticker': {
      l.op = 'source-over';
      g.save(); g.translate(6, 9); stroke(c2, w * 1.9); g.restore();
      stroke(c, w * 1.9); stroke(T.color.wall2, w * 0.55);
      return l;
    }
    case 'pixel': {
      l.op = 'lighter';
      const lo = createLayer(env, W, H, 1 / 4); lo.ctx.lineCap = 'square'; lo.ctx.lineJoin = 'miter';
      lo.ctx.strokeStyle = c; lo.ctx.lineWidth = Math.max(w, 4); lo.ctx.beginPath(); path(lo.ctx); lo.ctx.stroke();
      if (k > 0 && env.quality?.glow !== false) { g.save(); g.filter = `blur(${8 * s}px)`; g.globalAlpha = 0.45 * k; g.drawImage(lo.canvas as CanvasImageSource, 0, 0, W, H); g.restore(); }
      g.imageSmoothingEnabled = false; g.drawImage(lo.canvas as CanvasImageSource, 0, 0, W, H); g.imageSmoothingEnabled = true;
      return l;
    }
  }
  return l;
}

/** Sprites are rendered at device resolution and drawn at logical size. */
export interface Sprite { canvas: Canvas; w: number; h: number }
function spriteCanvas(env: Env, w: number, h: number): { c: Canvas; g: Ctx } {
  const c = env.createCanvas(Math.max(1, Math.ceil(w * env.scale)), Math.max(1, Math.ceil(h * env.scale)));
  const g = c.getContext('2d') as Ctx; g.scale(env.scale, env.scale);
  return { c, g };
}
const EMPTY = (env: Env): Sprite => ({ canvas: env.createCanvas(1, 1), w: 0, h: 0 });

/** light / spark sprite: soft glow (classic) or the theme's spark shape */
export function makeGlowSprite(env: Env, rgb: RGB | number[], radius: number, { core = 0, intensity = 1 } = {}, T: Theme = CLASSIC): Sprite {
  const s = Math.ceil(radius * 2); const { c, g } = spriteCanvas(env, s, s);
  const [r, gg, b] = rgb.map(Math.round), col = `rgba(${r},${gg},${b},${Math.min(1, intensity)})`, m = s / 2;
  switch (T.spark) {
    case 'glow': {
      const gr = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
      gr.addColorStop(0, `rgba(${r},${gg},${b},${intensity})`);
      if (core > 0) gr.addColorStop(core, `rgba(${r},${gg},${b},${intensity * 0.6})`);
      gr.addColorStop(0.45, `rgba(${r},${gg},${b},${intensity * 0.22})`);
      gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, s, s); break;
    }
    case 'dot': g.fillStyle = col; g.beginPath(); g.arc(m, m, radius * 0.32, 0, Math.PI * 2); g.fill(); break;
    case 'square': { const q = Math.max(2, Math.round(radius * 0.5)); g.fillStyle = col; g.fillRect(Math.round(m - q / 2), Math.round(m - q / 2), q, q); break; }
    case 'confetti': g.fillStyle = col; g.fillRect(m - radius * 0.32, m - radius * 0.13, radius * 0.64, radius * 0.26); break;
    case 'dust': {
      const gr = g.createRadialGradient(m, m, 0, m, m, radius * 0.5);
      gr.addColorStop(0, `rgba(${r},${gg},${b},${0.55 * intensity})`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, s, s); break;
    }
    case 'cross': {
      const L = radius * 0.6; g.strokeStyle = col; g.lineWidth = Math.max(2, radius * 0.08); g.lineCap = 'butt';
      g.beginPath(); g.moveTo(m - L, m); g.lineTo(m + L, m); g.moveTo(m, m - L); g.lineTo(m, m + L); g.stroke(); break;
    }
  }
  return { canvas: c, w: s, h: s };
}

export function makeBallSprite(env: Env, rgb: RGB | number[], r: number, { halo = 2.2 } = {}, T: Theme = CLASSIC): Sprite {
  const col = rgbToHex(rgb), out = T.ball.outline;
  if (T.ball.style === 'glossy') {
    const R = r * halo, s = Math.ceil(R * 2) + 2, cx = s / 2;
    const { c, g } = spriteCanvas(env, s, s);
    const [R0, G0, B0] = rgb.map(Math.round);
    const gr = g.createRadialGradient(cx, cx, r * 0.6, cx, cx, R);
    gr.addColorStop(0, `rgba(${R0},${G0},${B0},0.55)`); gr.addColorStop(1, `rgba(${R0},${G0},${B0},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    const body = g.createRadialGradient(cx - r * 0.3, cx - r * 0.3, r * 0.1, cx, cx, r);
    body.addColorStop(0, 'rgba(255,255,255,0.95)'); body.addColorStop(0.35, col); body.addColorStop(1, rgbToHex(rgb.map(v => v * 0.7)));
    g.fillStyle = body; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1.5, r * 0.18);
    g.beginPath(); g.arc(cx, cx, r * 0.92, 0, Math.PI * 2); g.stroke();
    return { canvas: c, w: s, h: s };
  }
  const s = Math.ceil(r * 3.2) + 4, cx = s / 2; const { c, g } = spriteCanvas(env, s, s);
  const disc = (x: number, y: number, rr: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); };
  switch (T.ball.style) {
    case 'flat': disc(cx, cx, r, col); break;
    case 'misprint': {
      disc(cx, cx, r, col);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55; disc(cx + r * 0.28, cx + r * 0.22, r, T.color.wallGlow);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; break;
    }
    case 'chalk': {
      const rnd = mulberry32(Math.round(r * 977) ^ (rgb[0] << 16) ^ (rgb[1] << 8) ^ rgb[2]);
      g.fillStyle = col; g.globalAlpha = 0.92; g.beginPath();
      for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2, rr = r * (0.88 + 0.16 * rnd()); i ? g.lineTo(cx + rr * Math.cos(a), cx + rr * Math.sin(a)) : g.moveTo(cx + rr * Math.cos(a), cx + rr * Math.sin(a)); }
      g.fill(); g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.8)';
      for (let i = 0; i < r * 2.2; i++) { const a = rnd() * Math.PI * 2, d = rnd() * r; g.fillRect(cx + d * Math.cos(a), cx + d * Math.sin(a), 1.3, 1.3); }
      g.globalCompositeOperation = 'source-over'; break;
    }
    case 'pixel': {
      const q = Math.max(4, Math.round(r * 1.7)), x0 = Math.round(cx - q / 2), p = Math.max(2, Math.round(q / 5));
      g.fillStyle = col; g.fillRect(x0, x0, q, q);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x0 + p, x0 + p, p, p);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0, x0 + q - p, q, p); g.fillRect(x0 + q - p, x0, p, q);
      break;
    }
    case 'sticker': {
      disc(cx + r * 0.16, cx + r * 0.3, r * 1.22, T.color.wallGlow);
      disc(cx, cx, r * 1.22, out); disc(cx, cx, r, col);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(cx - r * 0.38, cx - r * 0.38, r * 0.3, r * 0.2, -0.7, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'ring': {
      g.strokeStyle = col; g.lineWidth = Math.max(2, r * 0.22); g.beginPath(); g.arc(cx, cx, r * 0.82, 0, Math.PI * 2); g.stroke();
      disc(cx, cx, Math.max(1.5, r * 0.2), col);
      g.lineWidth = 1.5; g.strokeStyle = out; g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(cx + dx * r * 1.05, cx + dy * r * 1.05); g.lineTo(cx + dx * r * 1.5, cx + dy * r * 1.5); }
      g.stroke(); break;
    }
  }
  return { canvas: c, w: s, h: s };
}

export type ShapeKind = 'ball' | 'square' | 'triangle' | 'gem' | 'star';
export const SHAPE_KINDS: ShapeKind[] = ['ball', 'square', 'triangle', 'gem', 'star'];
/** A body sprite of the given shape (collision stays a disc of radius r; the shape is drawn inside it).
 *  'ball' is the theme's own ball; the other shapes follow the theme's ball style (glossy, flat, ...). */
export function makeShapeSprite(env: Env, rgb: RGB | number[], r: number, kind: ShapeKind, T: Theme = CLASSIC, halo = 1.25): Sprite {
  if (kind === 'ball') return makeBallSprite(env, rgb, r, { halo }, T);
  const s = Math.ceil(r * 3) + 4, cx = s / 2; const { c, g } = spriteCanvas(env, s, s);
  const col = rgbToHex(rgb), dark = rgbToHex(rgb.map(v => v * 0.62)), k = r * 0.98;
  const path = (rr: number, ox = 0, oy = 0) => {
    g.beginPath();
    const poly = (n: number, rot: number, inner = 0) => {
      const m = inner ? n * 2 : n;
      for (let i = 0; i < m; i++) { const a = rot + (i * 2 * Math.PI) / m, q = inner && i % 2 ? rr * inner : rr; const x = cx + ox + q * Math.cos(a), y = cx + oy + q * Math.sin(a); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath();
    };
    if (kind === 'square') { const h = rr * 0.86; g.roundRect(cx + ox - h, cx + oy - h, 2 * h, 2 * h, rr * 0.22); }
    else if (kind === 'triangle') poly(3, -Math.PI / 2);
    else if (kind === 'gem') poly(4, -Math.PI / 2);
    else poly(5, -Math.PI / 2, 0.48);
  };
  switch (T.ball.style) {
    case 'glossy': {
      const gr = g.createLinearGradient(cx - k, cx - k, cx + k, cx + k);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, col); gr.addColorStop(1, dark);
      path(k); g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(1.2, r * 0.14); path(k * 0.9); g.stroke();
      break;
    }
    case 'misprint': path(k); g.fillStyle = col; g.fill(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55; path(k, r * 0.28, r * 0.22); g.fillStyle = T.color.wallGlow; g.fill(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; break;
    case 'sticker': path(k * 1.2, r * 0.16, r * 0.3); g.fillStyle = T.color.wallGlow; g.fill(); path(k * 1.2); g.fillStyle = T.ball.outline; g.fill(); path(k); g.fillStyle = col; g.fill(); break;
    case 'ring': path(k * 0.85); g.strokeStyle = col; g.lineWidth = Math.max(2, r * 0.22); g.stroke(); break;
    case 'pixel': g.imageSmoothingEnabled = false; path(k); g.fillStyle = col; g.fill(); g.fillStyle = 'rgba(0,0,0,0.3)'; path(k * 0.45, r * 0.3, r * 0.3); g.fill(); break;
    default: path(k); g.fillStyle = col; g.globalAlpha = T.ball.style === 'chalk' ? 0.9 : 1; g.fill(); g.globalAlpha = 1;
  }
  return { canvas: c, w: s, h: s };
}

/** Comet tail pointing along +x; its tip (right edge) sits on the ball centre. Theme may drop it. */
export function makeCometSprite(env: Env, rgb: RGB | number[], len: number, width: number, T: Theme = CLASSIC): Sprite {
  if (T.comet.style === 'none') return EMPTY(env);
  const h2 = Math.ceil(width * 2) + 2; const { c, g } = spriteCanvas(env, len, h2); const h = h2 / 2;
  const [r, gg, b] = rgb.map(Math.round), A = T.comet.alpha;
  const gr = g.createLinearGradient(0, 0, len, 0);
  if (T.comet.style === 'flat') { gr.addColorStop(0, `rgba(${r},${gg},${b},0)`); gr.addColorStop(1, `rgba(${r},${gg},${b},${0.6 * A})`); }
  else {
    gr.addColorStop(0, `rgba(${r},${gg},${b},0)`); gr.addColorStop(0.7, `rgba(${r},${gg},${b},${0.45 * A})`);
    gr.addColorStop(1, `rgba(${Math.min(255, r + 80)},${Math.min(255, gg + 80)},${Math.min(255, b + 80)},${0.95 * A})`);
  }
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, h); g.lineTo(len, h - width); g.lineTo(len, h + width); g.closePath(); g.fill();
  return { canvas: c, w: len, h: h2 };
}

export function drawSprite(ctx: Ctx, s: Sprite, x: number, y: number, alpha = 1, scale = 1) {
  if (alpha <= 0 || s.w === 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  const w = s.w * scale, h = s.h * scale;
  ctx.drawImage(s.canvas as CanvasImageSource, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 1;
}
/** draw a comet whose tip is at (x, y) heading along (dx, dy); angle = atan2 for rendering only */
export function drawComet(ctx: Ctx, s: Sprite, x: number, y: number, dx: number, dy: number, alpha = 1) {
  if (s.w === 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
  ctx.drawImage(s.canvas as CanvasImageSource, -s.w, -s.h / 2, s.w, s.h); ctx.restore();
}

// ---------- overlays ----------

export const fontOf = (T: Theme, size: number) => `${T.font.weight ? T.font.weight + ' ' : ''}${size}px ${T.font.family}`;
export function fitFont(ctx: Ctx, text: string, maxSize: number, maxWidth: number, T: Theme = CLASSIC): number {
  ctx.font = fontOf(T, maxSize);
  const w = ctx.measureText(text).width;
  return w > maxWidth ? Math.floor((maxSize * maxWidth) / w) : maxSize;
}

export interface Segment { text: string; color: string }
export interface HeaderOpts { title: string; titleY?: number; counter?: Segment[] | null; counterY?: number; counterScale?: number; handle?: string; handleY?: number; /** video time (s), drives the title entrance */ t?: number }

/** Title (hook) + counter line + optional handle. Layout, typography, entrance and decoration follow the theme. */
export function drawHeader(ctx: Ctx, W: number, o: HeaderOpts, T: Theme = CLASSIC) {
  const F = T.font, M = T.motion, C = T.color;
  const titleY = o.titleY ?? 255, counterY = o.counterY ?? 365;
  const left = F.align === 'left', X0 = 84, maxW = left ? 912 : 970;
  const tx = (s: string) => (F.case === 'upper' ? s.toUpperCase() : F.case === 'lower' ? s.toLowerCase() : s);
  ctx.save();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const prompt = F.deco === 'prompt' ? '> ' : '';
  const lines = tx(o.title).split('\n');
  if (prompt) lines[0] = prompt + lines[0];
  const size = Math.min(...lines.map(l => fitFont(ctx, l, F.titleSize, maxW, T)));
  ctx.font = fontOf(T, size);
  const lh = size * F.lineHeight;
  // ---- entrance (presentation only) ----
  const t = o.t ?? 1e9, u = M.titleIn === 'none' ? 1 : clamp(t / M.titleInDur, 0, 1);
  let dy = 0, chars = Infinity;
  // entrances never start from nothing: frame 0 is the Shorts cover, so the hook must already be readable
  if (M.titleIn === 'slide') { dy = (1 - ease.outCubic(u)) * 46; ctx.globalAlpha = 0.35 + 0.65 * u; }
  else if (M.titleIn === 'drop') dy = -(1 - ease.outBounce(u)) * 140;
  else if (M.titleIn === 'type') chars = 8 + Math.floor(t * 30);
  else if (M.titleIn === 'wipe' && u < 1) { ctx.beginPath(); ctx.rect(0, 0, W * (0.3 + 0.7 * ease.outQuint(u)), counterY - size * 0.6); ctx.clip(); }
  const n = lines.length, widths = lines.map(l => ctx.measureText(l).width);
  const xOf = (i: number) => (left ? X0 : (W - widths[i]) / 2);
  const yOf = (i: number) => titleY - (n - 1 - i) * lh + dy;
  if (F.deco === 'highlight') {
    ctx.fillStyle = C.wall2; ctx.globalCompositeOperation = T.dark ? 'source-over' : 'multiply';
    lines.forEach((_, i) => ctx.fillRect(xOf(i) - 16, yOf(i) - size * 0.8, widths[i] + 32, size * 0.98));
    ctx.globalCompositeOperation = 'source-over';
  }
  if (F.deco === 'titleblock') {
    const top = yOf(0) - size - 26, bot = counterY + 38;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.strokeRect(56, top, W - 112, bot - top);
    ctx.beginPath(); ctx.moveTo(56, titleY + 30); ctx.lineTo(W - 56, titleY + 30); ctx.stroke();
    ctx.font = fontOf(T, 22); ctx.fillStyle = C.muted; ctx.fillText('FIG. 01', 72, top + 28);
    ctx.font = fontOf(T, size);
  }
  ctx.fillStyle = C.text;
  let typed = 0;
  lines.forEach((l, i) => {
    let s = l;
    if (chars !== Infinity) { s = l.slice(0, Math.max(0, chars - typed)); typed += l.length; }
    ctx.fillText(s, xOf(i), yOf(i));
    if (prompt && chars !== Infinity && s.length < l.length && s.length >= 0 && (typed - l.length) <= chars) {
      if (Math.floor(t * 2.5) % 2 === 0) ctx.fillRect(xOf(i) + ctx.measureText(s).width + 4, yOf(i) - size * 0.75, size * 0.5, size * 0.85);
      chars = -1e9; // only one cursor
    }
  });
  if (F.deco === 'underline') {
    const i = n - 1, x = xOf(i), y = yOf(i) + size * 0.24, w = widths[i];
    ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(3, size * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
    for (let k = 0; k <= 40; k++) { const px = x + (w * k) / 40, py = y + Math.sin(k * 0.9) * size * 0.06 + (k / 40) * size * 0.08; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (o.counter && o.counter.length) drawCounter(ctx, W, o.counter, counterY, o.counterScale ?? 1, T, left ? X0 : -1);
  if (o.handle) {
    ctx.font = fontOf(T, 30); ctx.fillStyle = `rgba(${rgbStr(C.handle)},0.55)`;
    const w = ctx.measureText(o.handle).width; ctx.fillText(o.handle, left ? X0 : (W - w) / 2, o.handleY ?? counterY + 75);
  }
  ctx.restore();
}

function drawCounter(ctx: Ctx, W: number, segs0: Segment[], y: number, k: number, T: Theme, leftX: number) {
  const F = T.font, C = T.color;
  const segs = F.counterStyle === 'bracket' ? [{ text: '[ ', color: C.muted }, ...segs0, { text: ' ]', color: C.muted }] : segs0;
  const full = segs.map(s => s.text).join('');
  const cs = fitFont(ctx, full, F.counterSize, 1000, T);
  // 'stack': values (accent segments) set larger, poster-style
  const big = F.counterStyle === 'stack' ? 1.55 : 1;
  const sizeOf = (s: Segment) => (s.color === C.accent && segs.length > 1 ? Math.round(cs * big) : cs);
  const widthOf = (s: Segment) => { ctx.font = fontOf(T, sizeOf(s)); return ctx.measureText(s.text).width; };
  let total = 0;
  if (big === 1) { ctx.font = fontOf(T, cs); total = ctx.measureText(full).width; } // exact classic layout
  else for (const s of segs) total += widthOf(s);
  ctx.save();
  const px = leftX >= 0 ? leftX : W / 2; // left-aligned counters pop from their left edge
  if (k !== 1) { ctx.translate(px, y - cs * 0.35); ctx.scale(k, k); ctx.translate(-px, -(y - cs * 0.35)); }
  let x = leftX >= 0 ? leftX : (W - total) / 2;
  if (F.counterStyle === 'pill' || F.counterStyle === 'tag') {
    const padX = cs * 0.55, h = cs * 1.45, top = y - cs * 1.05;
    ctx.beginPath(); ctx.roundRect(x - padX, top, total + 2 * padX, h, F.counterStyle === 'pill' ? h / 2 : 2);
    if (F.counterStyle === 'pill') { ctx.fillStyle = C.wall; ctx.fill(); }
    else { ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.stroke(); }
  }
  for (const s of segs) {
    ctx.font = fontOf(T, sizeOf(s));
    // inside the pill every non-accent segment (labels, muted notes, names) uses the dark background ink
    ctx.fillStyle = F.counterStyle === 'pill' && s.color !== C.accent ? C.bg[C.bg.length - 1] : s.color;
    ctx.fillText(s.text, x, y); x += ctx.measureText(s.text).width;
  }
  ctx.restore();
}

/** Expanding ring that fades: age in seconds since trigger. */
export function drawRipple(ctx: Ctx, x: number, y: number, age: number, { r0 = 20, r1 = 90, dur = 0.7, color }: { r0?: number; r1?: number; dur?: number; color?: string } = {}, T: Theme = CLASSIC) {
  if (age < 0 || age > dur) return;
  const u = age / dur, r = r0 + (r1 - r0) * ease[T.motion.ripple](u);
  ctx.strokeStyle = `rgba(${color ?? rgbStr(T.color.ripple)},${clamp(0.55 * (1 - u), 0, 1)})`; ctx.lineWidth = 3;
  ctx.beginPath();
  if (T.focus === 'square') ctx.rect(x - r, y - r, 2 * r, 2 * r); else ctx.arc(x, y, r, 0, Math.PI * 2);
  if (T.focus === 'cross') ctx.setLineDash([10, 8]);
  ctx.stroke(); ctx.setLineDash([]);
}

export function drawFocusRing(ctx: Ctx, x: number, y: number, lit = 0, T: Theme = CLASSIC) {
  const shape = (rr: number) => { ctx.beginPath(); if (T.focus === 'square') ctx.rect(x - rr, y - rr, 2 * rr, 2 * rr); else ctx.arc(x, y, rr, 0, Math.PI * 2); };
  ctx.lineWidth = 3; ctx.strokeStyle = T.color.focus; ctx.globalAlpha = 0.9;
  shape(19); ctx.stroke();
  if (T.focus === 'cross') { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 34, y); ctx.lineTo(x + 34, y); ctx.moveTo(x, y - 34); ctx.lineTo(x, y + 34); ctx.stroke(); }
  if (lit > 0) {
    ctx.globalAlpha = clamp(lit, 0, 1); ctx.strokeStyle = T.color.focusLit; ctx.lineWidth = 4;
    shape(19); ctx.stroke();
    ctx.fillStyle = T.focus === 'ring' && T.id === CLASSIC.id ? 'rgba(255,240,200,0.8)' : T.color.focusLit; shape(12); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- 3D ----------

/** Pinhole camera looking down at pitch alpha. World: x = right, y = up, z = forward. */
export function makeCamera({ alpha, Cy, Cz, F, cx = 540, cy = 960 }: { alpha: number; Cy: number; Cz: number; F: number; cx?: number; cy?: number }) {
  const fy = -Math.sin(alpha), fz = Math.cos(alpha), uy = Math.cos(alpha), uz = Math.sin(alpha);
  return (x: number, y: number, z: number): [number, number, number] => {
    const dy = y - Cy, dz = z - Cz, depth = dy * fy + dz * fz, s = F / depth;
    return [cx + x * s, cy - (dy * uy + dz * uz) * s, s];
  };
}

// ---------- fading trails without 8-bit residue ----------

/**
 * Ring buffer of recent positions per track, redrawn every frame with alpha by age.
 * Replaces "fade a canvas layer" for short trails: multiplying an 8-bit layer by keep < 1 stalls once
 * value·(1−keep) < 0.5, leaving permanent ghost lines (measured: values ≲ 20/255 never fade at
 * keep = 0.975). Cost is O(points within maxAge); state is plain typed arrays (snapshot-able).
 */
export class TrailHistory {
  readonly n: number; readonly cap: number;
  private xs: Float32Array; private ys: Float32Array; private fr: Int32Array; private head: Int32Array; private len: Int32Array;
  constructor(tracks: number, capacity: number) {
    this.n = tracks; this.cap = capacity;
    this.xs = new Float32Array(tracks * capacity); this.ys = new Float32Array(tracks * capacity); this.fr = new Int32Array(tracks * capacity);
    this.head = new Int32Array(tracks); this.len = new Int32Array(tracks);
  }
  push(i: number, x: number, y: number, frame: number) {
    const k = i * this.cap + this.head[i];
    this.xs[k] = x; this.ys[k] = y; this.fr[k] = frame;
    this.head[i] = (this.head[i] + 1) % this.cap; if (this.len[i] < this.cap) this.len[i]++;
  }
  /** draw track i: `bands` strokes from oldest (transparent, thin) to newest (alpha, width) */
  draw(ctx: Ctx, i: number, now: number, maxAge: number, rgb: string, alpha: number, width: number, bands = 6) {
    const L = this.len[i]; if (L < 2) return;
    const base = i * this.cap, idx = (j: number) => base + ((this.head[i] - 1 - j + this.cap * 2) % this.cap); // j=0 newest
    let j = 0;
    for (let b = 0; b < bands && j < L - 1; b++) {
      const ageMax = ((b + 1) / bands) * maxAge, u = 1 - b / bands;
      ctx.strokeStyle = `rgba(${rgb},${alpha * u * u})`; ctx.lineWidth = width * (0.35 + 0.65 * u);
      ctx.beginPath(); let k = idx(j); ctx.moveTo(this.xs[k], this.ys[k]);
      let drew = false;
      while (j < L - 1) { const k2 = idx(j + 1); if (now - this.fr[k2] > ageMax) break; ctx.lineTo(this.xs[k2], this.ys[k2]); j++; drew = true; }
      if (drew) ctx.stroke();
      if (j < L - 1 && now - this.fr[idx(j + 1)] > maxAge) break;
      if (!drew) j++;
    }
  }
  snapshot() { return { xs: this.xs.slice(), ys: this.ys.slice(), fr: this.fr.slice(), head: this.head.slice(), len: this.len.slice() }; }
  restore(s: ReturnType<TrailHistory['snapshot']>) { this.xs.set(s.xs); this.ys.set(s.ys); this.fr.set(s.fr); this.head.set(s.head); this.len.set(s.len); }
}
