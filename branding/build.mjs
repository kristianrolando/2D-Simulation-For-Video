// Branding generator (Photon Lab by default; more brands in branding/brands/<id>.json).
// Edit brand.json (name, handle, colors, font, sample thumbnail text), then run:
//   node branding/build.mjs                    Photon Lab: reads brand.json, writes branding/svg/ and branding/png/
//   node branding/build.mjs plasma-pendulum    reads branding/brands/<id>.json, writes branding/brands/<id>/{svg,png}/
// The default run is unchanged by the optional brand keys (bgLinear, mark, textCase, colors.glow, colors.hi, gridSize, gridOpacity): without them the output is byte-identical.
//   mark: "lissajous" (fourier-loom) draws a two-frequency curve over a faint grid, and uses curves instead of bouncing-ball trails in banner/cover decoration.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRANDING = path.dirname(fileURLToPath(import.meta.url));
const BRAND_ID = process.argv[2] || '';
if (BRAND_ID && !/^[a-z0-9-]+$/.test(BRAND_ID)) { console.error('Brand id: lowercase letters, digits and dashes only.'); process.exit(1); }
const DIR = BRAND_ID ? path.join(BRANDING, 'brands', BRAND_ID) : BRANDING;
const B = JSON.parse(fs.readFileSync(BRAND_ID ? path.join(BRANDING, 'brands', BRAND_ID + '.json') : path.join(BRANDING, 'brand.json'), 'utf8'));
const ROOT = path.resolve(BRANDING, '..');
const upper = (s) => (B.textCase === 'none' ? String(s) : String(s).toUpperCase());
const C = B.colors;
const FONT = B.fonts.display;
const FONT_FILE = B.fonts.displayFile ? path.resolve(ROOT, B.fonts.displayFile) : '';
if (FONT_FILE && fs.existsSync(FONT_FILE)) GlobalFonts.registerFromPath(FONT_FILE, FONT);
// Unquoted list on purpose: the Skia SVG renderer drops text whose family names are quoted.
const FAMILY = `${FONT}, ${B.fonts.fallback}`.replace(/['"]/g, '');

fs.mkdirSync(path.join(DIR, 'svg'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'png'), { recursive: true });

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => Math.round(n * 10) / 10;
const measureCtx = createCanvas(10, 10).getContext('2d');
const textWidth = (s, size) => { measureCtx.font = `700 ${size}px "${FONT}"`; return measureCtx.measureText(s).width; };
// largest size <= max that fits width
const fitSize = (s, maxW, maxSize) => { let sz = maxSize; while (sz > 8 && textWidth(s, sz) > maxW) sz -= 1; return sz; };
// wrap words into <= maxLines lines that fit maxW; returns {size, lines}
function fitWrap(s, maxW, maxH, maxSize, maxLines = 3, lh = 1.0) {
  const words = s.split(/\s+/);
  for (let sz = maxSize; sz > 10; sz -= 2) {
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (textWidth(t, sz) <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    const ok = lines.length <= maxLines && lines.every((l) => textWidth(l, sz) <= maxW) && lines.length * sz * lh <= maxH;
    if (ok) return { size: sz, lines };
  }
  return { size: 10, lines: [s] };
}
// DIN Condensed cap height ~0.7em; place baseline so caps sit inside a box starting at `top`
const capBase = (top, size) => top + size * 0.72;

const defs = (w, h, id = 'bg', extra = '') => `
  <defs>${extra}
    ${B.bgLinear
      ? `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${B.bgLinear[0]}"/><stop offset="0.5" stop-color="${B.bgLinear[1]}"/><stop offset="1" stop-color="${B.bgLinear[2]}"/></linearGradient>`
      : `<radialGradient id="${id}" cx="50%" cy="45%" r="75%">
      <stop offset="0" stop-color="${C.bg2}"/><stop offset="0.55" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </radialGradient>`}
    <pattern id="grid" width="${B.gridSize || 48}" height="${B.gridSize || 48}" patternUnits="userSpaceOnUse">
      <path d="M${B.gridSize || 48} 0H0V${B.gridSize || 48}" fill="none" stroke="${C.grid}" stroke-width="1" opacity="${B.gridOpacity ?? '0.10'}"/>
    </pattern>
    <filter id="blurS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="blurM" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="blurL" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
  </defs>`;
const background = (w, h) => `<rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#grid)"/>`;
// neon = blurred halo copy + sharp copy
const glow = (inner, blur = 'blurM', op = 0.9) => `<g filter="url(#${blur})" opacity="${op}">${inner}</g>${inner}`;

// ---------- logo mark: reticle ring + photon path drawing a "P" (also reads as a play ▶) ----------
function mark(cx, cy, R, { ticks = true, glowOn = true, dark = true, mono = false } = {}) {
  const sw = R * 0.075, pw = R * 0.2;
  const sx = cx - R * 0.34, top = cy - R * 0.56, bot = cy + R * 0.56;
  const tipX = cx + R * 0.44, tipY = cy - R * 0.1, midY = cy + R * 0.18;
  const ring = mono ? C.text : C.core, pcol = C.text, dot = mono ? C.text : C.accent;
  const ringEl = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="none" stroke="${ring}" stroke-width="${f(sw)}"/>`;
  const tickEl = ticks ? [0, 90, 180, 270].map((a) => {
    const r = (a * Math.PI) / 180, r1 = R + sw * 1.4, r2 = R + sw * 3.6;
    return `<line x1="${f(cx + Math.cos(r) * r1)}" y1="${f(cy + Math.sin(r) * r1)}" x2="${f(cx + Math.cos(r) * r2)}" y2="${f(cy + Math.sin(r) * r2)}" stroke="${ring}" stroke-width="${f(sw * 0.9)}" stroke-linecap="round"/>`;
  }).join('') : '';
  const pPath = `<polyline points="${f(sx)},${f(bot)} ${f(sx)},${f(top)} ${f(tipX)},${f(tipY)} ${f(sx)},${f(midY)}" fill="none" stroke="${pcol}" stroke-width="${f(pw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const pHalo = `<polyline points="${f(sx)},${f(bot)} ${f(sx)},${f(top)} ${f(tipX)},${f(tipY)} ${f(sx)},${f(midY)}" fill="none" stroke="${ring}" stroke-width="${f(pw * 1.5)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dotEl = `<circle cx="${f(tipX)}" cy="${f(tipY)}" r="${f(R * 0.14)}" fill="${dot}"/>`;
  const fill = dark ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R - sw / 2)}" fill="${C.bg0}" opacity="0.75"/>` : '';
  return `<g>
    ${fill}
    ${glowOn ? `<g filter="url(#blurM)" opacity="0.85">${ringEl}${tickEl}${pHalo}</g>` : ''}
    ${ringEl}${tickEl}
    ${glowOn ? `<g filter="url(#blurS)" opacity="0.9">${pHalo}</g>` : ''}
    ${pPath}
    ${glowOn ? `<circle cx="${f(tipX)}" cy="${f(tipY)}" r="${f(R * 0.2)}" fill="${dot}" filter="url(#blurS)" opacity="0.7"/>` : ''}
    ${dotEl}
  </g>`;
}

// ---------- logo mark "pendulum": a swinging bob with fading echoes on a glowing arc (brands with "mark": "pendulum") ----------
function pendulumMark(cx, cy, R, { ticks = true, glowOn = true, dark = true, mono = false } = {}) {
  const halo = mono ? C.text : (C.glow || C.core), main = mono ? C.text : C.core, hot = mono ? C.text : C.accent;
  const px = cx, py = cy - R * 0.66, L = R * 1.34, sw = R * 0.07;
  const at = (deg) => { const a = (deg * Math.PI) / 180; return [px + Math.sin(a) * L, py + Math.cos(a) * L]; };
  const [ax, ay] = at(-48), [bx, by] = at(48);
  const arc = `<path d="M${f(ax)} ${f(ay)} A${f(L)} ${f(L)} 0 0 0 ${f(bx)} ${f(by)}" fill="none" stroke="${main}" stroke-width="${f(sw * 0.7)}" stroke-linecap="round" opacity="0.9"/>`;
  const echoes = [-8, 4, 17, 30].map((d, i) => { const [x, y] = at(d); return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(R * (0.07 + i * 0.03))}" fill="${halo}" opacity="${f(0.25 + i * 0.2)}"/>`; }).join('');
  const [hx, hy] = at(42), [sx, sy] = at(42);
  const string = `<line x1="${f(px)}" y1="${f(py)}" x2="${f(hx)}" y2="${f(hy)}" stroke="${C.text}" stroke-width="${f(sw * 0.55)}" stroke-linecap="round"/>`;
  const bob = `<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(R * 0.2)}" fill="${halo}"/><circle cx="${f(hx)}" cy="${f(hy)}" r="${f(R * 0.11)}" fill="${hot}"/>`;
  const bar = `<line x1="${f(px - R * 0.34)}" y1="${f(py)}" x2="${f(px + R * 0.34)}" y2="${f(py)}" stroke="${C.text}" stroke-width="${f(sw * 1.1)}" stroke-linecap="round"/><circle cx="${f(px)}" cy="${f(py)}" r="${f(R * 0.06)}" fill="${C.text}"/>`;
  const fill = dark ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 1.02)}" fill="${C.bg0}" opacity="0.6"/>` : '';
  return `<g>${fill}
    ${glowOn ? `<g filter="url(#blurM)" opacity="0.9">${arc}${echoes}<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(R * 0.26)}" fill="${halo}"/></g>` : ''}
    ${arc}${echoes}${string}${bar}${bob}
  </g>`;
}
// ---------- logo mark "lissajous": a 3:2 two-frequency curve with a harmonograph echo over a faint grid (brands with "mark": "lissajous") ----------
const lissPts = (cx, cy, ax, ay, fx, fy, ph, n = 720) => Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * Math.PI * 2; return `${f(cx + ax * Math.sin(fx * t + ph))},${f(cy + ay * Math.sin(fy * t))}`; }).join(' ');
function lissajousMark(cx, cy, R, { ticks = true, glowOn = true, dark = true, mono = false } = {}) {
  const halo = mono ? C.text : (C.glow || C.core), main = mono ? C.text : C.core, hi = mono ? C.text : (C.hi || C.accent), hot = mono ? C.text : C.accent;
  const A = R * 0.74, sw = R * 0.115;
  const fill = dark ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 1.02)}" fill="${C.bg0}" opacity="0.72"/>` : '';
  // faint grid, drawn as chords of the disc (no clipPath: keeps Skia output predictable)
  const gl = []; const step = R * 0.37, lim = R * 0.92;
  for (let k = -2; k <= 2; k++) { const o = k * step, h = Math.sqrt(Math.max(0, lim * lim - o * o)); gl.push(`<line x1="${f(cx - h)}" y1="${f(cy + o)}" x2="${f(cx + h)}" y2="${f(cy + o)}"/><line x1="${f(cx + o)}" y1="${f(cy - h)}" x2="${f(cx + o)}" y2="${f(cy + h)}"/>`); }
  const grid = `<g stroke="${C.grid}" stroke-width="${f(R * 0.014)}" opacity="0.55">${gl.join('')}</g>`;
  const ring = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="none" stroke="${halo}" stroke-width="${f(R * 0.028)}" opacity="0.9"/>`;
  const curve = `<polyline points="${lissPts(cx, cy, A, A, 3, 2, Math.PI / 2)}" fill="none" stroke="${main}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const echo = `<polyline points="${lissPts(cx, cy, A, A, 3, 2, Math.PI / 2 + 0.5)}" fill="none" stroke="${hi}" stroke-width="${f(sw * 0.38)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  const t0 = 0.62, dx = cx + A * Math.sin(3 * t0 + Math.PI / 2), dy = cy + A * Math.sin(2 * t0);
  return `<g>${fill}${grid}${ring}
    ${glowOn ? `<g filter="url(#blurM)" opacity="0.9">${curve}</g>` : ''}
    ${echo}${curve}
    ${glowOn ? `<circle cx="${f(dx)}" cy="${f(dy)}" r="${f(R * 0.2)}" fill="${hot}" filter="url(#blurS)" opacity="0.7"/>` : ''}
    <circle cx="${f(dx)}" cy="${f(dy)}" r="${f(R * 0.105)}" fill="${hot}"/>
  </g>`;
}
const markFn = (...a) => (B.mark === 'pendulum' ? pendulumMark(...a) : B.mark === 'lissajous' ? lissajousMark(...a) : mark(...a));

// ---------- photon trails: a ball bouncing in a rectangle ----------
function boxTrail(x0, y0, w, h, sx, sy, ang, len, color, width, op) {
  let x = sx, y = sy, dx = Math.cos(ang), dy = Math.sin(ang), left = len;
  const pts = [[x, y]];
  while (left > 0) {
    const tx = dx > 0 ? (x0 + w - x) / dx : (x0 - x) / dx;
    const ty = dy > 0 ? (y0 + h - y) / dy : (y0 - y) / dy;
    const t = Math.min(tx, ty, left);
    x += dx * t; y += dy * t; left -= t; pts.push([x, y]);
    if (t === tx) dx = -dx; else if (t === ty) dy = -dy;
  }
  const p = pts.map(([a, b]) => `${f(a)},${f(b)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  return { svg: `<polyline points="${p}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" opacity="${op}"/>`, end: [ex, ey] };
}

// ---------- render ----------
async function out(name, w, h, svg, { jpg = false } = {}) {
  fs.writeFileSync(path.join(DIR, 'svg', name + '.svg'), svg);
  const img = await loadImage(Buffer.from(svg));
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const png = await c.encode('png');
  fs.writeFileSync(path.join(DIR, 'png', name + '.png'), png);
  let line = `${name}.png  ${w}x${h}  ${(png.length / 1024).toFixed(0)} KB`;
  if (jpg) { const j = await c.encode('jpeg', 92); fs.writeFileSync(path.join(DIR, 'png', name + '.jpg'), j); line += `  (+ .jpg ${(j.length / 1024).toFixed(0)} KB)`; }
  console.log(line);
}
const svgOpen = (w, h, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${extra}>`;
const text = (x, y, size, s, fill, anchor = 'start', op = 1) =>
  `<text x="${f(x)}" y="${f(y)}" font-family="${FAMILY}" font-weight="700" font-size="${size}" fill="${fill}" text-anchor="${anchor}" opacity="${op}">${esc(s)}</text>`;

// 1) Profile picture 800x800 (all content inside the crop circle)
{
  const W = 800;
  const svg = `${svgOpen(W, W)}${defs(W, W)}${background(W, W)}
  <circle cx="400" cy="400" r="400" fill="url(#bg)" opacity="0.4"/>
  ${markFn(400, 400, 270)}
  </svg>`;
  await out('profile_800', W, W, svg);
}

// 2) Banner 2560x1440, important content only in the 1546x423 centre safe area
{
  const W = 2560, H = 1440, SW = 1546, SH = 423, SX = (W - SW) / 2, SY = (H - SH) / 2;
  const R = 150, markD = (R + R * 0.075 * 3.6) * 2; // ring + ticks
  const gap = 64, pad = 40;
  const textMax = SW - pad * 2 - markD - gap;
  const name = upper(B.name);
  const nameSize = fitSize(name, textMax, 230);
  const line2 = upper(B.bannerLine);
  const tag = upper(B.tagline);
  const tagSize = fitSize(tag, textMax, 84);
  const l2Size = fitSize(line2, textMax, 52);
  const blockW = Math.max(textWidth(name, nameSize), textWidth(tag, tagSize), textWidth(line2, l2Size));
  const groupW = markD + gap + blockW;
  const gx = SX + (SW - groupW) / 2;
  const capN = nameSize * 0.7, capT = tagSize * 0.7, capL = l2Size * 0.7, g1 = 34, g2 = 30;
  const blockH = capT + g1 + capN + g2 + capL;
  const by = SY + (SH - blockH) / 2;
  const tx = gx + markD + gap;
  const yT = by + capT, yN = yT + g1 + capN, yL = yN + g2 + capL;
  // decorative trails across the whole canvas (outside-safe decoration, faint behind centre)
  const liss = B.mark === 'lissajous';
  const trails = liss ? [
    { svg: `<polyline points="${lissPts(500, 420, 520, 330, 3, 2, 1.2)}" fill="none" stroke="${C.core}" stroke-width="3" opacity="0.30"/>`, end: [500 + 520 * Math.sin(1.2), 420] },
    { svg: `<polyline points="${lissPts(2060, 1020, 560, 340, 5, 4, 0.6)}" fill="none" stroke="${C.core}" stroke-width="2" opacity="0.22"/>`, end: [2060 + 560 * Math.sin(0.6), 1020] },
    { svg: `<polyline points="${lissPts(1280, 1250, 900, 150, 4, 3, 0.3)}" fill="none" stroke="${C.hi || C.accent}" stroke-width="2" opacity="0.30"/>`, end: [1280 + 900 * Math.sin(0.3), 1250] },
  ] : [
    boxTrail(0, 0, W, H, 120, 300, 0.42, 9000, C.core, 3, 0.35),
    boxTrail(0, 0, W, H, 2400, 1200, -2.6, 7000, C.core, 2, 0.22),
    boxTrail(0, 0, W, H, 900, 1380, -1.1, 6000, C.accent, 2, 0.18),
  ];
  const dots = trails.map((t, i) => `<circle cx="${f(t.end[0])}" cy="${f(t.end[1])}" r="${i === 2 ? 9 : 11}" fill="${i === 2 ? C.accent : C.core}"/>`).join('');
  // Skia ignores stop-opacity, so the soft scrim is a blurred, semi-transparent ellipse instead
  const scrim = `<filter id="blurXL" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="110"/></filter>`;
  const svg = `${svgOpen(W, H)}${defs(W, H, 'bg', scrim)}
  ${background(W, H)}
  <g filter="url(#blurS)">${trails.map((t) => t.svg).join('')}</g>${trails.map((t) => t.svg).join('')}
  <g filter="url(#blurM)">${dots}</g>${dots}
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="${SW * 0.6}" ry="${SH * 0.85}" fill="${C.bg0}" opacity="0.8" filter="url(#blurXL)"/>
  ${markFn(gx + markD / 2, H / 2, R)}
  ${text(tx, yT, tagSize, tag, C.accent)}
  ${glow(text(tx, yN, nameSize, name, C.core), 'blurM', 0.8)}
  ${text(tx, yN, nameSize, name, C.text)}
  ${text(tx, yL, l2Size, line2, C.muted)}
  </svg>`;
  await out('banner_2560x1440', W, H, svg, { jpg: true });
  console.log(`  banner text block ${f(groupW)}px wide of ${SW} safe; name ${nameSize}px`);
}

// 3) Watermark 150x150, transparent background
{
  const W = 150;
  const svg = `${svgOpen(W, W)}${defs(W, W)}
  <circle cx="75" cy="75" r="62" fill="${C.bg0}" opacity="0.55"/>
  ${markFn(75, 75, 52, { ticks: true, glowOn: false, dark: false })}
  </svg>`;
  await out('watermark_150', W, W, svg);
}

// 4) Thumbnail / cover templates
function hudCorners(x, y, w, h, len, col, sw, op = 0.8) {
  const c = (px, py, sx, sy) => `<path d="M${f(px + sx * len)} ${f(py)}H${f(px)}V${f(py + sy * len)}" fill="none" stroke="${col}" stroke-width="${sw}" opacity="${op}"/>`;
  return c(x, y, 1, 1) + c(x + w, y, -1, 1) + c(x, y + h, 1, -1) + c(x + w, y + h, -1, -1);
}
function arena(x, y, w, h, seed) {
  if (B.mark === 'lissajous') {
    const cx = x + w / 2, cy = y + h / 2, ax = w / 2 - 36, ay = h / 2 - 36;
    const curve = `<polyline points="${lissPts(cx, cy, ax, ay, 3, 2, 1.1 + seed)}" fill="none" stroke="${C.text}" stroke-width="4" stroke-linejoin="round" opacity="0.8"/>`;
    const echo = `<polyline points="${lissPts(cx, cy, ax * 0.8, ay * 0.8, 5, 4, 0.4 + seed)}" fill="none" stroke="${C.hi || C.core}" stroke-width="3" stroke-linejoin="round" opacity="0.6"/>`;
    const gl = []; for (let k = 1; k < 6; k++) gl.push(`<line x1="${f(x + (w * k) / 6)}" y1="${y}" x2="${f(x + (w * k) / 6)}" y2="${y + h}"/><line x1="${x}" y1="${f(y + (h * k) / 6)}" x2="${x + w}" y2="${f(y + (h * k) / 6)}"/>`);
    const px = cx + ax * Math.sin(3 * 0.7 + 1.1 + seed), py = cy + ay * Math.sin(2 * 0.7);
    const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.04}" fill="none" stroke="${C.core}" stroke-width="5"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.04}" fill="${C.bg0}" opacity="0.55"/>
      <g stroke="${C.grid}" stroke-width="1.5" opacity="0.35">${gl.join('')}</g>
      ${glow(box, 'blurM', 0.9)}<g filter="url(#blurS)">${curve}</g>${curve}${echo}
      <g filter="url(#blurM)"><circle cx="${f(px)}" cy="${f(py)}" r="${w * 0.028}" fill="${C.accent}"/></g><circle cx="${f(px)}" cy="${f(py)}" r="${w * 0.028}" fill="${C.accent}"/>`;
  }
  const inner = [0.62, 1.9, 4.05, 5.2].map((a, i) => boxTrail(x + 8, y + 8, w - 16, h - 16, x + w / 2, y + h / 2, a + seed, (w + h) * 2.2, i % 2 ? C.core : C.text, 3, 0.55));
  const dots = inner.map((t, i) => `<circle cx="${f(t.end[0])}" cy="${f(t.end[1])}" r="${w * 0.028}" fill="${i === 0 ? C.accent : C.core}"/>`).join('');
  const box = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.04}" fill="none" stroke="${C.core}" stroke-width="5"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.04}" fill="${C.bg0}" opacity="0.55"/>
    ${glow(box, 'blurM', 0.9)}<g filter="url(#blurS)">${inner.map((t) => t.svg).join('')}</g>${inner.map((t) => t.svg).join('')}
    <g filter="url(#blurM)">${dots}</g>${dots}`;
}
function counterTag(x, y, label, value, size, anchor = 'start') {
  const s = `${label}: ${value}`, tw = textWidth(s, size), padX = size * 0.45, h = size * 1.15;
  const bx = anchor === 'middle' ? x - tw / 2 - padX : x;
  return `<rect x="${f(bx)}" y="${f(y)}" width="${f(tw + padX * 2)}" height="${f(h)}" rx="${f(h * 0.18)}" fill="${C.bg0}" stroke="${C.accent}" stroke-width="4" opacity="0.95"/>
    ${text(bx + padX, capBase(y + (h - size * 0.7) / 2 - size * 0.0, size) - size * 0.02, size, s, C.accent)}`;
}
function guideBox(x, y, w, h, col, label) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="3" stroke-dasharray="14 10"/>
  <text x="${x + 14}" y="${y + 36}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="${col}">${esc(label)}</text>`;
}
const T = B.thumb;

// 4a) Shorts cover 1080x1920
{
  const W = 1080, H = 1920;
  const TZ = { x: 90, y: 250, w: 840, h: 430 }; // title zone
  const CZ = { y: 720, h: 120 }; // counter zone
  const AZ = { x: 140, y: 900, w: 720, h: 560 }; // simulation frame
  const title = upper(T.title);
  const wrap = fitWrap(title, TZ.w, TZ.h - 70, 150, 3, 1.02);
  const kicker = `${T.series} #${T.number}`;
  const lines = wrap.lines.map((l, i) => {
    const y = capBase(TZ.y + 70 + i * wrap.size * 1.02, wrap.size);
    return glow(text(W / 2, y, wrap.size, l, C.core, 'middle'), 'blurM', 0.55) + text(W / 2, y, wrap.size, l, C.text, 'middle');
  }).join('');
  const body = (guides) => `${svgOpen(W, H)}${defs(W, H)}${background(W, H)}
  ${hudCorners(40, 40, W - 80, H - 80, 70, C.core, 4, 0.5)}
  ${text(W / 2, capBase(TZ.y, 44), 44, kicker, C.accent, 'middle')}
  ${lines}
  ${counterTag(W / 2, CZ.y, T.counterLabel, T.counterValue, 72, 'middle')}
  ${arena(AZ.x, AZ.y, AZ.w, AZ.h, 0.3)}
  ${text(W / 2, 1530, 40, B.handle, C.muted, 'middle', 0.9)}
  ${guides ? guideBox(TZ.x, TZ.y, TZ.w, TZ.h, '#3ef2ff', 'TITLE SAFE') + guideBox(TZ.x, CZ.y, TZ.w, CZ.h, '#d6ff3a', 'COUNTER') + guideBox(AZ.x, AZ.y, AZ.w, AZ.h, '#ffffff', 'SIMULATION FRAME') + guideBox(0, 0, W, 170, '#ff4d6d', 'UI: top bar / search') + guideBox(0, 1560, W, 360, '#ff4d6d', 'UI: title, channel, music') + guideBox(940, 900, 140, 660, '#ff4d6d', 'BTNS') : ''}
  </svg>`;
  await out('shorts_cover_1080x1920', W, H, body(false));
  await out('shorts_cover_1080x1920_guides', W, H, body(true));
}

// 4b) Landscape thumbnail 1280x720
{
  const W = 1280, H = 720;
  const TZ = { x: 64, y: 110, w: 640, h: 330 };
  const AZ = { x: 790, y: 120, w: 420, h: 420 };
  const title = upper(T.title);
  const wrap = fitWrap(title, TZ.w, TZ.h, 130, 3, 1.02);
  const lines = wrap.lines.map((l, i) => {
    const y = capBase(TZ.y + i * wrap.size * 1.02, wrap.size);
    return glow(text(TZ.x, y, wrap.size, l, C.core), 'blurM', 0.55) + text(TZ.x, y, wrap.size, l, C.text);
  }).join('');
  const body = (guides) => `${svgOpen(W, H)}${defs(W, H)}${background(W, H)}
  ${hudCorners(24, 24, W - 48, H - 48, 48, C.core, 3, 0.5)}
  ${text(TZ.x, capBase(56, 36), 36, `${T.series} #${T.number}`, C.accent)}
  ${lines}
  ${counterTag(TZ.x, 480, T.counterLabel, T.counterValue, 56)}
  ${arena(AZ.x, AZ.y, AZ.w, AZ.h, 0.9)}
  ${text(TZ.x, 640, 30, B.handle, C.muted)}
  ${guides ? guideBox(TZ.x, TZ.y, TZ.w, TZ.h, '#3ef2ff', 'TITLE SAFE') + guideBox(TZ.x, 470, TZ.w, 100, '#d6ff3a', 'COUNTER') + guideBox(AZ.x, AZ.y, AZ.w, AZ.h, '#ffffff', 'SIMULATION FRAME') + guideBox(1090, 640, 190, 80, '#ff4d6d', 'TIME') : ''}
  </svg>`;
  await out('thumb_1280x720', W, H, body(false));
  await out('thumb_1280x720_guides', W, H, body(true));
}
