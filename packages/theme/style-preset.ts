// Style presets as files: the pure part (what a style-presets/<id>.json file must look like, and how a bad one is reported).
// A style preset is the background + colour/font look of a video that can be laid over ANY style (see packages/theme/index.ts).
// It is not a scene preset: it has no sceneId and no scene parameters, and it never touches juice, trails or the simulation.
// Nothing here touches the disk or the DOM; the folder helpers are in node.ts.
import { sanitizeStylePreset, type StylePresetData } from './index.ts';
import { validId } from './editor.ts';

export const STYLE_PRESET_KIND = 'style-preset';
export const STYLE_PRESET_VERSION = 1;

/** the JSON file: the preset plus a kind marker, a format version and the style it was made on (information only) */
export interface StylePresetFile extends StylePresetData { kind: typeof STYLE_PRESET_KIND; version: number; basedOn: string }

export function toFile(p: StylePresetData, basedOn: string): StylePresetFile {
  return { kind: STYLE_PRESET_KIND, version: STYLE_PRESET_VERSION, ...p, basedOn: validId(basedOn) ? basedOn : 'classic' };
}

export type FileCheck = { ok: true; file: StylePresetFile } | { ok: false; error: string };
/** Is this parsed JSON a usable style preset file? Scene-format files (sceneId + params, the old "Save as preset") get their own message. */
export function checkStylePresetFile(raw: unknown): FileCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not a JSON object' };
  const r = raw as Record<string, unknown>;
  if (r.kind !== STYLE_PRESET_KIND) {
    return { ok: false, error: 'sceneId' in r || 'params' in r ? 'this is a scene preset (it has a sceneId and scene parameters), not a style preset; ignored' : 'not a style preset (kind must be "style-preset"); ignored' };
  }
  if (r.version !== STYLE_PRESET_VERSION) return { ok: false, error: `unsupported style preset version ${JSON.stringify(r.version)}; ignored` };
  const { preset, warnings } = sanitizeStylePreset(r);
  if (!preset) return { ok: false, error: (warnings[0] ?? 'invalid style preset').replace(/^style preset: /, '') };
  return { ok: true, file: toFile(preset, String(r.basedOn ?? 'classic')) };
}
