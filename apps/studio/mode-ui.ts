// The light / dark / auto switch in the top-right corner of the studio. Interface only (see mode.ts for the separation
// from the video). The boot script in index.html has already set <html data-theme> before the first paint; this file
// adds the control, stores the choice and follows the system while the choice is Auto.
import { MODES, MODE_KEY, parsePref, resolveMode, stepPref, type ModePref } from './mode.ts';

const ICONS: Record<ModePref, string> = {
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M12 7v6a3 3 0 0 0 0-6z" fill="currentColor"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
};
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const read = () => { try { return parsePref(localStorage.getItem(MODE_KEY)); } catch { return 'auto' as const; } };
const write = (p: ModePref) => { try { localStorage.setItem(MODE_KEY, p); } catch { /* private mode: the choice lasts until the page closes */ } };
const dark = matchMedia('(prefers-color-scheme: dark)');

export function applyMode(pref: ModePref) {
  const root = document.documentElement;
  root.dataset.themePref = pref; root.dataset.theme = resolveMode(pref, dark.matches);
}

export function initModeSwitch() {
  const box = document.getElementById('themeSwitch'); if (!box) return;
  let pref = read();
  box.setAttribute('role', 'radiogroup'); box.setAttribute('aria-label', 'Interface colour mode');
  const buttons = new Map<ModePref, HTMLButtonElement>();
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.mode = m.id; b.setAttribute('role', 'radio'); b.title = m.hint; b.setAttribute('aria-label', m.label);
    b.innerHTML = svg(ICONS[m.id]); buttons.set(m.id, b); box.append(b);
    b.onclick = () => choose(m.id);
  }
  const sync = () => { for (const [id, b] of buttons) { b.setAttribute('aria-checked', String(id === pref)); b.tabIndex = id === pref ? 0 : -1; } };
  function choose(p: ModePref, focus = false) { pref = p; write(p); applyMode(p); sync(); if (focus) buttons.get(p)!.focus(); }
  box.onkeydown = (e) => { const next = stepPref(pref, e.key); if (next) { e.preventDefault(); choose(next, true); } };
  // Auto follows the system while the page is open
  const follow = () => { if (pref === 'auto') applyMode('auto'); };
  dark.addEventListener('change', follow);
  // belt and braces: if a change event is missed (some embedded browsers, or the system switched while the window was hidden), look again when the window is used
  addEventListener('focus', follow); document.addEventListener('visibilitychange', follow);
  // the choice made in another studio tab
  addEventListener('storage', (e) => { if (e.key === MODE_KEY) { pref = read(); applyMode(pref); sync(); } });
  applyMode(pref); sync();
}
