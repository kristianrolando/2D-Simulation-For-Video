// Parameter schema: one declaration drives the studio UI, validation, presets and render jobs.

interface Base { label?: string; group?: string; help?: string; /** true: changing it requires re-simulation */ sim?: boolean }
export interface NumberParam extends Base { type: 'number' | 'integer'; default: number; min: number; max: number; step?: number; unit?: string }
export interface BoolParam extends Base { type: 'boolean'; default: boolean }
export interface EnumParam extends Base { type: 'enum'; default: string; options: string[] }
export interface TextParam extends Base { type: 'text'; default: string; multiline?: boolean }
export interface ColorParam extends Base { type: 'color'; default: string }
export type ParamDef = NumberParam | BoolParam | EnumParam | TextParam | ColorParam;
export type Schema = Record<string, ParamDef>;
export type Params = Record<string, number | string | boolean>;

/** Parameters every scene has. Scenes spread this into their own schema. */
export function commonSchema(o: { title: string; duration: number; answer?: string }): Schema {
  return {
    title: { type: 'text', default: o.title, group: 'Text', label: 'Hook / title' },
    ...(o.answer !== undefined ? { answer: { type: 'text', default: o.answer, group: 'Text', label: 'Answer line ({n} = count)' } as TextParam } : {}),
    handle: { type: 'text', default: '', group: 'Text', label: 'Channel handle (optional)' },
    // the visual + audio style (a theme id from /themes); unknown ids fall back to 'classic'
    style: { type: 'text', default: 'classic', group: 'Style', label: 'Style' },
    // the style's background settings (JSON of the values that differ from the style's defaults; '' = defaults)
    bgSettings: { type: 'text', default: '', group: 'Style', label: 'Background settings' },
    // a style preset layered over the style (compact JSON copy of a style-presets/<id>.json look; '' = none). See packages/theme/index.ts
    stylePreset: { type: 'text', default: '', group: 'Style', label: 'Style preset' },
    duration: { type: 'number', default: o.duration, min: 5, max: 90, step: 0.01, unit: 's', group: 'Timing', label: 'Video length', sim: true },
  };
}

export function defaults(schema: Schema): Params {
  const p: Params = {};
  for (const [k, d] of Object.entries(schema)) p[k] = d.default;
  return p;
}

export interface Validated { params: Params; errors: string[] }

/** Merge user values over defaults, coerce types and clamp ranges. Unknown keys are reported. */
export function validate(schema: Schema, input: Record<string, unknown> = {}): Validated {
  const params = defaults(schema);
  const errors: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    const d = schema[k];
    if (!d) { errors.push(`unknown parameter "${k}"`); continue; }
    switch (d.type) {
      case 'number': case 'integer': {
        let n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) { errors.push(`${k}: not a number`); continue; }
        if (d.type === 'integer') n = Math.round(n);
        if (n < d.min || n > d.max) errors.push(`${k}: ${n} clamped to [${d.min}, ${d.max}]`);
        params[k] = Math.min(d.max, Math.max(d.min, n));
        break;
      }
      case 'boolean': params[k] = v === true || v === 'true' || v === 1; break;
      case 'enum': if (d.options.includes(String(v))) params[k] = String(v); else errors.push(`${k}: "${v}" not one of ${d.options.join('|')}`); break;
      case 'color': if (/^#[0-9a-f]{6}$/i.test(String(v))) params[k] = String(v); else errors.push(`${k}: expected #rrggbb`); break;
      default: params[k] = String(v);
    }
  }
  return { params, errors };
}

/** Keys whose change needs a re-simulation (vs. a cheap redraw). */
export function simKeys(schema: Schema): string[] {
  return Object.entries(schema).filter(([, d]) => d.sim).map(([k]) => k);
}
