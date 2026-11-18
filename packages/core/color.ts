export type RGB = [number, number, number];

export const PALETTES: Record<string, string[]> = {
  rainbow: ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff6f9a', '#ff8a3d', '#ffd23f', '#9be36b'],
  timeline: ['#38e1e6', '#4f8dff', '#9b6bff', '#e86cf0', '#ff7a8a', '#ff9a3d', '#ffd23f', '#b6e36b'],
  spectrum: ['#9be36b', '#ffd23f', '#ff9a3d', '#ff6f6f', '#ff6fb5', '#e86cf0', '#9b6bff', '#4f8dff', '#38e1e6'],
  ice: ['#38e1e6', '#4f8dff', '#9b6bff', '#38e1e6'],
  ember: ['#ffd23f', '#ff8a3d', '#ff4f6a', '#e86cf0', '#ffd23f'],
  mono: ['#9cf3ff', '#9cf3ff'],
};

export function hexToRgb(h: string): RGB { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(c: RGB | number[]): string {
  return '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}
export function mixRgb(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** Sample a palette at u in [0,1]. cyclic wraps the last stop back to the first. */
export function samplePalette(stops: string[], u: number, cyclic = true): RGB {
  const n = cyclic ? stops.length : stops.length - 1;
  const x = (cyclic ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u))) * n;
  const i = Math.min(Math.floor(x), n - 1);
  return mixRgb(hexToRgb(stops[i % stops.length]), hexToRgb(stops[(i + 1) % stops.length]), x - i);
}
export const rgba = (c: RGB | number[], a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
