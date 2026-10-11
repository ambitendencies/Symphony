/**
 * Data smoothing (PRD: "values are eased over 2–10 seconds and outliers are
 * clamped, so a sudden data spike becomes a swell, not a jump").
 */

export interface Range {
  min: number;
  max: number;
}

/** Clamp to a physically plausible range; non-finite values fall back. */
export function clampValue(x: number, r: Range, fallback = (r.min + r.max) / 2): number {
  if (!Number.isFinite(x)) return fallback;
  return Math.min(r.max, Math.max(r.min, x));
}

/** Map x in [r.min, r.max] to [0, 1], logarithmically when `log` is set. */
export function normalize(x: number, r: Range, log = false): number {
  const v = clampValue(x, r);
  if (log) return (Math.log(v) - Math.log(r.min)) / (Math.log(r.max) - Math.log(r.min));
  return (v - r.min) / (r.max - r.min);
}

/**
 * Median-of-window outlier rejection: a point further than `k` MADs from the
 * window median is replaced by the median.
 */
export function despike(series: number[], window = 5, k = 4): number[] {
  const half = Math.floor(window / 2);
  return series.map((x, i) => {
    const w = series.slice(Math.max(0, i - half), i + half + 1).filter(Number.isFinite).sort((a, b) => a - b);
    if (!w.length) return x;
    const med = w[Math.floor(w.length / 2)];
    const mad = w.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[Math.floor(w.length / 2)] || 1e-9;
    return !Number.isFinite(x) || Math.abs(x - med) > k * mad * 1.4826 ? med : x;
  });
}

/**
 * A value that glides toward its target with an exponential time constant,
 * and limits its own rate of change so even a step reads as a swell.
 */
export class Eased {
  private value: number;
  private target: number;
  private lastT: number | null = null;

  constructor(initial: number, private tau = 4, private maxRatePerSec = Infinity) {
    this.value = initial;
    this.target = initial;
  }

  set(target: number): void {
    if (Number.isFinite(target)) this.target = target;
  }

  /** Advance to time t (seconds) and return the eased value. */
  at(t: number): number {
    if (this.lastT === null) {
      this.lastT = t;
      return this.value;
    }
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    const alpha = 1 - Math.exp(-dt / this.tau);
    let step = (this.target - this.value) * alpha;
    const cap = this.maxRatePerSec * dt;
    if (Math.abs(step) > cap) step = Math.sign(step) * cap;
    this.value += step;
    return this.value;
  }

  get current(): number {
    return this.value;
  }
}
