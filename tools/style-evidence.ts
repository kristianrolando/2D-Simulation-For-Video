// Evidence that every style differs from the references and from each other.
// Renders one scene frame in every style, grabs a frame of a matching reference video, and compares:
//   bgRef   share of pixels that look like the reference background (navy→black gradient, per row)
//   inkRef  share of pixels close to the reference signature inks (neon cyan #9CF3FF, gold #FFD23F)
//   hueL1   distance of the saturation-weighted hue histogram to the reference (0 = same, 2 = disjoint)
//   dRef    mean absolute RGB difference to the reference frame (0..255)
//   luma    mean brightness
// plus the pairwise mean difference between styles. Writes a markdown table and a side-by-side sheet.
//   node tools/style-evidence.ts [--scene focal-reflection] [--ref <file.mp4>] [--refAt 0.6] [--at 0.6] [--out docs/styles]
import './../apps/server/host.ts';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validate, type Ctx, type Env } from '../packages/core/index.ts';
import { sceneById } from '../packages/scenes/index.ts';
import { themeIds, getTheme } from '../packages/theme/index.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(import.meta.dirname, '..');
const sceneId = opt('--scene', 'focal-reflection');
const refFile = opt('--ref', fs.readdirSync(path.join(ROOT, 'references')).find(f => f.includes('pK5TgMQsWRQ'))!);
const at = +opt('--at', '0.6'), refAt = +opt('--refAt', '0.6'), outDir = opt('--out', path.join(ROOT, 'docs/styles'));
const params = JSON.parse(opt('--params', '{}'));
const W = 270, H = 480; // analysis resolution

function refFrame(): Uint8ClampedArray {
  const f = path.join(ROOT, 'references', refFile);
  const dur = +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString();
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(dur * refAt), '-i', f, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
  return new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, W * H * 4);
}
function styleFrame(style: string): Uint8ClampedArray {
  const s = sceneById(sceneId)!, sc = W / 1080;
  const env: Env = { createCanvas: (w, h) => createCanvas(w, h) as any, scale: sc };
  const inst = s.create(env, validate(s.schema, { ...params, style }).params);
  const c = createCanvas(W, H), ctx = c.getContext('2d') as unknown as Ctx; ctx.setTransform(sc, 0, 0, sc, 0, 0);
  inst.renderFrame(ctx, Math.floor((inst.frames - 1) * at));
  return new Uint8ClampedArray(c.data());
}

const REF_BG = (y: number): [number, number, number] => { const u = y / H; return u < 0.5 ? [4 - 6 * u, 8 - 10 * u, 34 - 28 * u] : [1 - 2 * (u - 0.5), 3 - 6 * (u - 0.5), 18 - 26 * (u - 0.5)]; };
const INKS: [number, number, number][] = [[0x9c, 0xf3, 0xff], [0xff, 0xd2, 0x3f]];
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function hueHist(p: Uint8ClampedArray) {
  const h = new Float64Array(12); let tot = 0;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    if (c < 0.08) continue;
    let hue = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; hue = (hue + 6) % 6;
    const w = c; h[Math.floor(hue * 2) % 12] += w; tot += w;
  }
  return tot ? Array.from(h, v => v / tot) : Array.from(h);
}
function metrics(p: Uint8ClampedArray, ref: Uint8ClampedArray) {
  let bg = 0, ink = 0, d = 0, luma = 0; const n = W * H;
  for (let i = 0, k = 0; i < p.length; i += 4, k++) {
    const px = [p[i], p[i + 1], p[i + 2]], y = Math.floor(k / W);
    if (dist(px, REF_BG(y)) < 18) bg++;
    if (INKS.some(c => dist(px, c) < 60)) ink++;
    d += (Math.abs(p[i] - ref[i]) + Math.abs(p[i + 1] - ref[i + 1]) + Math.abs(p[i + 2] - ref[i + 2])) / 3;
    luma += 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
  }
  return { bgRef: bg / n, inkRef: ink / n, dRef: d / n, luma: luma / n };
}

const ref = refFrame(), refHist = hueHist(ref);
const styles = themeIds();
const frames: Record<string, Uint8ClampedArray> = Object.fromEntries(styles.map(s => [s, styleFrame(s)]));
const rows = [{ name: `reference (${refFile.match(/\[(.+)\]/)?.[1]})`, ...metrics(ref, ref), hueL1: 0 }];
for (const s of styles) { const h = hueHist(frames[s]); rows.push({ name: getTheme(s).name, ...metrics(frames[s], ref), hueL1: h.reduce((a, v, i) => a + Math.abs(v - refHist[i]), 0) }); }

const pct = (x: number) => (100 * x).toFixed(1) + ' %';
let md = `Scene \`${sceneId}\` at ${at * 100}% vs reference frame at ${refAt * 100}% (${W}×${H} analysis).\n\n| | bg like reference | reference inks (cyan/gold) | hue-histogram distance | mean diff to reference | mean luma |\n|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.name} | ${pct(r.bgRef)} | ${pct(r.inkRef)} | ${r.hueL1.toFixed(2)} | ${r.dRef.toFixed(1)} | ${r.luma.toFixed(0)} |\n`;
md += `\nPairwise mean RGB difference between styles (0..255):\n\n| | ${styles.map(s => getTheme(s).name).join(' | ')} |\n|---|${styles.map(() => '---').join('|')}|\n`;
for (const a of styles) {
  md += `| ${getTheme(a).name} | ` + styles.map(b => {
    if (a === b) return '—';
    const x = frames[a], y = frames[b]; let d = 0; for (let i = 0; i < x.length; i += 4) d += (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])) / 3;
    return (d / (W * H)).toFixed(1);
  }).join(' | ') + ' |\n';
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${sceneId}-evidence.md`), md);
// side-by-side sheet: reference first
const sheet = createCanvas(W * (styles.length + 1), H + 34), g = sheet.getContext('2d');
g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '18px DejaVuSansBold'; g.fillStyle = '#fff';
[['Reference', ref], ...styles.map(s => [getTheme(s).name, frames[s]] as const)].forEach(([name, px], k) => {
  g.putImageData(new ImageData(px as Uint8ClampedArray, W, H), k * W, 34); g.fillText(String(name), k * W + 8, 24);
});
fs.writeFileSync(path.join(outDir, `${sceneId}-vs-reference.png`), sheet.toBuffer('image/png'));
console.log(md);
