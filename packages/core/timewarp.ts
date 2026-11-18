// TimeWarp: video frame -> simulation time. The table is a deterministic cumulative sum at frame
// resolution, scaled so that simTime(anchorFrame) equals anchorSim exactly (a climax lands on a
// chosen frame no matter how the speed curve is shaped).

export class TimeWarp {
  readonly fps: number;
  readonly tab: Float64Array;
  readonly scale: number;
  constructor(o: { fps: number; frames: number; rateAt: (t: number) => number; anchorFrame: number; anchorSim: number }) {
    this.fps = o.fps;
    const tab = new Float64Array(o.frames + 1);
    let acc = 0;
    for (let f = 1; f <= o.frames; f++) { acc += o.rateAt((f - 0.5) / o.fps) / o.fps; tab[f] = acc; }
    const a = Math.min(o.anchorFrame, o.frames);
    const scale = tab[a] > 0 ? o.anchorSim / tab[a] : 1;
    for (let f = 0; f <= o.frames; f++) tab[f] *= scale;
    if (a > 0) tab[a] = o.anchorSim;
    this.tab = tab;
    this.scale = scale;
  }
  sim(frame: number): number { return this.tab[Math.max(0, Math.min(frame, this.tab.length - 1))]; }
  /** fractional simulation time (linear between frames) */
  simAt(frameFloat: number): number {
    const f0 = Math.floor(frameFloat), f = frameFloat - f0;
    return this.sim(f0) * (1 - f) + this.sim(f0 + 1) * f;
  }
  /** inverse: simulation time -> fractional video time in seconds */
  videoTime(simT: number): number {
    const tab = this.tab; let lo = 0, hi = tab.length - 1;
    if (simT <= tab[0]) return 0;
    if (simT >= tab[hi]) return hi / this.fps;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] < simT) lo = m; else hi = m; }
    const f = tab[hi] > tab[lo] ? (simT - tab[lo]) / (tab[hi] - tab[lo]) : 0;
    return (lo + f) / this.fps;
  }
}
