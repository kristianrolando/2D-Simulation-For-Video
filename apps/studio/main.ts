// Studio UI: 1) pick (gallery with cached thumbnails + category filter) → 2) adjust (schema-driven
// controls, advanced groups folded) → 3) render (queue with live progress, updated in place).
import { validate, defaults, type Params, type ParamDef, type SceneModule } from '../../packages/core/index.ts';
import { SCENES } from '../../packages/scenes/index.ts';
import { Player, type Quality } from './player.ts';
import { benchScene } from './bench.ts';
import { setSampleBank, parseWav, type Manifest } from '../../packages/audio/bank.ts';
import { registerThemes, unregisterTheme, getTheme, themeOf, sanitizeBackground, serializeBackground, sanitizeStylePreset, captureStylePreset } from '../../packages/theme/index.ts';
import { openStyleEditor } from './style-editor.ts';
import { initVideos } from './videos.ts';
import { catColor } from './mode.ts';
import { initModeSwitch } from './mode-ui.ts';
import { icon, hydrateIcons, styleIcon, styleIconEl } from './icons.ts';
import { matchesQuery, groupByScene, shortcutFor, SHORTCUTS, friendlyError, friendlyWarnings, fmtSecs, fmtSize, progressTitle } from './ux.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e;
};
const store = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ---------------- categories: one colour + icon per physics family ----------------
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CATS: Record<string, { label: string; icon: string }> = {
  'conic mirrors': { label: 'Mirrors', icon: svg('<path d="M3 5c4 10 14 10 18 0"/><circle cx="12" cy="9" r="1.6"/><path d="M8 3v5M16 3v5"/>') },
  orbits: { label: 'Orbits', icon: svg('<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="9" ry="5"/><circle cx="20" cy="10" r="1.4"/>') },
  oscillations: { label: 'Oscillation', icon: svg('<path d="M12 2v2"/><path d="M12 4l-5 12"/><circle cx="7" cy="18" r="2.4"/><path d="M5 22h14"/>') },
  probability: { label: 'Chance', icon: svg('<path d="M3 20c3 0 4-13 9-13s6 13 9 13"/><circle cx="12" cy="3.5" r="1.2"/>') },
  chaos: { label: 'Chaos', icon: svg('<path d="M3 12c3-6 5 6 8 0s5 6 10-2"/><path d="M3 17c4-3 7 2 10-1s5 1 8 1"/>') },
  geometry: { label: 'Geometry', icon: svg('<path d="M12 3l9 16H3z"/><path d="M8 19l6-9"/>') },
  smash: { label: 'Smash', icon: svg('<path d="M4 20l9-9"/><rect x="12" y="3" width="9" height="6" rx="1.5" transform="rotate(45 16.5 6)"/><circle cx="6" cy="8" r="1.6"/><circle cx="19" cy="18" r="1.6"/>') },
  sync: { label: 'Sync', icon: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v18"/><circle cx="12" cy="3" r="1.4"/><circle cx="12" cy="7" r="1.4"/>') },
};
const cat = (family: string) => ({ ...(CATS[family] ?? { label: family, icon: svg('<circle cx="12" cy="12" r="8"/>') }), color: catColor(family) });
/** groups shown open by default; the rest fold into "advanced" sections */
const OPEN_GROUPS = new Set(['Geometry', 'Board', 'Setup', 'Orbit', 'Orbits', 'Pendulums', 'Table', 'Waves', 'Text']);
/** the Basic tab holds those groups; every other group (Timing, Juice, ...) lives in the Advanced tab */

await Promise.all(['DejaVuSansBold', 'DejaVuSansMonoBold', 'DejaVuSansCondensedBold', 'DejaVuSerifBold'].map(f => document.fonts.load(`55px ${f}`)));
// style themes: /themes/*.json, served (and re-read) by the server; unknown ids fall back to classic
interface ThemeInfo { id: string; name: string; icon: string; concept: string; bestFor: string; swatch: string[]; raw: unknown }
let themes: ThemeInfo[] = [];
async function loadThemes() {
  try { const r = await (await fetch('/api/themes')).json(); themes = r.themes; registerThemes(themes.filter(t => t.id !== 'classic').map(t => t.raw)); }
  catch { themes = []; }
  // system fonts named by the themes (Futura, Menlo, ...) need no download; make sure they are resolved before drawing
  await Promise.all(themes.map(t => document.fonts.load(`40px ${getTheme(t.id).font.family}`).catch(() => null)));
}
await loadThemes();
let currentStyle = store.get('studio.style') ?? 'classic';
// background settings are remembered per style; invalid or stale stored values fall back to the defaults
const bgStoreKey = (style: string) => 'studio.bg.' + style;
function loadBg(style: string): string {
  const raw = store.get(bgStoreKey(style)); if (!raw) return '';
  return serializeBackground(getTheme(style), sanitizeBackground(getTheme(style), raw).values);
}
// ---------------- style presets: background + colours + font, laid over the selected style, in any scene ----------------
interface PresetInfo { id: string; name: string; basedOn: string; value: string; swatch: string[] }
interface PresetProblem { file: string; message: string }
let stylePresets: PresetInfo[] = [], presetProblems: PresetProblem[] = [];
async function loadStylePresets() {
  try { const r = await (await fetch('/api/style-presets')).json(); stylePresets = r.presets ?? []; presetProblems = r.problems ?? []; } catch { stylePresets = []; presetProblems = []; }
}
await loadStylePresets();
/** like the style, the chosen preset is a global choice that carries over to whatever scene you pick next */
let currentPresetId = store.get('studio.preset') ?? '';
const presetValue = (id: string) => stylePresets.find(p => p.id === id)?.value ?? '';
try {
  // sound library: fetched and decoded once per session, shared by every scene's audio()
  const man: Manifest = await (await fetch('/assets/sfx/manifest.json')).json();
  setSampleBank(await Promise.all(man.samples.map(async s => parseWav(new Uint8Array(await (await fetch('/assets/sfx/' + s.file)).arrayBuffer()), s.id, s.role))));
} catch { setSampleBank([]); /* every role falls back to synthesis */ }

const player = new Player($<HTMLCanvasElement>('view'));
document.fonts.addEventListener('loadingdone', () => { if (player.frames) player.seek(player.frame); });
document.addEventListener('visibilitychange', () => player.setHidden(document.hidden));
let scene: SceneModule = SCENES[0];
let params: Params = defaults(scene.schema);
let current = { kind: 'scene', name: scene.meta.name };
let filter = store.get('studio.filter') ?? 'all';
let query = '';

// ---------------- layout: three columns, a settings drawer (<= 1100 px) or one pane + bottom bar (<= 760 px) ----------------
const narrow = matchMedia('(max-width: 760px)');
type Pane = 'pick' | 'preview' | 'settings';
let pane: Pane = (['pick', 'preview', 'settings'] as const).find(x => x === store.get('studio.pane')) ?? 'preview';
function syncNav() {
  const inVideos = document.body.classList.contains('view-videos');
  document.body.dataset.pane = pane;
  document.querySelectorAll<HTMLButtonElement>('#botnav button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pane === 'videos' ? inVideos : !inVideos && b.dataset.pane === pane)));
}
function setPane(p: Pane) { pane = p; store.set('studio.pane', p); syncNav(); }
function setDrawer(open: boolean) { document.body.classList.toggle('settings-open', open); $('setBtn').setAttribute('aria-expanded', String(open)); }
$('setBtn').onclick = () => setDrawer(!document.body.classList.contains('settings-open'));
document.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (document.body.classList.contains('settings-open') && !t.closest('#right, #setBtn')) setDrawer(false); });
hydrateIcons();

// ---------------- 1. gallery ----------------
interface Item { kind: 'scene' | 'preset'; name: string; sceneId: string; params: Params; family: string; thumb: string; ready: boolean }
let items: Item[] = [];
const cards = new Map<string, HTMLButtonElement>();
const itemKey = (i: { kind: string; name: string }) => i.kind + ':' + i.name;
const pretty = (n: string) => n.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());

async function loadGallery() {
  try { items = await (await fetch('/api/gallery')).json(); } catch { items = SCENES.map(s => ({ kind: 'scene', name: s.meta.name, sceneId: s.meta.id, params: {}, family: s.meta.family, thumb: '', ready: false })); }
  renderFilters(); renderGallery();
  // thumbnails are produced once by the server; refresh until all exist
  if (items.some(i => !i.ready)) setTimeout(loadGallery, 2500);
}
function renderFilters() {
  const box = $('filters'); box.replaceChildren();
  const fams = ['all', ...new Set(items.map(i => i.family))];
  for (const f of fams) {
    const c = f === 'all' ? { label: 'All', color: 'var(--text)', icon: '' } : cat(f);
    const b = el('button', { type: 'button', className: 'chip' + (f === filter ? ' on' : '') });
    b.setAttribute('aria-pressed', String(f === filter));
    b.style.setProperty('--cat', c.color); b.innerHTML = c.icon + c.label;
    b.onclick = () => { filter = f; store.set('studio.filter', f); renderFilters(); renderGallery(); };
    box.append(b);
  }
}
/** what the gallery currently shows: category filter + search, scenes first and their presets right after them */
let visible: Item[] = [];
function renderGallery() {
  const box = $('gallery'); box.replaceChildren(); cards.clear();
  visible = groupByScene(items, SCENES.map(s => s.meta.id)).filter(i => {
    const s = SCENES.find(x => x.meta.id === i.sceneId); if (!s) return false;
    return (filter === 'all' || i.family === filter) && matchesQuery(query, s.meta.name, i.kind === 'preset' ? pretty(i.name) : '', s.meta.description, cat(i.family).label);
  });
  for (const it of visible) {
    const c = cat(it.family), s = SCENES.find(x => x.meta.id === it.sceneId)!;
    const img = el('img', { className: 'thumb' + (it.ready ? '' : ' loading'), alt: '', loading: 'lazy', decoding: 'async' }) as HTMLImageElement;
    if (it.ready) img.src = it.thumb;
    const fam = el('span', { className: 'f' }); fam.innerHTML = it.kind === 'scene' ? c.icon + c.label : '↳ ' + s.meta.name + ' · scene preset';
    const card = el('button', { type: 'button', className: 'card', title: `${it.kind === 'scene' ? s.meta.name : 'Scene preset “' + pretty(it.name) + '”'}: ${s.meta.description}` }, img, el('div', { className: 'meta' }, el('div', { className: 't' }, it.kind === 'scene' ? s.meta.name : pretty(it.name)), fam)) as HTMLButtonElement;
    card.style.setProperty('--cat', c.color);
    card.onclick = () => pick(it);
    cards.set(itemKey(it), card); box.append(card);
  }
  $('galleryTitle').textContent = `Simulations · ${visible.length}`;
  $('noResults').hidden = visible.length > 0 || !items.length;
  markActive();
}
/** choose a gallery item. The chosen style is a global choice: it carries over to whatever scene you pick next. */
function pick(it: Item) {
  const s = SCENES.find(x => x.meta.id === it.sceneId); if (!s) return;
  const pv = presetValue(currentPresetId);
  select(s, validate(s.schema, { style: currentStyle, bgSettings: pv ? '' : loadBg(currentStyle), stylePreset: pv, ...it.params }).params, { kind: it.kind, name: it.name });
  cards.get(itemKey(it))?.scrollIntoView({ block: 'nearest' });
  if (narrow.matches) setPane('preview'); // one column: choosing a simulation shows it
}
function stepScene(dir: 1 | -1) {
  if (!visible.length) return;
  const at = visible.findIndex(i => itemKey(i) === itemKey(current));
  pick(visible[(at < 0 ? (dir > 0 ? 0 : visible.length - 1) : (at + dir + visible.length) % visible.length)]);
}
const searchBox = $<HTMLInputElement>('search');
searchBox.oninput = () => { query = searchBox.value; renderGallery(); };
searchBox.onkeydown = (e) => {
  if (e.key === 'Escape') { searchBox.value = ''; query = ''; renderGallery(); searchBox.blur(); }
  if (e.key === 'Enter' && visible.length) { pick(visible[0]); searchBox.blur(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); [...cards.values()][0]?.focus(); }
};
$('clearSearch').onclick = () => { searchBox.value = ''; query = ''; renderGallery(); searchBox.focus(); };
function markActive() { for (const [k, c] of cards) c.classList.toggle('active', k === itemKey(current)); }

function select(s: SceneModule, p: Params, from: { kind: string; name: string }) {
  scene = s; params = p; current = from;
  store.set('studio.last', JSON.stringify({ sceneId: s.meta.id, params: p, from }));
  markActive(); buildParams();
  const c = cat(s.meta.family);
  document.documentElement.style.setProperty('--cat', c.color);
  const ico = el('div', { className: 'ico' }); ico.innerHTML = c.icon;
  $('sceneInfo').replaceChildren(ico, el('div', {}, el('h3', {}, from.kind === 'preset' ? 'Scene preset · ' + pretty(from.name) : s.meta.name), el('p', { title: s.meta.description }, s.meta.description)));
  player.load(s, p);
  showDiagnostics();
  renderStyles();
  renderBg();
  renderStylePresets();
}

// ---------------- style picker ----------------
let styleTimer = 0;
async function renderStyles() {
  const box = $('styles'); clearTimeout(styleTimer);
  const forScene = scene.meta.id, { style: _s, bgSettings: _b, ...base } = params;
  let thumbs: { style: string; thumb: string; ready: boolean }[] = [];
  try { const r = await (await fetch(`/api/style-thumbs?sceneId=${forScene}&params=${encodeURIComponent(JSON.stringify(base))}`)).json(); if (Array.isArray(r)) thumbs = r; } catch { /* offline: cards without thumbnails */ }
  if (scene.meta.id !== forScene) return;
  box.replaceChildren();
  for (const t of themes) {
    const th = thumbs.find(x => x.style === t.id);
    const img = el('img', { alt: '', className: th?.ready ? '' : 'loading', decoding: 'async' }) as HTMLImageElement;
    if (th?.ready) img.src = th.thumb;
    const sw = el('div', { className: 'sw' }, ...t.swatch.map(c => { const i = el('i'); i.style.background = c; return i; }));
    const b = el('button', { type: 'button', className: 'style-card' + (params.style === t.id ? ' on' : ''), title: `${t.name}: ${t.concept}` }, img, el('div', { className: 'n' }, styleIconEl(t.id, t.icon), ` ${t.name}`), sw) as HTMLButtonElement;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(params.style === t.id));
    b.onclick = () => chooseStyle(t.id);
    box.append(b);
  }
  markStyle();
  // thumbnails are rendered once per (scene, params, style) by the server; poll until they exist
  if (thumbs.some(x => !x.ready)) styleTimer = window.setTimeout(renderStyles, 2000);
}
function chooseStyle(id: string) {
  if (!themes.some(t => t.id === id) || id === params.style) return;
  currentStyle = id; store.set('studio.style', id); params = { ...params, style: id, bgSettings: bgFor(id) }; changed('style'); markStyle(); renderBg();
}
function markStyle() {
  [...$('styles').children].forEach((b, i) => { const on = themes[i]?.id === params.style; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const t = themes.find(x => x.id === params.style);
  $('styleInfo').innerHTML = t ? `<b>${styleIcon(t.id, t.icon)} ${t.name}</b> — ${t.concept}<br><i>Best for:</i> ${t.bestFor}` : '';
  renderStyleTools(t);
}
// ---------------- style editor (new style from the selected one; edit or delete one you made) ----------------
/** while the editor is open the preview shows a draft style; this is the style to go back to */
let draftBase: string | null = null;
const isCustom = (t: ThemeInfo | undefined) => (t?.raw as { custom?: boolean } | undefined)?.custom === true;
function renderStyleTools(t: ThemeInfo | undefined) {
  const box = $('styleTools'); box.replaceChildren(); if (!t) return;
  const hooks = { preview: previewDraft, saved: afterStyleSaved, removed: afterStyleRemoved, existingIds: () => themes.map(x => x.id) };
  const add = el('button', { type: 'button', title: `Start a new style from “${t.name}”. The shipped styles stay as they are.` }, '＋ New style from this one') as HTMLButtonElement;
  add.onclick = () => openStyleEditor({ id: t.id, name: t.name, raw: t.raw }, false, hooks);
  box.append(add);
  if (isCustom(t)) { const edit = el('button', { type: 'button' }, 'Edit this style') as HTMLButtonElement; edit.onclick = () => openStyleEditor({ id: t.id, name: t.name, raw: t.raw }, true, hooks); box.append(edit); }
}
/** show a draft style in the real preview without choosing it: nothing is stored, and it cannot be rendered while open */
async function previewDraft(raw: Record<string, unknown> | null) {
  if (raw) {
    registerThemes([{ ...raw, id: '__draft' }]);
    await document.fonts.load(`40px ${getTheme('__draft').font.family}`).catch(() => null);
    if (draftBase === null) draftBase = String(params.style);
    params = { ...params, style: '__draft' };
  } else if (draftBase !== null) { params = { ...params, style: draftBase }; draftBase = null; }
  else return;
  clearTimeout(reloadTimer); reloadTimer = window.setTimeout(() => { player.load(scene, params, player.frame > 0); }, 120);
}
async function afterStyleSaved(id: string) {
  if (draftBase !== null) { params = { ...params, style: draftBase }; draftBase = null; }
  unregisterTheme('__draft'); await loadThemes();
  currentStyle = id; store.set('studio.style', id); params = { ...params, style: id, bgSettings: bgFor(id) };
  changed('style'); await renderStyles(); renderBg();
}
async function afterStyleRemoved(id: string) {
  draftBase = null; unregisterTheme('__draft'); unregisterTheme(id); await loadThemes();
  currentStyle = 'classic'; store.set('studio.style', 'classic'); params = { ...params, style: 'classic', bgSettings: bgFor('classic') };
  changed('style'); await renderStyles(); renderBg();
}

// ---------------- style presets (Basic tab, under the style cards) ----------------
/** the preset laid over the style right now, read from the scene parameter (what is rendered), or null */
const activePreset = () => sanitizeStylePreset(params.stylePreset).preset;
/** a style editor draft is on screen: nothing may be applied or saved until it is closed */
const editorOpen = () => draftBase !== null;
/** background settings to use for a style: none while a style preset provides the background */
const bgFor = (style: string) => (params.stylePreset ? '' : loadBg(style));
function choosePreset(id: string) {
  if (editorOpen()) { const m = $('presetMsg'); m.textContent = 'Close the style editor first (Save or Cancel), then pick a style preset.'; m.className = 'msg bad'; return; }
  const p = stylePresets.find(x => x.id === id);
  currentPresetId = p ? p.id : ''; store.set('studio.preset', currentPresetId);
  params = { ...params, stylePreset: p?.value ?? '', bgSettings: p ? '' : loadBg(String(params.style)) };
  changed('stylePreset'); renderStylePresets(); renderBg(); renderStyles();
}
function renderStylePresets() {
  const box = $('spChips'), act = activePreset(), say = (t: string, bad = false) => { const m = $('presetMsg'); m.textContent = t; m.className = 'msg' + (bad ? ' bad' : ''); };
  box.replaceChildren();
  const chip = (label: string, on: boolean, colors: string[], click: () => void, title: string) => {
    const dot = el('i'); dot.style.background = colors.length > 1 ? `linear-gradient(90deg, ${colors.join(',')})` : (colors[0] ?? 'transparent');
    const b = el('button', { type: 'button', className: on ? 'on' : '', title }, dot, label) as HTMLButtonElement; b.setAttribute('aria-pressed', String(on)); b.onclick = click; box.append(b); return b;
  };
  chip('None', !act, [], () => choosePreset(''), 'No style preset: the style looks as it is');
  for (const p of stylePresets) chip(p.name, act?.id === p.id, p.swatch, () => choosePreset(p.id), `Lay “${p.name}” (background, colours, font) over the style. Scene settings stay as they are.`);
  if (act && !stylePresets.some(p => p.id === act.id)) chip(`${act.name} (file removed)`, true, [], () => {}, 'This preset is still used by the picture, but its file in style-presets/ is gone');
  const known = act && stylePresets.find(p => p.id === act.id);
  if (known) {
    const del = el('button', { type: 'button', className: 'danger', title: `Delete the style preset “${known.name}” (its file in style-presets/)` }, `Delete “${known.name}”`) as HTMLButtonElement;
    del.onclick = async () => {
      if (!confirm(`Delete the style preset “${known.name}”?\n\nVideos already rendered keep their look.`)) return;
      try {
        const r = await fetch(`/api/style-presets/${known.id}`, { method: 'DELETE' }), j = await r.json();
        if (!r.ok) { say(j.error ?? 'The style preset could not be deleted.', true); return; }
        stylePresets = j.presets; presetProblems = j.problems; choosePreset(''); say(`Deleted the style preset “${known.name}”.`);
      } catch (e) { say(friendlyError(e), true); }
    };
    box.append(del);
  }
  $('spProblems').replaceChildren(...presetProblems.map(p => el('li', {}, `style-presets/${p.file}: ${p.message}`)));
  $('spProblems').hidden = presetProblems.length === 0;
}
$('savePreset').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('presetMsg'), input = $<HTMLInputElement>('presetName'), name = input.value.trim(); if (!name) return;
  const say = (t: string, bad = false) => { msg.textContent = t; msg.className = 'msg' + (bad ? ' bad' : ''); };
  if (editorOpen()) { say('Close the style editor first (Save or Cancel), then save the style preset.', true); return; }
  // what is saved: the background, colours and font you see now (style + background settings + any preset). Not the scene settings.
  const look = captureStylePreset(themeOf(params), 'new-preset', name);
  const post = async (overwrite: boolean) => { const r = await fetch('/api/style-presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, preset: look, basedOn: String(params.style), overwrite }) }); return { r, j: await r.json() }; };
  try {
    let { r, j } = await post(false);
    if (r.status === 409 && /already exists/.test(String(j.error))) {
      if (!confirm(`A style preset called “${name}” already exists. Replace it?`)) { say('Not saved. Choose another name.', true); return; }
      ({ r, j } = await post(true));
    }
    if (!r.ok) { say(j.error ? friendlyError(j.error) : 'The style preset could not be saved. Try another name.', true); return; }
    stylePresets = j.presets; presetProblems = j.problems; input.value = '';
    choosePreset(j.id); say(`Saved the style preset “${name}”: background, colours and font only. Pick it in any scene.`);
  } catch (err) { say(friendlyError(err), true); }
};

// ---------------- background settings (controls generated from the style's declared schema) ----------------
function renderBg() {
  const box = $('bgBox'), T = getTheme(String(params.style)), spec = T.background, keys = Object.keys(spec.params);
  box.replaceChildren(); box.hidden = keys.length === 0; if (!keys.length) return;
  const act = activePreset();
  if (act) { // the style preset provides the background: the style's own controls would be hidden under it
    const clear = el('button', { type: 'button', title: 'Remove the style preset; the style\'s own background controls come back' }, 'Clear style preset');
    clear.onclick = () => choosePreset('');
    box.append(el('div', { className: 'bghead' }, el('h3', {}, `🎨 Background — style preset “${act.name}”`), clear), el('p', { className: 'msg' }, 'The background comes from the style preset. Clear it to adjust this style\'s own background.'));
    return;
  }
  let cur = sanitizeBackground(T, params.bgSettings).values;
  const apply = () => {
    const raw = serializeBackground(T, cur);
    params = { ...params, bgSettings: raw }; store.set(bgStoreKey(T.id), raw); changed('bgSettings');
  };
  const sameAs = (v: Record<string, number | string>) => keys.every(k => String(v[k] ?? spec.params[k].default).toLowerCase() === String(cur[k]).toLowerCase());
  const defaultsOnly = () => Object.fromEntries(keys.map(k => [k, spec.params[k].default]));
  const reset = el('button', { type: 'button', title: 'Back to this style\'s default background' }, '↺ Reset background');
  reset.onclick = () => { cur = defaultsOnly(); apply(); renderBg(); };
  box.append(el('div', { className: 'bghead' }, el('h3', {}, `🎨 Background — ${T.name}`), reset));
  const presets = el('div', { className: 'bgpresets', role: 'group', 'aria-label': 'Background presets' });
  for (const pr of spec.presets) {
    const vals = { ...defaultsOnly(), ...pr.values }, dot = el('i');
    const c = [vals[keys.find(k => spec.params[k].type === 'color') ?? ''], ...keys.filter(k => spec.params[k].type === 'color').slice(1, 3).map(k => vals[k])];
    dot.style.background = `linear-gradient(90deg, ${c.filter(Boolean).join(',')})`;
    const b = el('button', { type: 'button', className: sameAs(vals) ? 'on' : '', title: `Apply the "${pr.name}" colour combination` }, dot, pr.name);
    b.onclick = () => { cur = sanitizeBackground(T, vals).values; apply(); renderBg(); };
    presets.append(b);
  }
  box.append(presets);
  const groups = new Map<string, HTMLElement>();
  for (const k of keys) {
    const d = spec.params[k];
    if (!groups.has(d.group)) { const det = el('details', { open: groups.size < 2 }, el('summary', {}, `${d.icon} ${d.group}`)); groups.set(d.group, det); box.append(det); }
    const shown = el('span', { className: 'v' }), label = el('label', {}, el('span', {}, `${d.icon} ${d.label}`), shown), ctl = el('div', { className: 'ctl' });
    const show = () => { const v = cur[k]; shown.textContent = d.type === 'number' ? `${+Number(v).toFixed(3)}${d.unit ? ' ' + d.unit : ''}` : d.type === 'color' ? String(v) : ''; };
    if (d.type === 'number') {
      const r = el('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(d.step), value: String(cur[k]) }) as HTMLInputElement;
      r.setAttribute('aria-label', d.label); r.oninput = () => { cur = { ...cur, [k]: +r.value }; show(); apply(); }; ctl.append(r);
    } else if (d.type === 'color') {
      const c = el('input', { type: 'color', value: String(cur[k]) }) as HTMLInputElement;
      c.setAttribute('aria-label', d.label);
      // the style limits how dark/bright a colour may be: show the value actually used
      c.oninput = () => { cur = { ...cur, [k]: sanitizeBackground(T, { ...cur, [k]: c.value }).values[k] }; if (String(cur[k]) !== c.value.toLowerCase()) c.value = String(cur[k]); show(); apply(); }; ctl.append(c);
    } else {
      const sel = el('select', {}, ...d.options!.map(o => el('option', { value: o, selected: o === cur[k] }, pretty(o)))) as HTMLSelectElement;
      sel.setAttribute('aria-label', d.label); sel.onchange = () => { cur = { ...cur, [k]: sel.value }; apply(); }; ctl.append(sel);
    }
    show(); groups.get(d.group)!.append(el('div', { className: 'param' }, label, ctl));
  }
}

// ---------------- 2. parameters ----------------
let reloadTimer = 0;
function changed(key: string) {
  const def = scene.schema[key];
  store.set('studio.last', JSON.stringify({ sceneId: scene.meta.id, params, from: current }));
  clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => { player.load(scene, params, player.frame > 0 && !def.sim); showDiagnostics(); }, 150);
}
function fmt(d: ParamDef, v: unknown) { return d.type === 'number' ? `${+Number(v).toFixed(d.step && d.step < 0.01 ? 4 : 2)}${d.unit ? ' ' + d.unit : ''}` : d.type === 'integer' ? String(v) : ''; }
function control(key: string, d: ParamDef): HTMLElement {
  const value = el('span', { className: 'v' }, fmt(d, params[key]));
  const label = el('label', {}, el('span', {}, d.label ?? pretty(key)), value);
  const wrap = el('div', { className: 'param' }, label);
  const ctl = el('div', { className: 'ctl' });
  if (d.type === 'number' || d.type === 'integer') {
    const step = d.type === 'integer' ? 1 : (d.step ?? (d.max - d.min) / 200);
    const range = el('input', { type: 'range', min: String(d.min), max: String(d.max), step: String(step), value: String(params[key]) }) as HTMLInputElement;
    range.setAttribute('aria-label', d.label ?? key);
    range.oninput = () => { params = validate(scene.schema, { ...params, [key]: range.value }).params; value.textContent = fmt(d, params[key]); changed(key); };
    ctl.append(range);
    if (key === 'seed') {
      // the seed is shown as a number you can type or copy, with a dice button for a new random one
      const box = el('input', { type: 'number', min: String(d.min), max: String(d.max), step: '1', value: String(params[key]), className: 'seedbox' }) as HTMLInputElement;
      box.setAttribute('aria-label', 'Seed number');
      const set = (v: number) => { params = validate(scene.schema, { ...params, seed: v }).params; range.value = box.value = String(params.seed); value.textContent = fmt(d, params.seed); changed('seed'); refreshHook(); };
      box.onchange = () => set(+box.value);
      range.oninput = () => set(+range.value);
      const dice = el('button', { type: 'button', className: 'dice', title: 'New random seed (a different run with the same rules)' }, '🎲 Random') as HTMLButtonElement;
      dice.onclick = () => set(d.min + Math.floor(Math.random() * (d.max - d.min + 1)));
      ctl.classList.add('seedctl'); ctl.append(box, dice);
    }
  } else if (d.type === 'enum') {
    const sel = el('select', {}, ...d.options.map(o => el('option', { value: o, selected: o === params[key] }, pretty(o))));
    sel.onchange = () => { params = { ...params, [key]: sel.value }; changed(key); refreshHook(); }; ctl.append(sel);
  } else if (d.type === 'boolean') {
    const cb = el('input', { type: 'checkbox', checked: !!params[key] });
    cb.onchange = () => { params = { ...params, [key]: cb.checked }; changed(key); }; ctl.append(cb);
  } else if (d.type === 'color') {
    const c = el('input', { type: 'color', value: String(params[key]) });
    c.oninput = () => { params = { ...params, [key]: c.value }; changed(key); }; ctl.append(c);
  } else {
    const t = el('input', { type: 'text', value: String(params[key]), placeholder: key === 'title' || key === 'answer' ? '(automatic)' : '' }) as HTMLInputElement;
    t.oninput = () => { params = { ...params, [key]: t.value }; changed(key); }; ctl.append(t);
    if (key === 'title' && scene.hook) {
      // templates suggest the on-screen question themselves (it follows the rule and the seed); "Edit" copies it into the field
      t.value = String(params[key]).replace(/\n/g, ' / '); t.dataset.hook = '1'; t.placeholder = scene.hook(params).replace(/\n/g, ' / ');
      const use = el('button', { type: 'button', className: 'link', title: 'Copy the suggested question into the field so you can change it (use / for a second line)' }, 'Edit suggestion') as HTMLButtonElement;
      use.onclick = () => { t.value = scene.hook!(params).replace(/\n/g, ' / '); params = { ...params, title: t.value.replace(/ \/ /g, '\n') }; changed('title'); t.focus(); };
      t.oninput = () => { params = { ...params, title: t.value.replace(/ \/ /g, '\n') }; changed('title'); };
      wrap.append(ctl, el('small', {}, 'Empty = the suggestion shown in grey. ', use)); return wrap;
    }
  }
  wrap.append(ctl);
  if (d.help) wrap.append(el('small', {}, d.help));
  return wrap;
}
/** the suggested hook depends on rule and seed: keep the placeholder current */
function refreshHook() { const t = document.querySelector<HTMLInputElement>('input[data-hook]'); if (t && scene.hook) t.placeholder = scene.hook(params).replace(/\n/g, ' / '); }
function buildParams() {
  const basic = $('params'), adv = $('paramsAdv'); basic.replaceChildren(); adv.replaceChildren();
  const groups = new Map<string, HTMLDetailsElement>();
  for (const [k, d] of Object.entries(scene.schema)) {
    if (k === 'style' || k === 'bgSettings' || k === 'stylePreset') continue; // chosen with the style picker / background panel
    const g = d.group ?? 'General';
    if (!groups.has(g)) groups.set(g, el('details', { className: 'group' }, el('summary', {}, g === 'Juice' ? 'Effects (juice)' : g === 'Style' ? 'Colours & trails' : g)) as HTMLDetailsElement);
    groups.get(g)!.append(control(k, d));
  }
  // Basic: the scene's main groups, the first open and the rest one click away (so the Style cards stay on screen); "Text" always comes last
  const main = [...groups.keys()].filter(g => OPEN_GROUPS.has(g)).sort((a, b) => +(a === 'Text') - +(b === 'Text'));
  main.forEach((g, i) => { groups.get(g)!.open = i === 0; basic.append(groups.get(g)!); });
  for (const [g, det] of groups) if (!OPEN_GROUPS.has(g)) adv.append(det);
}
$('reset').onclick = () => { $('presetMsg').textContent = ''; select(scene, { ...defaults(scene.schema), style: params.style, bgSettings: params.bgSettings, stylePreset: params.stylePreset }, { kind: 'scene', name: scene.meta.name }); };
function showDiagnostics() {
  const d = player.diagnostics();
  $('diag').textContent = d ? JSON.stringify(d, (_, v) => (typeof v === 'number' ? +v.toPrecision(6) : v), 2) : '—';
}

// ---------------- transport ----------------
const timeline = $<HTMLInputElement>('timeline');
let debug = store.get('studio.debug') === '1';
const showDebug = () => { $('stats').hidden = !debug; };
player.onStatus = (s) => {
  const fps = scene.meta.fps;
  $('play').innerHTML = icon(s.playing ? 'pause' : 'play', 18);
  $('play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
  $('time').textContent = `${(s.frame / fps).toFixed(2)} / ${((s.frames - 1) / fps).toFixed(2)} s`;
  timeline.max = String(Math.max(1, s.frames - 1));
  if (document.activeElement !== timeline) timeline.value = String(s.frame);
  $('buffered').style.width = `${(100 * s.buffered) / Math.max(1, s.frames - 1)}%`;
  if (debug) $('stats').textContent = `frame ${s.frame} · draw ${s.drawMs.toFixed(1)} ms · skipped ${s.dropped} · preview ${s.tier} · audio ${s.audio}`;
};
$('play').onclick = () => (player.playing ? player.pause() : player.play());
timeline.oninput = () => { player.pause(); player.seek(+timeline.value); };
const soundBox = $<HTMLInputElement>('sound');
soundBox.onchange = () => player.setSound(soundBox.checked);
const q = $<HTMLSelectElement>('quality'); q.value = store.get('studio.quality') ?? 'auto'; player.quality = q.value as Quality;
q.onchange = () => { store.set('studio.quality', q.value); player.setQuality(q.value as Quality); };

initModeSwitch(); // light / dark / auto for the interface only; the video preview keeps the video's style

// ---------------- videos view (texts, status, links; coverage of scene × style) ----------------
const vids = initVideos({
  scenes: SCENES, styleIds: () => themes.map(t => t.id), onVisibility: () => syncNav(),
  openScene: (sceneId, style) => {
    const s = SCENES.find(x => x.meta.id === sceneId); if (!s) return;
    currentStyle = style; store.set('studio.style', style); currentPresetId = ''; store.set('studio.preset', ''); // a coverage cell is a plain style
    select(s, validate(s.schema, { style, bgSettings: loadBg(style) }).params, { kind: 'scene', name: s.meta.name });
    cards.get(itemKey({ kind: 'scene', name: s.meta.name }))?.scrollIntoView({ block: 'nearest' });
  },
});

// ---------------- settings tabs + shortcut help ----------------
function setTab(t: 'basic' | 'adv') {
  store.set('studio.tab', t);
  for (const [id, pane, on] of [['tabBasic', 'paneBasic', t === 'basic'], ['tabAdv', 'paneAdv', t === 'adv']] as const) {
    $(id).setAttribute('aria-selected', String(on)); $(pane).hidden = !on;
  }
}
$('tabBasic').onclick = () => setTab('basic'); $('tabAdv').onclick = () => setTab('adv');
setTab(store.get('studio.tab') === 'adv' ? 'adv' : 'basic');
document.querySelectorAll<HTMLButtonElement>('#botnav button').forEach(b => b.onclick = async () => {
  const p = b.dataset.pane!;
  if (p === 'videos') { if (!vids.shown()) vids.show(); return; }
  if (vids.shown()) await vids.hide();
  setPane(p as Pane);
});
syncNav();
// the server can be older than the files on disk (started before an edit): say so quietly, once, with what to do
async function checkStale() {
  try {
    const st = await (await fetch('/api/status')).json(), box = $('staleNote');
    const msg = st.codeStale ? 'The server started before some files changed. Restart it to get the latest fixes (Terminal: pkill -f apps/server/server.ts, then open Sim Studio again). Renders keep working meanwhile.'
      : Array.isArray(st.problems) && st.problems.length ? `Heads up: ${st.problems.join(' ')}` : '';
    box.hidden = !msg;
    if (msg) (box.firstElementChild as HTMLElement).textContent = msg;
  } catch { /* server unreachable: the rest of the page already says so */ }
}
void checkStale(); addEventListener('focus', () => void checkStale());
const help = $<HTMLDialogElement>('help');
$('helpList').replaceChildren(...SHORTCUTS.flatMap(r => [el('dt', {}, ...r.keys.map(k => el('kbd', {}, k))), el('dd', {}, r.label)]));
$('helpBtn').onclick = () => help.showModal();
help.addEventListener('click', (e) => { if (e.target === help) help.close(); });
showDebug();

// the menu bar app opens http://127.0.0.1:5180/#videos to land on the video list
vids.applyHash(); // an address like #videos/long opens that view; later changes of the address are followed by the Videos page itself

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (help.open) return;
  if (t.closest('input, textarea, select')) return;
  const act = shortcutFor(e, themes.length || 6);
  if (!act) return;
  if (act === 'back') { if (document.body.classList.contains('settings-open')) { e.preventDefault(); setDrawer(false); } else if (vids.shown()) { e.preventDefault(); void vids.hide(); } return; }
  if (vids.shown() && act !== 'videos' && act !== 'help' && act !== 'search') return; // the studio's keys do nothing while the video list is open
  // Space/Enter on a focused button or link belongs to that control
  if (act === 'play' && t.closest('button, a, summary')) return;
  e.preventDefault();
  if (act === 'play') player.playing ? player.pause() : player.play();
  else if (act === 'render') $('render').click();
  else if (act === 'videos') (vids.shown() ? vids.hide() : vids.show());
  else if (act === 'search') { if (vids.shown()) vids.focusSearch(); else { searchBox.focus(); searchBox.select(); } }
  else if (act === 'prevScene') stepScene(-1);
  else if (act === 'nextScene') stepScene(1);
  else if (act === 'mute') { soundBox.checked = !soundBox.checked; soundBox.onchange!(new Event('change')); }
  else if (act === 'help') help.showModal();
  else if (act === 'debug') { debug = !debug; store.set('studio.debug', debug ? '1' : '0'); showDebug(); }
  else if (act === 'stepFwd') player.seek(player.frame + 1);
  else if (act === 'stepBack') player.seek(player.frame - 1);
  else if (act === 'jumpFwd') player.seek(player.frame + 60);
  else if (act === 'jumpBack') player.seek(player.frame - 60);
  else if (act.startsWith('style:')) { const th = themes[+act.slice(6)]; if (th) chooseStyle(th.id); }
});

// ---------------- 3. render: status strip under the preview + history of the last renders ----------------
interface JobView { retriedBy?: string; note?: string; id: string; sceneId: string; params: Record<string, unknown>; status: string; progress: { frame: number; frames: number; fps: number; phase: string }; out: string; file?: string; abs?: string; size?: number; created: number; finished?: number; report?: any; error?: string }
interface JobNode { root: HTMLElement; st: HTMLElement; bar: HTMLElement; meta: HTMLElement; acts: HTMLElement; status: string; video?: HTMLVideoElement }
const jobNodes = new Map<string, JobNode>(), jobData = new Map<string, JobView>();
let latestId = '';
const strip = $('rstrip'), rsState = strip.querySelector('.rs-state') as HTMLElement, rsBar = strip.querySelector('.bar > div') as HTMLElement,
  rsMeta = strip.querySelector('.rs-meta') as HTMLElement, rsNote = strip.querySelector('.rs-note') as HTMLElement, rsRow = strip.querySelector('.rs-row') as HTMLElement,
  rsOpen = strip.querySelector('.rs-open') as HTMLAnchorElement, rsReveal = strip.querySelector('.rs-reveal') as HTMLButtonElement,
  rsPublish = strip.querySelector('.rs-publish') as HTMLButtonElement, rsAgain = strip.querySelector('.rs-again') as HTMLButtonElement, rsHist = strip.querySelector('.rs-hist') as HTMLButtonElement;
const PHASE: Record<string, string> = { queued: 'Queued', audio: 'Preparing sound', video: 'Rendering', mux: 'Finishing', done: 'Rendering', normalize: 'Preparing clips', concat: 'Joining clips', verify: 'Checking' };
const jobLabel = (j: JobView) => j.sceneId === 'compile' ? `Long video · ${String(j.params?.title ?? '')}` : `${SCENES.find(s => s.meta.id === j.sceneId)?.meta.name ?? j.sceneId} · ${getTheme(String(j.params?.style ?? 'classic')).name}`;
const pctOf = (j: JobView) => (j.status === 'done' ? 100 : j.progress.frames ? Math.min(100, (100 * j.progress.frame) / j.progress.frames) : 0);
let noteTimer = 0;
/** one line under the progress bar. Messages about a failed job stay; everything else fades after 10 s. */
function note(text: string, kind: 'bad' | 'info' = 'bad', keep = false) {
  clearTimeout(noteTimer);
  if (keep && text) rsNote.dataset.jobError = '1'; else delete rsNote.dataset.jobError;
  rsNote.textContent = text; rsNote.hidden = !text; rsNote.className = 'rs-note' + (kind === 'info' ? ' info' : '');
  if (text) { strip.hidden = false; if (!keep) noteTimer = window.setTimeout(() => note(''), 10000); }
}
function stateText(j: JobView) { return j.status === 'running' || j.status === 'queued' ? `${PHASE[j.progress.phase] ?? 'Rendering'}${j.status === 'running' ? ' ' + pctOf(j).toFixed(0) + '%' : ''}` : j.status === 'done' ? '✓ Done' : j.status === 'stopped' ? '⏸ Stopped' : '✕ Failed'; }
function metaText(j: JobView) {
  const ahead = [...jobData.values()].filter(x => x.status === 'queued' && x.created < j.created).length;
  if (j.status === 'running') return `${jobLabel(j)}${j.progress.fps ? ` · ${j.progress.fps.toFixed(0)} fps · ~${fmtSecs((j.progress.frames - j.progress.frame) / j.progress.fps)} left` : ''}`;
  if (j.status === 'queued') return `${jobLabel(j)}${ahead ? ` · ${ahead} ahead` : ''}`;
  if (j.status === 'done') return [jobLabel(j), fmtSize(j.size), j.report ? `${j.report.totalSec} s` : ''].filter(Boolean).join(' · ');
  if (j.status === 'stopped') return `${jobLabel(j)} · stopped when the studio stopped`;
  return jobLabel(j);
}
/** run a stopped or failed render again from its saved settings (renders are deterministic: the same settings give the same video) */
async function renderAgain(j: JobView, btn: HTMLButtonElement) {
  btn.disabled = true;
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(j.id)}/again`, { method: 'POST' }); const b = await r.json();
    if (!r.ok || b.error) { note(friendlyError(b.error ?? `HTTP ${r.status}`)); btn.disabled = false; return; }
    upsertJob(b);
  } catch (e) { note(friendlyError(e)); btn.disabled = false; }
}
async function reveal(j: JobView) {
  try {
    const r = await fetch('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: j.out.split('/').pop() }) });
    const b = await r.json(); if (!r.ok) note(b.error ?? 'Could not open the folder.');
  } catch (e) { note(friendlyError(e)); }
}
async function copyPath(j: JobView) {
  const p = j.abs ?? j.file ?? j.out;
  try { await navigator.clipboard.writeText(p); note(`Path copied: ${p}`, 'info'); } catch { note(`Path: ${p}`, 'info'); }
}
function updateStrip(j: JobView) {
  const done = j.status === 'done';
  strip.hidden = false; rsRow.hidden = false;
  rsState.className = 'rs-state ' + j.status; rsState.textContent = stateText(j);
  rsBar.style.width = `${pctOf(j)}%`; rsMeta.textContent = metaText(j); rsMeta.title = j.file ?? '';
  rsOpen.hidden = rsReveal.hidden = rsPublish.hidden = !done;
  if (done) { rsPublish.onclick = () => vids.showJob(j.id); rsOpen.href = j.out; rsReveal.onclick = () => reveal(j); }
  const again = (j.status === 'stopped' || j.status === 'error') && !j.retriedBy;
  rsAgain.hidden = !again; rsAgain.disabled = false; if (again) rsAgain.onclick = () => renderAgain(j, rsAgain);
  if (j.status === 'error') note(friendlyError(j.error), 'bad', true);
  else if (j.status === 'stopped') note(j.note ?? 'The studio stopped while this was in the queue.', 'info', true);
  else if (rsNote.dataset.jobError) note('');
  rsHist.textContent = `All renders (${jobNodes.size})`;
  const pt = progressTitle(j.status, pctOf(j)); if (pt) document.title = pt; else if (!document.hidden) document.title = 'Sim Studio';
}
function upsertJob(j: JobView) {
  jobData.set(j.id, j);
  let n = jobNodes.get(j.id), fresh = false;
  if (!n) {
    fresh = true;
    const st = el('span', { className: 'st' }), bar = el('div'), meta = el('div', { className: 'meta' }), acts = el('div', { className: 'acts' });
    const root = el('div', { className: 'job' }, el('div', { className: 'head' }, el('span', { className: 'name' }, jobLabel(j)), st), el('div', { className: 'bar' }, bar), meta, acts);
    n = { root, st, bar, meta, acts, status: '' }; jobNodes.set(j.id, n);
    $('jobs').prepend(root);
  }
  const prev = n.status; n.status = j.status;
  n.st.className = 'st ' + j.status; n.st.textContent = stateText(j);
  n.bar.style.width = `${pctOf(j)}%`;
  n.meta.textContent = `${new Date(j.created).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${j.status === 'error' ? friendlyError(j.error) : metaText(j)}`;
  if (j.status === 'done' && !n.acts.childElementCount) {
    const playLabel = () => `${icon('play', 12)} Play here`; const play = el('button', { type: 'button' }), show = el('button', { type: 'button' }, 'Show in folder'), cp = el('button', { type: 'button' }, 'Copy path'); play.innerHTML = playLabel();
    play.onclick = () => { if (n!.video) { n!.video.remove(); n!.video = undefined; play.innerHTML = playLabel(); return; } n!.video = el('video', { src: j.out, controls: true, preload: 'metadata' }) as HTMLVideoElement; n!.root.append(n!.video); play.textContent = 'Hide video'; };
    show.onclick = () => reveal(j); cp.onclick = () => copyPath(j);
    n.acts.append(play, show, cp, el('a', { href: j.out, target: '_blank', className: 'link' }, 'Open'));
  }
  if ((j.status === 'stopped' || j.status === 'error') && !j.retriedBy) {
    const again = el('button', { type: 'button', className: 'primary' }, 'Render again') as HTMLButtonElement; again.onclick = () => renderAgain(j, again); n.acts.replaceChildren(again);
  } else if (j.status === 'stopped' || j.status === 'error') n.acts.replaceChildren(el('span', { className: 'meta' }, 'Started again'));
  if (fresh || prev !== j.status) vids.refresh(); // the video list follows renders: new entry, finished, failed
  const newest = !latestId || j.created >= (jobData.get(latestId)?.created ?? 0);
  if (newest) latestId = j.id;
  if (j.id === latestId) updateStrip(j); else rsHist.textContent = `All renders (${jobNodes.size})`;
  // a render the user is waiting for just finished: make it impossible to miss
  if (!fresh && prev && prev !== j.status && (j.status === 'done' || j.status === 'error') && j.id === latestId) {
    strip.classList.remove('flash'); void strip.offsetWidth; strip.classList.add('flash');
    if (document.hidden) document.title = (j.status === 'done' ? '✓ Render done' : '✕ Render failed') + ' · Sim Studio';
  }
}
const restoreTitle = () => { document.title = 'Sim Studio'; };
addEventListener('focus', restoreTitle); document.addEventListener('visibilitychange', () => { if (!document.hidden) restoreTitle(); });
rsHist.onclick = () => { const pop = $('rhist'); pop.hidden = !pop.hidden; rsHist.setAttribute('aria-expanded', String(!pop.hidden)); };
document.addEventListener('click', (e) => { const pop = $('rhist'); if (!pop.hidden && !(e.target as HTMLElement).closest('#rstrip')) { pop.hidden = true; rsHist.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('rhist').hidden) { $('rhist').hidden = true; rsHist.setAttribute('aria-expanded', 'false'); } });

$('render').onclick = async () => {
  const btn = $<HTMLButtonElement>('render'); if (btn.disabled) return;
  if (draftBase !== null) { note('The style editor is open. Save or cancel the style first, then render.'); return; }
  btn.disabled = true;
  const label = btn.firstChild!; const old = label.textContent; label.textContent = 'Queuing… ';
  try {
    const r = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId: scene.meta.id, params }) });
    const j = await r.json();
    if (!r.ok || j.error) { note(friendlyError(j.error ?? `HTTP ${r.status}`)); return; }
    note(friendlyWarnings(j.warnings), 'info');
    upsertJob(j);
  } catch (e) { note(friendlyError(e)); }
  finally { btn.disabled = false; label.textContent = old; }
};
try { for (const j of await (await fetch('/api/jobs')).json()) upsertJob(j); } catch { /* server not reachable: strip stays hidden */ }
new EventSource('/api/jobs/events').onmessage = (m) => upsertJob(JSON.parse(m.data));

// ---------------- boot ----------------
await loadGallery();
const last = (() => { try { return JSON.parse(store.get('studio.last') ?? 'null'); } catch { return null; } })();
const lastScene = last && SCENES.find(s => s.meta.id === last.sceneId);
if (lastScene) select(lastScene, validate(lastScene.schema, last.params).params, last.from ?? { kind: 'scene', name: lastScene.meta.name });
else select(scene, params, current);
(window as any).__studio = { player, get params() { return params; }, get scene() { return scene; }, SCENES, validate, benchScene };
