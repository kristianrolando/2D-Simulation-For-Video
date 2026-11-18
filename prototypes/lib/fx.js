// Canvas2D drawing helpers shared by every scene. Works with a browser canvas
// and with @napi-rs/canvas in Node: only the standard Canvas2D API is used.
// `env.createCanvas(w, h)` is injected by the host (browser or Node).

import { rgbToHex, clamp } from './core.js';

export const STYLE = {
  bgTop: '#040822',
  bgMid: '#010312',
  bgBottom: '#000005',
  wall: '#9cf3ff',
  wallGlow: '#3fc9ff',
  text: '#eef2ff',
  accent: '#ffd23f',
  focusDim: '#8e823c',
  focusLit: '#ffd864',
  font: 'DejaVuSansBold',
};

/** Pre-rendered background gradient (drawn once, blitted every frame). */
export function makeBackground(env, W, H) {
  const c = env.createCanvas(W, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, STYLE.bgTop);
  grad.addColorStop(0.5, STYLE.bgMid);
  grad.addColorStop(1, STYLE.bgBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  return c;
}

/**
 * Glow layer for static neon geometry: `drawPath(g)` adds a path; it is stroked thick + blurred
 * once (expensive blur happens only at init), then the crisp core is stroked on top.
 */
export function makeNeonLayer(env, W, H, drawPath, { core = STYLE.wall, glow = STYLE.wallGlow, width = 9, blur = 18 } = {}) {
  const c = env.createCanvas(W, H);
  const g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  // wide soft glow
  g.save(); g.filter = `blur(${blur}px)`; g.strokeStyle = glow; g.globalAlpha = 0.9; g.lineWidth = width * 2.2;
  g.beginPath(); drawPath(g); g.stroke(); g.restore();
  g.save(); g.filter = `blur(${blur / 3}px)`; g.strokeStyle = core; g.globalAlpha = 0.8; g.lineWidth = width * 1.2;
  g.beginPath(); drawPath(g); g.stroke(); g.restore();
  // crisp core
  g.strokeStyle = core; g.lineWidth = width; g.beginPath(); drawPath(g); g.stroke();
  g.strokeStyle = 'rgba(235,255,255,0.85)'; g.lineWidth = width * 0.35; g.beginPath(); drawPath(g); g.stroke();
  return c;
}

/** Radial glow sprite (additive). */
export function makeGlowSprite(env, rgb, radius, { core = 0.0, intensity = 1 } = {}) {
  const s = Math.ceil(radius * 2);
  const c = env.createCanvas(s, s);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  const [r, gg, b] = rgb.map(Math.round);
  gr.addColorStop(0, `rgba(${r},${gg},${b},${intensity})`);
  if (core > 0) gr.addColorStop(core, `rgba(${r},${gg},${b},${intensity * 0.6})`);
  gr.addColorStop(0.45, `rgba(${r},${gg},${b},${intensity * 0.22})`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return c;
}

/** Ball sprite: soft halo + coloured body + bright rim + specular dot. */
export function makeBallSprite(env, rgb, r, { halo = 2.2, rim = 'rgba(255,255,255,0.85)' } = {}) {
  const R = r * halo;
  const s = Math.ceil(R * 2) + 2;
  const c = env.createCanvas(s, s);
  const g = c.getContext('2d');
  const cx = s / 2;
  const col = rgbToHex(rgb);
  const [R0, G0, B0] = rgb.map(Math.round);
  const gr = g.createRadialGradient(cx, cx, r * 0.6, cx, cx, R);
  gr.addColorStop(0, `rgba(${R0},${G0},${B0},0.55)`);
  gr.addColorStop(1, `rgba(${R0},${G0},${B0},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  const body = g.createRadialGradient(cx - r * 0.3, cx - r * 0.3, r * 0.1, cx, cx, r);
  body.addColorStop(0, 'rgba(255,255,255,0.95)');
  body.addColorStop(0.35, col);
  body.addColorStop(1, rgbToHex(rgb.map(v => v * 0.7)));
  g.fillStyle = body; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = rim; g.lineWidth = Math.max(1.5, r * 0.18); g.beginPath(); g.arc(cx, cx, r * 0.92, 0, Math.PI * 2); g.stroke();
  return c;
}

/** Comet tail sprite pointing along +x, tip at the right edge (ball centre). */
export function makeCometSprite(env, rgb, len, width) {
  const c = env.createCanvas(Math.ceil(len), Math.ceil(width * 2) + 2);
  const g = c.getContext('2d');
  const h = c.height / 2;
  const [r, gg, b] = rgb.map(Math.round);
  const gr = g.createLinearGradient(0, 0, len, 0);
  gr.addColorStop(0, `rgba(${r},${gg},${b},0)`);
  gr.addColorStop(0.7, `rgba(${r},${gg},${b},0.45)`);
  gr.addColorStop(1, `rgba(${Math.min(255, r + 80)},${Math.min(255, gg + 80)},${Math.min(255, b + 80)},0.95)`);
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, h); g.lineTo(len, h - width); g.lineTo(len, h + width); g.closePath(); g.fill();
  return c;
}

export function drawSpriteCentered(ctx, sprite, x, y, alpha = 1, scale = 1) {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  const w = sprite.width * scale, h = sprite.height * scale;
  ctx.drawImage(sprite, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 1;
}

export function drawComet(ctx, sprite, x, y, dx, dy, alpha = 1) {
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y); ctx.rotate(a);
  ctx.drawImage(sprite, -sprite.width, -sprite.height / 2);
  ctx.restore();
}

/** Fit font size so text fits maxWidth, capped at maxSize. */
export function fitFont(ctx, text, maxSize, maxWidth) {
  let size = maxSize;
  ctx.font = `${size}px ${STYLE.font}`;
  const w = ctx.measureText(text).width;
  if (w > maxWidth) size = Math.floor(maxSize * maxWidth / w);
  return size;
}

/** Title (hook) + counter line in the reference layout. counter = [{text, color}] segments. */
export function drawHeader(ctx, W, { title, titleY = 255, counter, counterY = 365, handle, handleY = 440 }) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const lines = Array.isArray(title) ? title : [title];
  const size = Math.min(...lines.map(l => fitFont(ctx, l, 58, 970)));
  ctx.font = `${size}px ${STYLE.font}`;
  ctx.fillStyle = STYLE.text;
  const lh = size * 1.18;
  lines.forEach((l, i) => {
    const w = ctx.measureText(l).width;
    ctx.fillText(l, (W - w) / 2, titleY - (lines.length - 1 - i) * lh);
  });
  if (counter) {
    ctx.font = `55px ${STYLE.font}`;
    const total = counter.reduce((s, seg) => s + ctx.measureText(seg.text).width, 0);
    let x = (W - total) / 2;
    for (const seg of counter) { ctx.fillStyle = seg.color; ctx.fillText(seg.text, x, counterY); x += ctx.measureText(seg.text).width; }
  }
  if (handle) {
    ctx.font = `30px ${STYLE.font}`;
    ctx.fillStyle = 'rgba(120,135,165,0.55)';
    const w = ctx.measureText(handle).width;
    ctx.fillText(handle, (W - w) / 2, handleY);
  }
}

/** Ring that brightens and ripples outwards: age in seconds since trigger. */
export function drawRipple(ctx, x, y, age, { r0 = 20, r1 = 90, dur = 0.7, color = '255,216,100' } = {}) {
  if (age < 0 || age > dur) return;
  const u = age / dur;
  const r = r0 + (r1 - r0) * (1 - (1 - u) * (1 - u));
  ctx.strokeStyle = `rgba(${color},${clamp(0.55 * (1 - u), 0, 1)})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

export function drawFocusRing(ctx, x, y, lit = 0) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = STYLE.focusDim;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.stroke();
  if (lit > 0) {
    ctx.globalAlpha = clamp(lit, 0, 1);
    ctx.strokeStyle = STYLE.focusLit; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,200,0.8)';
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Multiply a layer's alpha by `keep` (0..1) — deterministic exponential trail fade. */
export function fadeLayer(g, W, H, keep) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = `rgba(0,0,0,${1 - keep})`;
  g.fillRect(0, 0, W, H);
  g.restore();
}
