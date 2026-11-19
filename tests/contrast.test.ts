// Contrast guard for the studio interface (WCAG AA): the colour tokens in apps/studio/style.css are measured in both modes, so a token
// change that makes text unreadable fails here. It also checks that a rule which paints a "pressed / on" background paints its text colour in
// the same rule (the bug this guards: two .seg blocks, one setting the background, the other the text, ended up as pale on pale).
// The whole running page is measured with tools/contrast-audit.js (see docs/ui-modes.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.resolve(import.meta.dirname, '../apps/studio/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const tokens = (selector: RegExp) => { const t: Record<string, string> = {}; for (const r of rules.filter(r => selector.test(r.sel))) for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) t[m[1]] = m[2].trim(); return t; };
const DARK = tokens(/^:root$/), LIGHT = { ...DARK, ...tokens(/^html\[data-theme="light"\]$/) };

const rgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map(c => c + c).join('') : h.slice(0, 6); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)) as [number, number, number]; };
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const resolve = (t: Record<string, string>, name: string): string => { let v = t[name]; for (let i = 0; v && /^var\(/.test(v) && i < 5; i++) v = t[v.match(/var\((--[\w-]+)/)![1]]; return v; };

/** [text token, background token, minimum ratio, what it is] */
const PAIRS: [string, string, number, string][] = [
  ['--text', '--bg', 4.5, 'body text'], ['--text', '--panel', 4.5, 'panel text'], ['--text', '--panel2', 4.5, 'card text'], ['--text', '--field', 4.5, 'field text'], ['--text', '--seg-on', 4.5, 'pressed switch'],
  ['--label', '--panel', 4.5, 'label'], ['--label', '--panel2', 4.5, 'label on a card'],
  ['--muted', '--bg', 4.5, 'muted text'], ['--muted', '--panel', 4.5, 'muted text on a panel'], ['--muted', '--panel2', 4.5, 'muted text on a card'], ['--muted', '--field', 4.5, 'placeholder and muted text on a field'],
  ['--cyan', '--panel', 4.5, 'link text'], ['--cyan', '--bg', 4.5, 'link text on the page'], ['--bad', '--panel', 4.5, 'error text'], ['--ok', '--panel', 4.5, 'ok text'], ['--warn', '--panel', 4.5, 'warning text'],
  ['--primary-ink', '--primary', 4.5, 'primary button'], ['--primary-ink', '--primary-hover', 4.5, 'primary button (hover)'], ['--play-ink', '--play-bg', 4.5, 'play button'],
  ['--on-solid', '--cyan', 4.5, 'active filter chip'], ['--on-solid', '--st-draft', 4.5, 'active Draft button/chip'], ['--on-solid', '--st-rendered', 4.5, 'active Rendered button/chip'],
  ['--on-solid', '--st-scheduled', 4.5, 'active Scheduled button/chip'], ['--on-solid', '--st-published', 4.5, 'active Published button/chip'],
  ['--st-draft', '--panel2', 4.5, 'Draft badge text'], ['--st-rendered', '--panel2', 4.5, 'Rendered badge text'], ['--st-scheduled', '--panel2', 4.5, 'Scheduled badge text'], ['--st-published', '--panel2', 4.5, 'Published badge text'],
  ['--warn-ink', '--warn-bg', 4.5, 'warning banner'], ['--info-ink', '--info-bg', 4.5, 'info banner'], ['--ro-ink', '--ro-bg', 4.5, 'read-only banner'],
  // component borders and meaningful marks need 3:1 (WCAG 1.4.11)
  ['--field-line', '--panel', 3, 'field border on a panel'], ['--field-line', '--bg', 3, 'field border on the page'], ['--field-line', '--panel2', 3, 'field border on a card'],
  ['--field-line', '--field', 3, 'field border against its own fill'],
];

for (const [mode, t] of [['dark', DARK], ['light', LIGHT]] as const) {
  test(`${mode} mode: every key token pair meets WCAG AA`, () => {
    const bad: string[] = [];
    for (const [fg, bg, need, what] of PAIRS) {
      const a = resolve(t, fg), b = resolve(t, bg);
      if (!a || !b || !/^#/.test(a) || !/^#/.test(b)) { bad.push(`${what}: ${fg} or ${bg} is not a hex token (${a}, ${b})`); continue; }
      const r = ratio(a, b); if (r < need) bad.push(`${what}: ${fg} ${a} on ${bg} ${b} is ${r.toFixed(2)}:1, needs ${need}:1`);
    }
    assert.deepEqual(bad, []);
  });
}

test('a rule that paints a pressed / on background also paints its text colour', () => {
  const lone: string[] = [];
  for (const r of rules) {
    if (!/\[aria-(pressed|checked|selected|current)=("?)true\2\]|\[aria-selected="?true"?\]|\.on\b(?!ly)/.test(r.sel) || r.sel.startsWith('@')) continue;
    const paintsBg = /(^|;|\s)background(-color)?\s*:\s*(?!none|transparent|0\b)/.test(r.body.replace(/box-shadow[^;]*;?/g, ''));
    const paintsInk = /(^|;|\s)color\s*:/.test(r.body);
    if (paintsBg && !paintsInk) lone.push(r.sel);
  }
  assert.deepEqual(lone, [], 'these rules set a background without a text colour, so the text keeps the colour of another rule');
});

test('the status switch gets its text colour from the same rule as its background, in one .seg block', () => {
  const segBlocks = rules.filter(r => /^\.seg\b[^,]*$/.test(r.sel) && !/\.s-|button/.test(r.sel));
  assert.equal(segBlocks.length, 1, 'only one plain .seg rule (two of them fought over the colours)');
  for (const s of ['draft', 'rendered', 'scheduled', 'published']) {
    const r = rules.find(x => x.sel.includes(`.seg .s-${s}[aria-pressed=true]`));
    assert.ok(r && /background\s*:\s*var\(--st-/.test(r.body) && /color\s*:\s*var\(--on-solid\)/.test(r.body), `${s}: background and --on-solid text together`);
  }
});

test('placeholders use a token colour (the browser default is too faint on dark fields)', () => {
  assert.ok(rules.some(r => r.sel === '::placeholder' && /color\s*:\s*var\(--muted\)/.test(r.body)));
});
