// Mirror layouts. Each preset is pure data + conics; the simulation engine is shared.
// Positions are logical pixels on the 1080x1920 canvas, measured from the reference Shorts.
import { type Conic, ellipse, parabolaUp, hyperbolaUpper, ellipseCap, segment } from './geometry.ts';

export type TargetRole = 'fan' | 'pass' | 'absorb';
export interface Target { x: number; y: number; role: TargetRole; /** fan directions: centre angle (rad, screen) and spread */ angle?: number; spread?: number }

export interface Layout {
  walls: Conic[];
  /** extra drawn polylines that are not mirrors (e.g. the "home" line) */
  decor?: { pts: [number, number][]; color: string; width: number }[];
  targets: Target[];
  mode: 'fan' | 'drop';
  /** fan mode: indices of targets the first wave starts from */
  start?: number[];
  /** drop mode: balls fall straight down from y = dropY at x = cx ± offsets in [o0, o1] */
  drop?: { y: number; o0: number; o1: number; sides: 'both' | 'full' };
  /** drop mode: absorbed when crossing this y upward (retro-reflector) */
  homeY?: number;
  /** multiply sequence values (two fans => counts × 2) */
  countScale: number;
  title: string; answer: string;
  /** default escalation for this layout */
  seq: { kind: string; n: number };
  /** where balls are drawn absorbed (fade) */
  cx: number;
}

const CX = 540;
const UP = -Math.PI / 2, DOWN = Math.PI / 2;

export function layout(kind: string, p: { ellipseRx: number; ellipseRy: number }): Layout {
  switch (kind) {
    case 'ellipse': {
      const cy = 930, rx = p.ellipseRx, ry = p.ellipseRy, c = Math.sqrt(Math.max(1, ry * ry - rx * rx));
      return {
        walls: [ellipse(CX, cy, rx, ry)], mode: 'fan', start: [0], countScale: 1, cx: CX,
        targets: [{ x: CX, y: cy + c, role: 'fan', angle: 0.45, spread: Math.PI * 2 }, { x: CX, y: cy - c, role: 'fan', angle: 0.45, spread: Math.PI * 2 }],
        title: 'Will every ball find the same spot?', answer: 'Every single one: {n}!', seq: { kind: 'fibonacci', n: 13 },
      };
    }
    case 'peanut': {
      // two elliptical lobes sharing the middle focus; lobe foci are 270 px apart
      const c = 180, a = 290, b = Math.sqrt(a * a - c * c), mid = 960;
      const top = ellipse(CX, mid - c, b, a, -Infinity, mid), bot = ellipse(CX, mid + c, b, a, mid, Infinity);
      return {
        walls: [top, bot], mode: 'fan', start: [0, 2], countScale: 2, cx: CX,
        targets: [
          { x: CX, y: mid - 2 * c, role: 'fan', angle: UP, spread: (4 * Math.PI) / 3 },
          { x: CX, y: mid, role: 'pass' },
          { x: CX, y: mid + 2 * c, role: 'fan', angle: DOWN, spread: (4 * Math.PI) / 3 },
        ],
        title: 'Do all paths cross in the middle?', answer: 'All {n}, right through the centre!', seq: { kind: 'fibonacci', n: 11 },
      };
    }
    case 'parabola': {
      const vy = 1450, f = 96;
      return {
        walls: [parabolaUp(CX, vy, f, CX - 415, CX + 415)], mode: 'drop', countScale: 1, cx: CX,
        drop: { y: 600, o0: 0, o1: 380, sides: 'full' },
        targets: [{ x: CX, y: vy - f, role: 'absorb' }],
        title: 'Can a curve make them land together?', answer: 'All {n} land at the same instant!', seq: { kind: 'gentle', n: 13 },
      };
    }
    case 'corner': {
      const vy = 1340, h = 400, home = 560;
      return {
        walls: [segment(CX - h, vy - h, CX, vy), segment(CX, vy, CX + h, vy - h)], mode: 'drop', countScale: 1, cx: CX,
        decor: [{ pts: [[CX - h, home], [CX + h, home]], color: '#ffd23f', width: 4 }],
        drop: { y: home, o0: 6, o1: 380, sides: 'full' }, homeY: home,
        targets: [],
        title: 'Does every ball find its way home?', answer: 'All {n} came straight back!', seq: { kind: 'fibonacci', n: 11 },
      };
    }
    case 'cassegrain': {
      // confocal parabola (focus F1) + convex hyperbolic secondary (foci F1, F2) -> through the hole to F2
      const vy = 1308, f = 660, F1 = vy - f, F2 = 1400, hole = 45;
      const cHy = (F2 - F1) / 2, cyH = (F1 + F2) / 2, aH = cyH - 785, bH = Math.sqrt(cHy * cHy - aH * aH);
      return {
        walls: [parabolaUp(CX, vy, f, CX - 460, CX - hole), parabolaUp(CX, vy, f, CX + hole, CX + 460), hyperbolaUpper(CX, cyH, aH, bH, 95)],
        mode: 'drop', countScale: 1, cx: CX,
        drop: { y: 450, o0: 130, o1: 420, sides: 'both' },
        targets: [{ x: CX, y: F2, role: 'absorb' }],
        title: 'Can two curved mirrors funnel them all?', answer: 'All {n} through the gap!', seq: { kind: 'gentle', n: 16 },
      };
    }
    case 'gregorian': {
      // parabola focus F1 is crossed first, a concave elliptical secondary sends everyone to F2
      const vy = 1305, f = 520, F1 = vy - f, F2 = 1400, hole = 45;
      const c = (F2 - F1) / 2, cy = (F1 + F2) / 2, a = cy - 620, b = Math.sqrt(a * a - c * c);
      return {
        walls: [parabolaUp(CX, vy, f, CX - 460, CX - hole), parabolaUp(CX, vy, f, CX + hole, CX + 460), ellipseCap(CX, cy, b, a, 150)],
        mode: 'drop', countScale: 1, cx: CX,
        drop: { y: 430, o0: 160, o1: 420, sides: 'both' },
        targets: [{ x: CX, y: F1, role: 'pass' }, { x: CX, y: F2, role: 'absorb' }],
        title: 'How often do their paths cross?', answer: 'Twice — all {n} of them!', seq: { kind: 'gentle', n: 16 },
      };
    }
  }
  throw new Error('unknown layout ' + kind);
}

export const LAYOUTS = ['ellipse', 'peanut', 'parabola', 'corner', 'cassegrain', 'gregorian'];
