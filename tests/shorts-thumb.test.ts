// Shorts thumbnails: YouTube crops them to 9:16 around the centre, so the picture sent must already be 9:16 and the hook text
// must survive that crop. Regression for the wide 1280×720 picture that lost its text (only a "?" was left).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { drawCovers } from '../apps/server/cover.ts';
import { getTheme } from '../packages/theme/index.ts';
import { COVER_TALL, COVER_WIDE, shortsCrop, isShortsRatio, inside, imageSize, THUMB_MAX_BYTES, type Box } from '../packages/publish/cover.ts';
import { thumbProblem, uploadThumbName } from '../packages/publish/index.ts';

const frame = () => { const c = createCanvas(1080, 1920), x = c.getContext('2d'); x.fillStyle = '#05060f'; x.fillRect(0, 0, 1080, 1920); x.fillStyle = '#c45'; x.fillRect(300, 900, 480, 500); return c.toBuffer('image/png'); };
const HOOK = 'Can two curved mirrors funnel them all?';
const theme = getTheme('neon-night') ?? getTheme('classic');

/** bounding box of what differs between the picture with text and the same picture without it */
async function textBox(withText: Buffer, bare: Buffer): Promise<Box> {
  const a = await loadImage(withText), b = await loadImage(bare), w = a.width, h = a.height;
  const px = (img: typeof a) => { const c = createCanvas(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const A = px(a), B = px(b); let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

test('YouTube\'s centre crop to 9:16: a tall 9:16 picture is kept whole, a wide one loses its sides', () => {
  const tall = shortsCrop(COVER_TALL.w, COVER_TALL.h);
  assert.deepEqual(tall, { x: 0, y: 0, w: 1080, h: 1920 });
  const wide = shortsCrop(COVER_WIDE.w, COVER_WIDE.h);
  assert.equal(wide.h, 720); assert.ok(Math.abs(wide.w - 405) <= 1); assert.ok(Math.abs(wide.x - 437.5) <= 1);
  // the wide layout's text and panel are cut: this is the bug that reached YouTube
  assert.equal(inside(COVER_WIDE.text, wide), false);
  assert.equal(inside(COVER_WIDE.panel, wide), false);
  assert.equal(inside(COVER_TALL.text, tall), true);
});

test('the drawn Shorts picture is 9:16, within the size limit, and its hook text lies inside the centre crop and the safe zone', async () => {
  const f = frame();
  const withText = await drawCovers(f, HOOK, theme), bare = await drawCovers(f, '', theme);
  const dim = imageSize(withText.cover)!;
  assert.equal(dim.type, 'jpeg'); assert.deepEqual([dim.width, dim.height], [1080, 1920]);
  assert.ok(isShortsRatio(dim.width, dim.height));
  assert.ok(withText.cover.length < THUMB_MAX_BYTES);
  // simulate YouTube: crop the centre 9:16 and look for the text inside what is kept
  const crop = shortsCrop(dim.width, dim.height);
  const t = await textBox(withText.cover, bare.cover);
  assert.ok(t.w > 300 && t.h > 100, 'the hook text was drawn');
  assert.ok(inside(t, crop), `text ${JSON.stringify(t)} must be inside the crop ${JSON.stringify(crop)}`);
  // and inside the layout box, with a margin from the left and right edges
  assert.ok(t.x >= 60 && t.x + t.w <= 1020, 'side margins');
});

test('regression: the same simulation on the wide 1280×720 picture loses its text', async () => {
  const f = frame();
  const withText = await drawCovers(f, HOOK, theme), bare = await drawCovers(f, '', theme);
  const dim = imageSize(withText.thumb)!;
  assert.deepEqual([dim.width, dim.height], [1280, 720]); assert.equal(isShortsRatio(dim.width, dim.height), false);
  const t = await textBox(withText.thumb, bare.thumb);
  assert.equal(inside(t, shortsCrop(dim.width, dim.height)), false, 'the wide picture\'s text does not survive the crop');
});

test('imageSize reads JPEG and PNG, and nothing else', async () => {
  const c = createCanvas(30, 50); const x = c.getContext('2d'); x.fillRect(0, 0, 30, 50);
  assert.deepEqual(imageSize(c.toBuffer('image/png')), { width: 30, height: 50, type: 'png' });
  assert.deepEqual(imageSize(c.toBuffer('image/jpeg', 80)), { width: 30, height: 50, type: 'jpeg' });
  assert.equal(imageSize(Buffer.from('not a picture at all, just text')), null);
});

test('which picture is sent, and when YouTube\'s thumbnail counts as wrong', () => {
  const base = { thumbFile: 'a.jpg', coverFile: 'a-cover.jpg' };
  assert.equal(uploadThumbName(base), 'a-cover.jpg');
  assert.equal(uploadThumbName({ thumbFile: 'old.png', coverFile: '' }), 'old.png', 'older records keep their (tall) frame picture');
  const y = (o: Record<string, unknown>) => ({ videoId: 'x', thumbnail: 'set', ...o }) as never;
  assert.match(thumbProblem({ ...base, youtube: y({ thumbSent: '' }) }), /wide 1280×720/, 'uploaded before thumbSent existed: the wide one went out');
  assert.match(thumbProblem({ ...base, youtube: y({ thumbSent: 'a.jpg' }) }), /wide 1280×720/);
  assert.equal(thumbProblem({ ...base, youtube: y({ thumbSent: 'a-cover.jpg' }) }), '');
  assert.equal(thumbProblem({ thumbFile: 'old.png', coverFile: '', youtube: y({ thumbSent: '' }) }), '', 'older tall frame picture: fine');
  assert.equal(thumbProblem({ ...base, youtube: y({ thumbnail: 'skipped' }) }), '', 'no custom thumbnail: nothing to fix');
  assert.equal(thumbProblem({ ...base }), '', 'not uploaded');
});
