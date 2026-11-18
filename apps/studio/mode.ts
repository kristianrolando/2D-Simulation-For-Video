// Light / dark / automatic mode of the STUDIO INTERFACE. Pure helpers (no DOM) so they can be unit-tested in Node.
//
// SEPARATION: this only decides how the studio's own panels, text, buttons, tables and dialogs look. It never touches
// the video: the preview canvas, the rendered MP4, the thumbnails and the style themes (themes/*.json) keep the look of
// the video style in both modes. The colours of the interface are CSS tokens in style.css; the only colours defined in
// code are the category accents below, because they depend on the scene family.

export type ModePref = 'auto' | 'light' | 'dark';
export type Mode = 'light' | 'dark';
export const MODE_KEY = 'studio.theme';
export const MODES: { id: ModePref; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Follow the system (light or dark)' },
  { id: 'light', label: 'Light', hint: 'Light interface' },
  { id: 'dark', label: 'Dark', hint: 'Dark interface' },
];

/** anything stored or typed that is not one of the three choices means Auto (the default) */
export const parsePref = (x: unknown): ModePref => (x === 'light' || x === 'dark' ? x : 'auto');
/** the mode that is actually shown. Auto follows the system; if the system's choice is unknown it stays dark (the studio's original look). */
export const resolveMode = (pref: ModePref, systemDark: boolean | null): Mode => (pref === 'auto' ? (systemDark === false ? 'light' : 'dark') : pref);
/** radio-group keyboard: arrows (and Home/End) move the choice, wrapping around; null = not a navigation key */
export function stepPref(current: ModePref, key: string): ModePref | null {
  const i = MODES.findIndex(m => m.id === current), n = MODES.length;
  if (key === 'ArrowRight' || key === 'ArrowDown') return MODES[(i + 1) % n].id;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return MODES[(i - 1 + n) % n].id;
  if (key === 'Home') return MODES[0].id;
  if (key === 'End') return MODES[n - 1].id;
  return null;
}

/** one accent per physics family: a light tint for the dark interface, a deeper tone for the light one (both ≥ 4.5:1 as text on their panels; see tests/mode.test.ts) */
export const CAT_COLORS: Record<string, { dark: string; light: string }> = {
  'conic mirrors': { dark: '#7fe6ff', light: '#00677f' },
  orbits: { dark: '#ffc861', light: '#8a5300' },
  oscillations: { dark: '#ff7ac0', light: '#b0176f' },
  probability: { dark: '#8be07a', light: '#1a6e1a' },
  chaos: { dark: '#b18cff', light: '#6a3fd1' },
  geometry: { dark: '#6fa8ff', light: '#1a50b8' },
  smash: { dark: '#ff9a4a', light: '#9a4400' },
  sync: { dark: '#5fe0c0', light: '#08705a' },
};
export const CAT_FALLBACK = { dark: '#9cf3ff', light: '#006a80' };
/** a CSS colour that follows the interface mode (the browser resolves light-dark() from the page's colour-scheme) */
export const modeColor = (c: { dark: string; light: string }) => `light-dark(${c.light}, ${c.dark})`;
export const catColor = (family: string) => modeColor(CAT_COLORS[family] ?? CAT_FALLBACK);
