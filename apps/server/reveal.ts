// Which file "Show in folder" may open: a plain file name inside output/ (a render, a long video, or the text and thumbnail files next
// to it), never a path. The page sends the name only; anything with a folder part, a parent step, a backslash or an odd extension is refused
// before the disk is looked at. Pure apart from one stat call, so it is unit-tested.
import fs from 'node:fs';
import path from 'node:path';

export type RevealResult = { ok: true; file: string } | { ok: false; status: number; error: string };
const OK_NAME = /^[\w][\w .,()+-]{0,198}\.(mp4|jpg|png|txt)$/i;

export function revealTarget(outDir: string, name: unknown): RevealResult {
  const n = typeof name === 'string' ? name : '';
  if (!n || n !== path.basename(n) || n.includes('\\') || n.includes('\0') || n.includes('..') || path.isAbsolute(n) || !OK_NAME.test(n)) return { ok: false, status: 400, error: 'That is not a file name from output/.' };
  const file = path.join(outDir, n);
  let ok = false; try { ok = fs.statSync(file).isFile(); } catch { ok = false; }
  return ok ? { ok: true, file } : { ok: false, status: 404, error: 'That file is no longer in output/.' };
}
