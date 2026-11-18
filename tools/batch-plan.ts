// Batch plan: every scene preset + every structural variant, all with the "Main-1" style preset. Writes data/batch/plan.json.
// It renders NOTHING. Run:  node tools/batch-plan.ts            (writes the plan and prints a summary)
//                           node tools/batch-plan.ts --check    (prints the summary only)
// The plan is reproducible: same files in presets/ and style-presets/ give the same plan, in the same order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, sceneById } from '../packages/scenes/index.ts';
import { validate } from '../packages/core/schema.ts';
import { sanitizeStylePreset, serializeStylePreset } from '../packages/theme/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLAN_FILE = path.join(ROOT, 'data/batch/plan.json');
const STYLE_PRESET_ID = 'main-1';

export interface PlanItem { key: string; sceneId: string; heavy: boolean; origin: 'scene-preset' | 'variant' | 'variant+objects'; params: Record<string, unknown> }

function loadMain1(): { style: string; value: string } {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'style-presets', STYLE_PRESET_ID + '.json'), 'utf8'));
  const { preset, warnings } = sanitizeStylePreset(raw);
  if (!preset) throw new Error('Main-1 is not usable: ' + warnings.join('; '));
  return { style: String(raw.basedOn ?? 'classic'), value: serializeStylePreset(preset) };
}

export function buildPlan(): PlanItem[] {
  const look = loadMain1();
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const canon = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  const add = (origin: PlanItem['origin'], sceneId: string, key: string, params: Record<string, unknown>) => {
    const scene = sceneById(sceneId); if (!scene) throw new Error('unknown scene ' + sceneId);
    const { params: full, errors } = validate(scene.schema, { ...params, style: look.style, bgSettings: '', stylePreset: look.value });
    if (errors.length) throw new Error(`${key}: ${errors.join('; ')}`);
    const sig = sceneId + canon(full);
    if (seen.has(sig)) return;           // exactly the same video as an earlier entry
    seen.add(sig);
    items.push({ key, sceneId, heavy: sceneId === 'hammer-smash', origin, params: { ...params, style: look.style, bgSettings: '', stylePreset: look.value } });
  };

  // 1. every shipped scene preset (31)
  const presetDir = path.join(ROOT, 'presets');
  for (const f of fs.readdirSync(presetDir).filter(f => f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(presetDir, f), 'utf8'));
    add('scene-preset', j.sceneId, 'preset:' + f.replace(/\.json$/, ''), j.params ?? {});
  }
  // 2. every scene once with its defaults (scenes that no preset covers)
  for (const s of SCENES) add('variant', s.meta.id, `default:${s.meta.id}`, {});
  // 3. structural variants (enum choices that change what the video shows)
  const opts = (sceneId: string, k: string) => (sceneById(sceneId)!.schema[k] as { options: string[] }).options;
  for (const layout of opts('focal-reflection', 'layout')) add('variant', 'focal-reflection', `layout:${layout}`, { layout });
  for (const table of opts('billiard', 'table')) add('variant', 'billiard', `table:${table}`, { table });
  const OBJECTS = opts('hammer-smash', 'objects');
  for (const rule of opts('hammer-smash', 'rule')) for (const container of opts('hammer-smash', 'container'))
    add('variant', 'hammer-smash', `hammer:${rule}:${container}`, { rule, container });
  for (const rule of opts('hammer-smash', 'rule')) for (const container of opts('hammer-smash', 'container'))
    for (const objects of OBJECTS.filter(o => o !== 'ball')) add('variant+objects', 'hammer-smash', `hammer:${rule}:${container}:${objects}`, { rule, container, objects });
  const CONT = opts('sync-lines', 'container');
  for (const container of CONT) for (const laps of opts('sync-lines', 'laps')) for (const direction of opts('sync-lines', 'direction')) {
    if (container === 'ring' && direction === 'alternate') continue;   // a ring always alternates, so "same" and "alternate" look alike
    add('variant', 'sync-lines', `sync:orbits:${container}:${laps}:${direction}`, { mode: 'orbits', container, laps, direction });
  }
  for (const container of CONT) for (const motion of opts('sync-lines', 'motion')) for (const laps of opts('sync-lines', 'laps'))
    add('variant', 'sync-lines', `sync:lid:${container}:${motion}:${laps}`, { mode: 'lid', container, motion, laps });
  for (const container of CONT) for (const hidden of opts('sync-lines', 'hidden'))
    add('variant', 'sync-lines', `sync:slider:${container}:${hidden}`, { mode: 'slider', container, hidden, count: 24, duration: 45 });
  for (const container of CONT) for (const ratio of opts('sync-lines', 'ratio'))
    add('variant', 'sync-lines', `sync:close:${container}:${ratio.replace('/', 'over')}`, { mode: 'close', container, ratio });

  // order: interleave so two heavy (hammer-smash) renders are never side by side, and the first videos show every scene
  const light = items.filter(i => !i.heavy), heavy = items.filter(i => i.heavy), out: PlanItem[] = [];
  const every = Math.max(1, Math.floor(light.length / Math.max(1, heavy.length)));
  let h = 0;
  light.forEach((it, i) => { out.push(it); if ((i + 1) % every === 0 && h < heavy.length) out.push(heavy[h++]); });
  while (h < heavy.length) out.push(heavy[h++]);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const plan = buildPlan();
  const by = (f: (i: PlanItem) => string) => { const m: Record<string, number> = {}; for (const i of plan) m[f(i)] = (m[f(i)] ?? 0) + 1; return m; };
  console.log('videos in plan:', plan.length);
  console.log('by scene:', by(i => i.sceneId));
  console.log('by origin:', by(i => i.origin));
  console.log('heavy (hammer-smash):', plan.filter(i => i.heavy).length);
  const keys = new Set(plan.map(i => i.key)); if (keys.size !== plan.length) throw new Error('duplicate keys in the plan');
  if (!process.argv.includes('--check')) {
    fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true });
    fs.writeFileSync(PLAN_FILE, JSON.stringify({ version: 1, styleDescription: 'classic + style preset Main-1', createdBy: 'tools/batch-plan.ts', count: plan.length, items: plan }, null, 1));
    console.log('written:', path.relative(ROOT, PLAN_FILE));
  }
}
