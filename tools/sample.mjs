// Usage: node tools/sample.mjs img.png x,y [x,y ...]   | row:y  | col:x
import { loadImage, createCanvas } from '@napi-rs/canvas';
const [file, ...pts] = process.argv.slice(2);
const img = await loadImage(file);
const c = createCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
const d = g.getImageData(0, 0, img.width, img.height).data;
const px = (x, y) => { const i = (y * img.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
const hex = (p) => '#' + p.map(v => v.toString(16).padStart(2, '0')).join('');
for (const p of pts) {
  if (p.startsWith('row:')) { const y = +p.slice(4); let s = []; for (let x = 0; x < img.width; x += 4) { const q = px(x, y); s.push(q[0] + q[1] + q[2] > 150 ? x : null); } console.log('row', y, 'bright x:', s.filter(v => v != null).join(',')); }
  else if (p.startsWith('col:')) { const x = +p.slice(4); let s = []; for (let y = 0; y < img.height; y += 4) { const q = px(x, y); s.push(q[0] + q[1] + q[2] > 150 ? y : null); } console.log('col', x, 'bright y:', s.filter(v => v != null).join(',')); }
  else { const [x, y] = p.split(',').map(Number); console.log(p, hex(px(x, y)), px(x, y).join(' ')); }
}
