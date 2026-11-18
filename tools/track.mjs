// track brightest blob x per frame in a raw rgb24 band dump: node tools/track.mjs file w h fps
import fs from 'fs';
const [file, W, H, FPS] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const buf = fs.readFileSync(file); const fsz = W * H * 3; const n = buf.length / fsz;
const xs = [];
for (let f = 0; f < n; f++) {
  let best = -1, bx = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = f * fsz + (y * W + x) * 3; const v = buf[i] + buf[i + 1] + buf[i + 2] - Math.abs(buf[i]-buf[i+2]);
    if (v > best) { best = v; bx = x; }
  }
  xs.push(bx * 2);
}
// find local maxima (right extremes) and minima
const ext = [];
for (let i = 2; i < xs.length - 2; i++) {
  if (xs[i] >= xs[i-1] && xs[i] >= xs[i+1] && xs[i] > xs[i-2] && xs[i] >= xs[i+2] && xs[i] > 600) ext.push(['R', (i / FPS).toFixed(2), xs[i]]);
  if (xs[i] <= xs[i-1] && xs[i] <= xs[i+1] && xs[i] < xs[i-2] && xs[i] <= xs[i+2] && xs[i] < 420) ext.push(['L', (i / FPS).toFixed(2), xs[i]]);
}
console.log(ext.map(e => e.join(':')).join('  '));
