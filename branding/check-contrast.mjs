// Contrast + small-size check for a brand: node branding/check-contrast.mjs <brand-id>
// Prints WCAG ratios (text colour vs the darkest/lightest background it really sits on, measured from the PNG) and writes png/check_small_sizes.png.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url)), id = process.argv[2];
if (!id) { console.error('usage: node branding/check-contrast.mjs <brand-id>'); process.exit(1); }
const B = JSON.parse(fs.readFileSync(path.join(DIR, 'brands', id + '.json'), 'utf8')), C = B.colors, P = path.join(DIR, 'brands', id, 'png');
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rows = []; let fail = 0;
const row = (what, r, need) => { const ok = r >= need; if (!ok) fail++; rows.push(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2)}:1 (need ${need})  ${what}`); };
const bgs = (B.bgLinear || [C.bg0, C.bg1, C.bg2]);
for (const [name, col, need] of [['text', C.text, 4.5], ['accent', C.accent, 4.5], ['muted', C.muted, 4.5], ['core (large/graphic)', C.core, 3], ['glow (graphic)', C.glow || C.core, 3]])
  for (const bg of bgs) row(`${name} ${col} on ${bg}`, ratio(rgb(col), rgb(bg)), need);
// measured from the banner: for each text colour, the worst ratio against the pixels in the text rows
const banner = await loadImage(path.join(P, 'banner_2560x1440.png')), bc = createCanvas(2560, 1440), bx = bc.getContext('2d'); bx.drawImage(banner, 0, 0);
const band = bx.getImageData(507, 508, 1546, 423).data; let bgMin = 1e9, bgMax = 0;
for (let i = 0; i < band.length; i += 4 * 7) { const l = L([band[i], band[i + 1], band[i + 2]]); if (l < 0.08) { bgMin = Math.min(bgMin, l); bgMax = Math.max(bgMax, l); } } // background pixels (dark), not letters
const worstBg = [Math.round(255 * bgMax ** (1 / 2.2)), Math.round(255 * bgMax ** (1 / 2.2)), Math.round(255 * bgMax ** (1 / 2.2))];
for (const [name, col] of [['name/text', C.text], ['tagline/accent', C.accent], ['banner line/muted', C.muted]]) row(`banner ${name} vs lightest background pixel in the safe area`, ratio(rgb(col), worstBg), 4.5);
console.log(rows.join('\n')); console.log(fail ? `\n${fail} FAIL` : '\nall PASS');
// contact sheet
const S = createCanvas(1400, 900), x = S.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, 1400, 900); x.fillStyle = '#fff'; x.font = '16px sans-serif';
const prof = await loadImage(path.join(P, 'profile_800.png')); let px = 20;
for (const d of [160, 98, 48, 32]) { x.save(); x.beginPath(); x.arc(px + d / 2, 20 + d / 2, d / 2, 0, Math.PI * 2); x.clip(); x.drawImage(prof, px, 20, d, d); x.restore(); x.fillText(d + 'px', px, 20 + d + 20); px += d + 40; }
const wm = await loadImage(path.join(P, 'watermark_150.png')); x.fillStyle = '#666'; x.fillRect(px, 20, 150, 150); x.drawImage(wm, px, 20, 150, 150); x.drawImage(wm, px + 170, 20, 50, 50); x.fillStyle = '#fff'; x.fillText('watermark 150 / 50', px, 190);
// banner crops: TV = whole banner, desktop = 2560x423 band, mobile = 1546x423 safe area
const sc = (w) => w / 2560;
x.fillText('TV (full 2560x1440)', 20, 250); x.drawImage(banner, 20, 260, 640, 360);
x.fillText('Desktop (2560x423 centre band)', 700, 250); x.drawImage(banner, 0, 508, 2560, 423, 700, 260, 640, 106);
x.fillText('Mobile (1546x423 safe area, shown at phone width 360)', 700, 400); x.drawImage(banner, 507, 508, 1546, 423, 700, 410, 360, 98);
x.fillText('Mobile at 320 wide', 1080, 400); x.drawImage(banner, 507, 508, 1546, 423, 1080, 410, 300, 82);
x.fillText('Cover 1080x1920 at feed size', 20, 660); const cov = await loadImage(path.join(P, '' + ((B.examples && B.examples.cover) || 'example_pendulum-wave_cover_1080x1920.jpg') + '')); x.drawImage(cov, 20, 670, 90, 160); x.drawImage(cov, 130, 670, 45, 80);
const th = await loadImage(path.join(P, '' + ((B.examples && B.examples.thumb) || 'example_hammer-smash_thumb_1280x720.jpg') + '')); x.fillText('Thumbnail 1280x720 at 246 / 168 wide', 220, 660); x.drawImage(th, 220, 670, 246, 138); x.drawImage(th, 490, 670, 168, 94);
fs.writeFileSync(path.join(P, 'check_small_sizes.png'), await S.encode('png')); console.log('wrote', path.join('branding/brands', id, 'png/check_small_sizes.png'));
