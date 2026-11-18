// Node host helpers: load /themes/*.json once (render worker, CLI, thumbnails, benchmarks, tests).
import fs from 'node:fs';
import path from 'node:path';
import { registerThemes } from './index.ts';

export const THEME_DIR = path.resolve(import.meta.dirname, '../../themes');

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
