// Shared Node start-up for everything that renders (worker, CLI, thumbnails, bench, tests):
// bundled fonts + style themes, registered exactly once per process.
import { GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { loadThemeDir } from '../../packages/theme/node.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** bundled (freely licensed) fonts; themes list them as the last fallback in their font stacks.
 *  System fonts (Futura, Menlo, ...) are picked up by @napi-rs/canvas automatically when present. */
export const BUNDLED_FONTS: [string, string][] = [
  ['DejaVuSans-Bold.ttf', 'DejaVuSansBold'], ['DejaVuSansMono-Bold.ttf', 'DejaVuSansMonoBold'],
  ['DejaVuSansCondensed-Bold.ttf', 'DejaVuSansCondensedBold'], ['DejaVuSerif-Bold.ttf', 'DejaVuSerifBold'],
];
let done = false;
export function setupHost() {
  if (done) return; done = true;
  for (const [file, family] of BUNDLED_FONTS) GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts', file), family);
  loadThemeDir();
}
setupHost();
