// Bridge between a render (scene id + parameters) and the publishing data: the suggested texts for it,
// and a fresh Video record. Used by the server (when a render starts) and by the studio.
import { validate } from '../core/index.ts';
import { sceneById } from '../scenes/index.ts';
import { layout } from '../scenes/focal-reflection/presets.ts';
import { getTheme } from '../theme/index.ts';
import { newId, suggestMetadata, sanitizeVideo, type Suggestion, type SuggestLang, type Video } from './index.ts';
import { TOPICS, genericTopic, type Topic } from './topics.ts';
import { writeDescription, type Facts } from './copywriter.ts';

/** the hook shown on screen: the "Hook / title" parameter, or the layout's own question when it is left empty */
export function hookFor(sceneId: string, params: Record<string, unknown>): string {
  const scene = sceneById(sceneId); if (!scene) return '';
  const P = validate(scene.schema, params).params;
  const title = String(P.title ?? '').trim();
  if (title) return title;
  if (sceneId === 'focal-reflection') return layout(String(P.layout), { ellipseRx: Number(P.ellipseRx), ellipseRy: Number(P.ellipseRy) }).title;
  // templates with automatic hooks (they vary with rule and seed); two on-screen lines become one sentence
  if (scene.hook) return scene.hook(P).replace(/\n/g, ' — ');
  return '';
}

const fmt = (n: number) => String(+Number(n).toFixed(2));
const RATIO_WORDS: Record<string, string> = { pi: 'π', sqrt2: '√2', golden: 'φ', e: 'e', '7/3': '7/3', '5/2': '5/2', '8/5': '8/5' };
const pretty = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** which entry of topics.ts describes this render (some scenes tell different stories per rule) */
export function topicFor(sceneId: string, params: Record<string, unknown>): Topic {
  const scene = sceneById(sceneId);
  const P = scene ? validate(scene.schema, params).params : params;
  const key = sceneId === 'hammer-smash' ? `hammer-smash:${P.rule}` : sceneId === 'sync-lines' ? `sync-lines:${P.mode}` : sceneId;
  return TOPICS[key] ?? TOPICS[sceneId] ?? genericTopic(scene?.meta.name ?? sceneId, scene?.meta.family ?? '', scene?.meta.description ?? '');
}

/** What the parameters say, as {placeholder} values and the only numbers a title may contain. Nothing here is guessed. */
export function factsFor(sceneId: string, params: Record<string, unknown>): Facts {
  const scene = sceneById(sceneId); if (!scene) return { vars: {}, numbers: [] };
  const P = validate(scene.schema, params).params, v: Record<string, string> = {}, nums: number[] = [];
  const n = (k: string, name = k) => { const x = Number(P[k]); if (Number.isFinite(x)) { v[name] = fmt(x); nums.push(x); } };
  nums.push(Math.round(Number(P.duration)) || 0);
  switch (sceneId) {
    case 'galton-board': n('balls', 'n'); n('rows'); break;
    case 'gravity-bounce': n('balls', 'n'); { const e = Math.round(Number(P.offsetExp)); if (Number.isFinite(e)) { v.gap = `10^${e}`; nums.push(10, Math.abs(e)); } } break;
    case 'billiard': v.shape = String(P.table); n('maxBounces', 'max'); break;
    case 'focal-reflection': v.mirror = ['cassegrain', 'gregorian'].includes(String(P.layout)) ? pretty(String(P.layout)) : String(P.layout); if (Number(P.waves) > 0) n('waves'); break;
    case 'hammer-smash': n('splitInto', 'k'); n('startBalls', 'n0'); n('capacity', 'cap'); n('hammers'); v.shape = String(P.container); break;
    case 'harmonograph': n('ratioX', 'a'); n('ratioY', 'b'); break;
    case 'pendulum-wave': n('count', 'n'); break;
    case 'resonance-orbits': n('inner', 'a'); n('outer', 'b'); { const pt = Math.abs(Number(P.inner) - Number(P.outer)); v.petals = String(pt); nums.push(pt); } break;
    case 'rosette-orbit': { const d = Number(P.precessDeg); if (d > 0) { v.deg = fmt(d); v.turns = String(Math.round(360 / d)); nums.push(d, Math.round(360 / d), 360); } } break;
    case 'sync-lines': {
      n('count', 'n');
      if (String(P.mode) === 'slider') n('period');
      if (String(P.mode) === 'close') { const r = String(P.ratio); if (r in RATIO_WORDS) { v.ratio = RATIO_WORDS[r]; nums.push(...(r.match(/\d+/g) ?? []).map(Number)); if (r === 'sqrt2') nums.push(2); } }
      break;
    }
  }
  // "{s}" is the plural ending for "ball{s}": empty for one ball, so it must exist as a (possibly empty) value
  if (sceneId === 'hammer-smash') v.s = Number(P.startBalls) === 1 ? '' : 's';
  return { vars: v, numbers: [...new Set(nums)] };
}

export function suggestFor(sceneId: string, params: Record<string, unknown>, lang: SuggestLang = 'en', variant = 0): Suggestion | null {
  const scene = sceneById(sceneId); if (!scene) return null;
  const P = validate(scene.schema, params).params;
  return suggestMetadata({
    sceneName: scene.meta.name, family: scene.meta.family, sceneDescription: scene.meta.description,
    hook: hookFor(sceneId, params), styleName: getTheme(String(P.style)).name, durationSec: Number(P.duration),
    sceneId, seed: Number(P.seed ?? 0) || 0, topic: topicFor(sceneId, params), facts: factsFor(sceneId, params), variant,
  }, lang);
}

/** a description for the title the owner has now, in another wording (variant 1, 2, …). Same facts, same limits, still deterministic. */
export function descriptionFor(sceneId: string, params: Record<string, unknown>, title: string, variant: number): string | null {
  const scene = sceneById(sceneId); if (!scene) return null;
  const P = validate(scene.schema, params).params;
  return writeDescription({
    sceneId, sceneName: scene.meta.name, sceneDescription: scene.meta.description, family: scene.meta.family, hook: hookFor(sceneId, params),
    styleName: getTheme(String(P.style)).name, durationSec: Number(P.duration), seed: Number(P.seed ?? 0) || 0, topic: topicFor(sceneId, params), facts: factsFor(sceneId, params), variant,
  }, title);
}

/** a new record for a render, pre-filled with the suggestion so the form is never empty */
export function newVideoFor(sceneId: string, params: Record<string, unknown>, extra: Partial<Video> = {}, now: Date = new Date(), lang: SuggestLang = 'en'): Video | null {
  const scene = sceneById(sceneId), sug = suggestFor(sceneId, params, lang); if (!scene || !sug) return null;
  const P = validate(scene.schema, params).params;
  return sanitizeVideo({
    id: newId(now), title: sug.title, description: sug.description, tags: sug.tags, hashtags: sug.hashtags, notes: '',
    sceneId, style: String(P.style), params: P, status: 'draft', durationSec: Number(P.duration),
    createdAt: now.toISOString(), updatedAt: now.toISOString(), ...extra,
  }, now.toISOString());
}
