// Node host helpers: load /themes/*.json once (render worker, CLI, thumbnails, benchmarks, tests).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerThemes } from './index.ts';
import { validId } from './editor.ts';
import { checkStylePresetFile, type StylePresetFile } from './style-preset.ts';

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

// ---------------- style presets (style-presets/<id>.json) ----------------
/** the style presets folder; SIM_STYLE_PRESET_DIR points tests (and the test studio) somewhere else */
export const STYLE_PRESET_DIR = process.env.SIM_STYLE_PRESET_DIR ? path.resolve(process.env.SIM_STYLE_PRESET_DIR) : path.resolve(import.meta.dirname, '../../style-presets');
export interface StylePresetProblem { file: string; message: string }
/** Every usable style preset in the folder (name order) plus a message for each file that was ignored (broken JSON, a scene-format
 *  file, a bad value). Never throws: a bad file can never stop the studio or a render. */
export function readStylePresets(dir = STYLE_PRESET_DIR): { presets: StylePresetFile[]; problems: StylePresetProblem[] } {
  const presets: StylePresetFile[] = [], problems: StylePresetProblem[] = [];
  let names: string[] = []; try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return { presets, problems }; }
  for (const f of names) {
    let raw: unknown; try { raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push({ file: f, message: `not valid JSON (${e instanceof Error ? e.message : e}); ignored` }); continue; }
    const c = checkStylePresetFile(raw);
    if (!c.ok) problems.push({ file: f, message: c.error });
    else if (c.file.id + '.json' !== f) problems.push({ file: f, message: `the id "${c.file.id}" does not match the file name; ignored` });
    else presets.push(c.file);
  }
  return { presets, problems };
}
/** Writes style-presets/<id>.json atomically (a temporary file, then a rename). Without `overwrite`, an existing file is never touched. */
export function saveStylePreset(file: StylePresetFile, dir = STYLE_PRESET_DIR, overwrite = false): string {
  if (!validId(file.id)) throw new Error('This style preset id cannot be used.');
  const dest = path.join(dir, `${file.id}.json`), tmp = `${dest}.${process.pid}.tmp`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  try {
    if (overwrite) fs.renameSync(tmp, dest);
    else { try { fs.linkSync(tmp, dest); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A style preset with this name already exists.'); throw e; } fs.rmSync(tmp); }
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  return dest;
}
/** Deletes one style preset file (only inside the style presets folder, only a file that is a style preset). */
export function deleteStylePreset(id: string, dir = STYLE_PRESET_DIR): void {
  if (!validId(id)) throw new Error('Unknown style preset.');
  const f = path.join(dir, `${id}.json`);
  if (!fs.existsSync(f)) throw new Error('This style preset no longer exists.');
  let ok = false; try { ok = checkStylePresetFile(JSON.parse(fs.readFileSync(f, 'utf8'))).ok; } catch { /* not a preset */ }
  if (!ok) throw new Error('This file is not a usable style preset, so the studio leaves it alone.');
  fs.rmSync(f);
}
