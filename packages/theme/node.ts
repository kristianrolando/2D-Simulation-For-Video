// Node host helpers: load /themes/*.json once (render worker, CLI, thumbnails, benchmarks, tests).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerThemes } from './index.ts';
import { validId } from './editor.ts';

/** the themes folder; SIM_THEME_DIR points tests (and anyone who wants a private folder) somewhere else */
export const THEME_DIR = process.env.SIM_THEME_DIR ? path.resolve(process.env.SIM_THEME_DIR) : path.resolve(import.meta.dirname, '../../themes');

/** raw theme files (JSON) in name order; a file that is not valid JSON is reported and skipped */
export function readThemeFiles(dir = THEME_DIR): { list: unknown[]; errors: string[] } {
  const list: unknown[] = [], errors: string[] = [];
  if (!fs.existsSync(dir)) return { list, errors };
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    try { list.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
    catch (e) { errors.push(`${f}: ${e instanceof Error ? e.message : e}`); }
  }
  return { list, errors };
}

let loaded = false;
/** register every theme file (idempotent). Warnings go to stderr; a broken token never stops a render. */
export function loadThemeDir(dir = THEME_DIR, quiet = false) {
  if (loaded && dir === THEME_DIR) return;
  const { list, errors } = readThemeFiles(dir);
  const report = registerThemes(list);
  if (!quiet) {
    for (const e of errors) console.warn('[theme] ' + e);
    for (const [id, w] of Object.entries(report)) for (const m of w) console.warn(`[theme ${id}] ${m}`);
  }
  if (dir === THEME_DIR) loaded = true;
}

// ---------------- custom styles (made in the studio's style editor) ----------------
const fileOf = (id: string, dir: string) => path.join(dir, `${id}.json`);
const readRaw = (id: string, dir: string): any => { try { return JSON.parse(fs.readFileSync(fileOf(id, dir), 'utf8')); } catch { return null; } };
/** Short signature of a custom style's file ('' for shipped styles and unknown ids). It goes into thumbnail cache keys, so
 *  editing a custom style draws its thumbnails again, while the cache of the shipped styles stays as it is. */
export function customSig(id: string, dir = THEME_DIR): string {
  if (!validId(id)) return '';
  try { const txt = fs.readFileSync(fileOf(id, dir), 'utf8'); return JSON.parse(txt)?.custom === true ? createHash('sha1').update(txt).digest('hex').slice(0, 8) : ''; } catch { return ''; }
}
/** Writes themes/<id>.json for a custom style. A shipped style (a file without "custom": true) is never overwritten. */
export function saveCustomTheme(raw: Record<string, unknown>, dir = THEME_DIR): string {
  const id = raw.id; if (!validId(id) || id === 'classic') throw new Error('This style id cannot be used.');
  const old = readRaw(id, dir); if (fs.existsSync(fileOf(id, dir)) && old?.custom !== true) throw new Error('A shipped style has this id. Choose another name.');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fileOf(id, dir) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n'); fs.renameSync(tmp, fileOf(id, dir));
  return fileOf(id, dir);
}
/** Deletes a custom style's file (only files the editor made). Shipped styles cannot be deleted. */
export function deleteCustomTheme(id: string, dir = THEME_DIR): void {
  if (!validId(id)) throw new Error('Unknown style.');
  if (!fs.existsSync(fileOf(id, dir))) throw new Error('This style no longer exists.');
  if (readRaw(id, dir)?.custom !== true) throw new Error('Only styles made in the editor can be deleted.');
  fs.rmSync(fileOf(id, dir));
}
