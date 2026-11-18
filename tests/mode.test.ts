// Light / dark / auto interface mode: the choice logic, the no-flash boot script (the real one from index.html),
// WCAG AA contrast of every text/background pair in BOTH modes, no stray hard-coded UI colours, and the separation from the video.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { MODES, MODE_KEY, parsePref, resolveMode, stepPref, CAT_COLORS, CAT_FALLBACK, catColor, modeColor } from '../apps/studio/mode.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------------- choice logic ----------------
test('three modes, Auto by default; anything unknown means Auto; Auto follows the system and stays dark when it cannot tell', () => {
  assert.deepEqual(MODES.map(m => m.id), ['auto', 'light', 'dark']);
  for (const m of MODES) assert.ok(m.hint.length > 8 && m.label.length >= 4, 'tooltip text');
  assert.equal(parsePref(null), 'auto'); assert.equal(parsePref('purple'), 'auto'); assert.equal(parsePref(undefined), 'auto');
  assert.equal(parsePref('light'), 'light'); assert.equal(parsePref('dark'), 'dark'); assert.equal(parsePref('auto'), 'auto');
  assert.equal(resolveMode('auto', true), 'dark'); assert.equal(resolveMode('auto', false), 'light'); assert.equal(resolveMode('auto', null), 'dark');
  assert.equal(resolveMode('light', true), 'light'); assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(MODE_KEY, 'studio.theme');
});
test('keyboard: arrows, Home and End move through the three choices and wrap; other keys are ignored', () => {
  assert.equal(stepPref('auto', 'ArrowRight'), 'light'); assert.equal(stepPref('light', 'ArrowRight'), 'dark'); assert.equal(stepPref('dark', 'ArrowRight'), 'auto');
  assert.equal(stepPref('auto', 'ArrowLeft'), 'dark'); assert.equal(stepPref('dark', 'ArrowUp'), 'light'); assert.equal(stepPref('light', 'ArrowDown'), 'dark');
  assert.equal(stepPref('dark', 'Home'), 'auto'); assert.equal(stepPref('auto', 'End'), 'dark');
  assert.equal(stepPref('auto', 'Tab'), null); assert.equal(stepPref('auto', 'a'), null);
});

// ---------------- no flash: the boot script runs before the stylesheet ----------------
const html = read('apps/studio/index.html');
const boot = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)![1];
function runBoot(o: { stored?: string | null; systemLight?: boolean; storageThrows?: boolean; mediaThrows?: boolean }) {
  const root = { dataset: {} as Record<string, string> };
  const ctx = {
    document: { documentElement: root },
    localStorage: { getItem: (k: string) => { if (o.storageThrows) throw new Error('blocked'); assert.equal(k, 'studio.theme'); return o.stored ?? null; } },
    matchMedia: (q: string) => { if (o.mediaThrows) throw new Error('no media'); assert.equal(q, '(prefers-color-scheme: light)'); return { matches: !!o.systemLight }; },
  };
  vm.runInNewContext(boot, ctx);
  return root.dataset;
}
test('boot script (index.html): sets the mode synchronously from the stored choice and the system, never throws', () => {
  assert.deepEqual(runBoot({}), { themePref: 'auto', theme: 'dark' }, 'default: Auto, and a dark system gives dark');
  assert.deepEqual(runBoot({ systemLight: true }), { themePref: 'auto', theme: 'light' });
  assert.deepEqual(runBoot({ stored: 'light' }), { themePref: 'light', theme: 'light' }, 'explicit light beats a dark system');
  assert.deepEqual(runBoot({ stored: 'dark', systemLight: true }), { themePref: 'dark', theme: 'dark' });
  assert.deepEqual(runBoot({ stored: 'nonsense', systemLight: true }), { themePref: 'auto', theme: 'light' });
  assert.deepEqual(runBoot({ storageThrows: true, systemLight: true }), { themePref: 'auto', theme: 'light' }, 'storage blocked: still follows the system');
  assert.deepEqual(runBoot({ mediaThrows: true }), { themePref: 'auto', theme: 'dark' }, 'no media query: the original dark look');
  // it agrees with the tested helper for every combination
  for (const stored of [null, 'auto', 'light', 'dark', 'x']) for (const systemLight of [false, true]) {
    const d = runBoot({ stored, systemLight });
    assert.equal(d.theme, resolveMode(parsePref(stored), !systemLight), `${stored}/${systemLight}`);
  }
  assert.ok(html.indexOf('id="theme-boot"') < html.indexOf('rel="stylesheet"'), 'runs before the stylesheet, so the first paint is already right');
  assert.ok(html.indexOf('id="theme-boot"') < html.indexOf('<body>'), 'in the head');
  assert.ok(!/type="module"/.test(/<script id="theme-boot"[^>]*>/.exec(html)![0]), 'a classic script runs at once');
});

// ---------------- contrast ----------------
const css = read('apps/studio/style.css');
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {'), body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const TOK = { dark: tokens(':root'), light: { ...tokens(':root'), ...tokens('html[data-theme="light"]') } };
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (h: string): [number, number, number] => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lumOf = (c: [number, number, number]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: string, b: string) => { const x = lumOf(rgb(a)), y = lumOf(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a: string, b: string, t: number) => '#' + rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');

/** [foreground token or hex, background token or hex, what it is] */
const PAIRS: [string, string, string][] = [];
for (const fg of ['text', 'muted', 'label']) for (const bg of ['bg', 'panel', 'panel2', 'field']) PAIRS.push([fg, bg, `${fg} text on ${bg}`]);
for (const fg of ['cyan', 'bad', 'ok', 'warn']) for (const bg of ['bg', 'panel', 'panel2']) PAIRS.push([fg, bg, `${fg} (links, status) on ${bg}`]);
PAIRS.push(['primary-ink', 'primary', 'primary button'], ['primary-ink', 'primary-hover', 'primary button, hover'], ['play-ink', 'play-bg', 'play button']);
PAIRS.push(['#111111', 'accent', 'badge number on gold'], ['text', 'seg-on', 'selected view tab'], ['muted', 'seg-on', 'hovered mode button']);
for (const bg of ['bad', 'warn', 'st-draft', 'st-rendered', 'st-scheduled', 'st-published']) PAIRS.push(['on-solid', bg, `text on solid ${bg} (status buttons, quality labels)`]);
PAIRS.push(['warn-ink', 'warn-bg', 'notice'], ['info-ink', 'info-bg', 'info notice'], ['ro-ink', 'ro-bg', 'read-only notice']);
PAIRS.push(['ok', 'cell-pub-bg', 'coverage cell published'], ['st-scheduled', 'cell-sch-bg', 'cell scheduled'], ['cyan', 'cell-ren-bg', 'cell rendered'], ['muted', 'cell-bg', 'cell empty'], ['text', 'cell-bg', 'cell draft'], ['cyan', 'cell-bg', 'cell hover']);
PAIRS.push(['text', 'panel2', 'card title'], ['muted', 'warn-bg', 'muted in notices']);
for (const fg of ['st-draft', 'st-rendered', 'st-scheduled', 'st-published']) for (const bg of ['panel', 'panel2']) PAIRS.push([fg, bg, `${fg} status badge on ${bg} (Videos rows)`]);
PAIRS.push(['bad', 'panel2', 'upload failed badge'], ['cyan', 'panel2', 'uploading badge']);

test('WCAG AA: every text/background pair is at least 4.5:1 in dark AND light (numbers printed)', () => {
  const rows: string[] = []; let min = { dark: 99, light: 99 };
  for (const mode of ['dark', 'light'] as const) for (const [fg, bg, what] of PAIRS) {
    const t = TOK[mode], f = fg.startsWith('#') ? fg : t[fg], b = bg.startsWith('#') ? bg : t[bg];
    assert.ok(/^#[0-9a-f]{6}$/i.test(f) && /^#[0-9a-f]{6}$/i.test(b), `${mode}: token missing for ${what} (${fg} on ${bg})`);
    const r = ratio(f, b); min[mode] = Math.min(min[mode], r);
    rows.push(`${mode.padEnd(5)} ${r.toFixed(2).padStart(5)}  ${what}`);
    assert.ok(r >= 4.5, `${mode}: ${what} is ${r.toFixed(2)}:1 (${f} on ${b}), below 4.5`);
  }
  console.log(rows.join('\n') + `\nlowest: dark ${min.dark.toFixed(2)}:1, light ${min.light.toFixed(2)}:1`);
});
test('WCAG AA: category accents work as text on their panels and under the selected chip, in both modes', () => {
  for (const mode of ['dark', 'light'] as const) {
    const t = TOK[mode];
    for (const [fam, c] of [...Object.entries(CAT_COLORS), ['fallback', CAT_FALLBACK] as const]) {
      const col = c[mode];
      for (const bg of ['bg', 'panel', 'panel2']) assert.ok(ratio(col, t[bg]) >= 4.5, `${mode} ${fam} on ${bg}: ${ratio(col, t[bg]).toFixed(2)}`);
      assert.ok(ratio(col, mix(col, t.panel, 0.18)) >= 4.5, `${mode} ${fam} on its own 18% tint`);
      assert.ok(ratio(t['on-solid'], col) >= 4.5, `${mode} ${fam}: chip text on the accent is ${ratio(t['on-solid'], col).toFixed(2)}`);
    }
  }
  assert.equal(catColor('orbits'), modeColor(CAT_COLORS.orbits)); assert.match(catColor('orbits'), /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  assert.equal(catColor('unknown family'), modeColor(CAT_FALLBACK));
  assert.ok(Object.keys(CAT_COLORS).length === 8);
});
test('both modes define exactly the same tokens (nothing is left with the other mode\'s colour)', () => {
  const d = Object.keys(tokens(':root')).filter(k => k !== 'cat').sort(), l = Object.keys(tokens('html[data-theme="light"]')).sort();
  assert.deepEqual(l, d.filter(k => k in tokens('html[data-theme="light"]')));
  const missing = d.filter(k => !l.includes(k));
  assert.deepEqual(missing, [], `tokens only defined for dark: ${missing}`);
  assert.match(css, /html\[data-theme="light"\] \{\s*color-scheme: light;/); assert.match(css, /:root \{\s*color-scheme: dark;/);
});

// ---------------- nothing left with an old colour ----------------
test('no hard-coded UI colours outside the token blocks (only the video itself and two documented exceptions)', () => {
  const noTokens = css.replace(/:root \{[\s\S]*?\n\}/, '').replace(/html\[data-theme="light"\] \{[\s\S]*?\n\}/, '');
  const left = [...noTokens.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]).sort();
  // #000: the preview canvas and video elements (the video's own look); #111: text on the gold badge; #00000033: key hint inside the primary button
  assert.deepEqual([...new Set(left)], ['#000', '#00000033', '#111']);
  assert.ok(!/\b(rgb|rgba|hsl|hsla)\(/.test(noTokens), 'no rgb()/hsl() literals');
  for (const f of ['main.ts', 'videos.ts', 'youtube-ui.ts', 'ux.ts', 'mode-ui.ts', 'player.ts']) assert.deepEqual(read('apps/studio/' + f).match(/#[0-9a-fA-F]{6}\b/g) ?? [], [], `${f} has no colour literals`);
  assert.match(css, /#view \{[^}]*background: #000/, 'the preview stays the video\'s own black');
});

// ---------------- the video and the styles are not touched ----------------
test('separation: the mode never reaches the renderer, the scenes, the style themes or the render worker', () => {
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = ['packages', 'themes', 'apps/server/worker.ts', 'apps/server/render-job.ts', 'apps/server/cli-render.ts'].flatMap(p => (fs.statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : [p])).filter(f => /\.(ts|json)$/.test(f));
  assert.ok(files.length > 30, `only ${files.length} files scanned`);
  for (const f of files) assert.ok(!/studio\.theme|data-theme|prefers-color-scheme|apps\/studio\/mode/.test(read(f)), `${f} must not know about the interface mode`);
  assert.match(read('apps/studio/mode.ts'), /never touches\s+(\/\/\s*)?the video/);
  assert.match(css, /INTERFACE ONLY/);
});
