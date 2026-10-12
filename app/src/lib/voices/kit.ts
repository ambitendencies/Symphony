/**
 * Shared building blocks for voices. They enforce the PRD's sound rules:
 * minimum attacks (≈50 ms chimes, ≥1 s pads), no hard transients, gentle
 * filtering — so a voice built from these is soothing by construction.
 */

export const MIN_CHIME_ATTACK = 0.05;
export const MIN_PAD_ATTACK = 1.0;

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Cache of PeriodicWaves keyed by partial recipe, per context. */
const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/** A soft additive timbre: partial amplitudes for harmonics 1..n. */
export function softWave(ctx: BaseAudioContext, partials: number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  const key = partials.join(',');
  let w = m.get(key);
  if (!w) {
    const real = new Float32Array(partials.length + 1);
    const imag = new Float32Array(partials.length + 1);
    partials.forEach((a, i) => (imag[i + 1] = a));
    w = ctx.createPeriodicWave(real, imag);
    m.set(key, w);
  }
  return w;
}

export const TIMBRES = {
  /** Warm, mostly fundamental. */
  warm: [1, 0.35, 0.12, 0.05],
  /** Glassy bell-like (odd-ish partials, quiet). */
  glass: [1, 0.08, 0.3, 0.02, 0.12],
  /** Hollow, flute-like. */
  hollow: [1, 0.02, 0.18, 0.01, 0.06],
  /** Pure sine. */
  sine: [1],
};

export interface NoteOptions {
  freq: number;
  start: number;
  /** Seconds; clamped up to the minimum for the kind. */
  attack?: number;
  hold?: number;
  release?: number;
  /** Peak linear gain (keep ≤ 0.3 per note; the mix sums many). */
  gain?: number;
  timbre?: number[];
  /** Optional low-pass cutoff in Hz. */
  cutoff?: number;
  /** 'chime' enforces ≥50 ms attack, 'pad' ≥1 s. */
  kind?: 'chime' | 'pad';
  /** Detune in cents for a gentle chorus (adds a second oscillator). */
  spread?: number;
  /** Stereo position −1..1. */
  pan?: number;
}

/** Schedule one enveloped note into `dest`. Returns its end time. */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, o: NoteOptions): number {
  const kind = o.kind ?? 'chime';
  const attack = Math.max(kind === 'pad' ? MIN_PAD_ATTACK : MIN_CHIME_ATTACK, o.attack ?? (kind === 'pad' ? 2 : 0.06));
  const hold = Math.max(0, o.hold ?? 0);
  const release = Math.max(0.2, o.release ?? (kind === 'pad' ? 3 : 1.5));
  const peak = Math.min(0.5, o.gain ?? 0.2);
  const end = o.start + attack + hold + release;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, o.start);
  env.gain.linearRampToValueAtTime(peak, o.start + attack);
  env.gain.setValueAtTime(peak, o.start + attack + hold);
  // exponential-ish release via setTargetAtTime, then hard zero at the end
  env.gain.setTargetAtTime(0, o.start + attack + hold, release / 4);
  env.gain.setValueAtTime(0, end);

  let tail: AudioNode = env;
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(o.cutoff, ctx.sampleRate * 0.45);
    f.Q.value = 0.5;
    env.connect(f);
    tail = f;
  }
  if (o.pan !== undefined && o.pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    tail.connect(p);
    tail = p;
  }
  tail.connect(dest);

  const wave = softWave(ctx, o.timbre ?? TIMBRES.warm);
  const detunes = o.spread ? [-o.spread / 2, o.spread / 2] : [0];
  for (const d of detunes) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = Math.min(o.freq, ctx.sampleRate * 0.45);
    osc.detune.value = d;
    const g = ctx.createGain();
    g.gain.value = 1 / detunes.length;
    osc.connect(g).connect(env);
    osc.start(o.start);
    osc.stop(end + 0.05);
    osc.onended = () => {
      g.disconnect();
      env.disconnect();
      tail.disconnect();
    };
  }
  return end;
}

/** A continuous tone whose pitch and level glide (for drones and pads). */
export interface Drone {
  output: GainNode;
  setFreq(freq: number, at: number, glide?: number): void;
  setLevel(level: number, at: number, glide?: number): void;
  setCutoff(hz: number, at: number, glide?: number): void;
  stop(at: number): void;
}

export function createDrone(
  ctx: BaseAudioContext,
  freq: number,
  opts: { timbre?: number[]; spread?: number; cutoff?: number; level?: number; start?: number } = {},
): Drone {
  const start = opts.start ?? ctx.currentTime;
  const output = ctx.createGain();
  output.gain.setValueAtTime(0, start);
  output.gain.linearRampToValueAtTime(opts.level ?? 0.2, start + MIN_PAD_ATTACK * 3);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.cutoff ?? 1200;
  filter.Q.value = 0.4;
  filter.connect(output);
  const wave = softWave(ctx, opts.timbre ?? TIMBRES.warm);
  const spread = opts.spread ?? 6;
  const oscs = [-spread / 2, spread / 2].map((d) => {
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = freq;
    o.detune.value = d;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    o.connect(g).connect(filter);
    o.start(start);
    return o;
  });
  return {
    output,
    setFreq(f, at, glide = 3) {
      for (const o of oscs) o.frequency.setTargetAtTime(Math.min(f, ctx.sampleRate * 0.45), at, glide / 3);
    },
    setLevel(level, at, glide = 3) {
      output.gain.setTargetAtTime(Math.max(0, level), at, glide / 3);
    },
    setCutoff(hz, at, glide = 3) {
      filter.frequency.setTargetAtTime(Math.min(hz, ctx.sampleRate * 0.45), at, glide / 3);
    },
    stop(at) {
      output.gain.setTargetAtTime(0, at, 0.5);
      for (const o of oscs) o.stop(at + 3);
    },
  };
}

/** Looping noise source (for breath, air, shimmer). */
export function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1, color: 'white' | 'pink' | 'brown' = 'pink'): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = seededRandom(seed);
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'white') d[i] = w;
    else if (color === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = brown * 3.5;
    } else {
      // Paul Kellet's economy pink filter
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  // crossfade the loop seam
  const k = Math.min(n >> 2, Math.floor(0.05 * ctx.sampleRate));
  for (let i = 0; i < k; i++) {
    const a = i / k;
    d[i] = d[i] * a + d[n - k + i] * (1 - a);
  }
  return buf;
}

/** Wrap a mono audio-rate array (e.g. a pre-resampled audified waveform) as a buffer. */
export function arrayToBuffer(ctx: BaseAudioContext, data: ArrayLike<number>, sampleRate: number): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const k = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < data.length; i++) d[i] = data[i] * k;
  return buf;
}
