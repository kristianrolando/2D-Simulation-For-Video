// Easing curves with character. Presentation only (titles, counters, ripples, juice), never simulation:
// they may use Math.* because their output never feeds back into physics state.
export const ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outQuint: (t: number) => 1 - (1 - t) ** 5,
  inOutSine: (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  outElastic: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t: number) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  /** 6 hard steps (digital / terminal feel) */
  steps: (t: number) => (t >= 1 ? 1 : Math.floor(t * 6) / 6),
};
export type EaseName = keyof typeof ease;
export const EASE_NAMES = Object.keys(ease) as EaseName[];
