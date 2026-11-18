// mean luminance and hue histogram (12 bins, weighted by saturation*value) of the content region; prints L1 distance between two images
import { loadImage, createCanvas } from '@napi-rs/canvas';
async function stats(f) {
  const img = await loadImage(f); const c = createCanvas(270, 480); const g = c.getContext('2d'); g.drawImage(img, 0, 0, 270, 480);
  const d = g.getImageData(0, 37, 270, 338).data; const h = new Float64Array(12); let lum = 0, w = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    lum += 0.2126 * r + 0.7152 * gg + 0.0722 * b; const s = mx - mn; if (s < 0.08) continue;
    let hue = mx === r ? ((gg - b) / s) % 6 : mx === gg ? (b - r) / s + 2 : (r - gg) / s + 4; hue = (hue + 6) % 6;
    h[Math.floor(hue * 2) % 12] += s * mx; w += s * mx;
  }
  return { lum: lum / (d.length / 4), hist: [...h].map(v => v / (w || 1)), chroma: w / (d.length / 4) };
}
const [a, b] = await Promise.all(process.argv.slice(2, 4).map(stats));
const l1 = a.hist.reduce((s, v, i) => s + Math.abs(v - b.hist[i]), 0);
console.log(`lum ${a.lum.toFixed(4)} vs ${b.lum.toFixed(4)} | chroma ${a.chroma.toFixed(4)} vs ${b.chroma.toFixed(4)} | hueL1 ${l1.toFixed(3)}`);
