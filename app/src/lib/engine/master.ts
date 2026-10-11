/**
 * Master bus (PRD "frequency safety", "space and depth", "loudness control").
 *
 *   input ─▶ HPF 30 Hz ─▶ high shelf −6 dB @ 8 kHz ─▶ LPF 12 kHz ─┬────────────▶ sum
 *   reverbSend ─▶ hall convolver ─▶ LPF 6 kHz ──────────────────────┘
 *   sum ─▶ user volume ─▶ glue compressor ─▶ limiter ─▶ hard ceiling (−1 dBFS) ─▶ out
 *
 * The user volume sits *before* the limiter and ceiling, so no setting can
 * exceed the ceiling (F11).
 */

export const CEILING = Math.pow(10, -1 / 20); // −1 dBFS ≈ 0.891
export const MAX_USER_VOLUME = 1;

export interface MasterBus {
  input: GainNode;
  reverbSend: GainNode;
  output: AudioNode;
  analyser: AnalyserNode;
  setVolume(v: number, at?: number): void;
  /** Overall fade (sleep timer, stop). */
  fadeTo(level: number, seconds: number): void;
}

export function hallImpulse(ctx: BaseAudioContext, seconds = 4.5, seed = 7): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      // slow 0.08 s bloom, then exponential decay (−60 dB at `seconds`)
      const env = Math.min(1, t / 0.08) * Math.exp((-6.9 * t) / seconds);
      d[i] = rand() * env;
    }
  }
  return buf;
}

function ceilingCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // linear up to 0.7, then a smooth knee that never exceeds CEILING
    const a = Math.abs(x);
    const knee = 0.7;
    const y = a <= knee ? a : knee + (CEILING - knee) * Math.tanh((a - knee) / (CEILING - knee));
    curve[i] = Math.sign(x) * Math.min(y, CEILING);
  }
  return curve;
}

export function createMasterBus(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): MasterBus {
  const input = ctx.createGain();

  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 30;
  hpf.Q.value = 0.7;

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 8000;
  shelf.gain.value = -6;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 12000;
  lpf.Q.value = 0.5;

  const reverbSend = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = hallImpulse(ctx);
  const reverbTone = ctx.createBiquadFilter();
  reverbTone.type = 'lowpass';
  reverbTone.frequency.value = 6000;
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.9;

  const sum = ctx.createGain();
  const user = ctx.createGain();
  user.gain.value = 0.8;
  const fader = ctx.createGain();

  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 12;
  glue.ratio.value = 3;
  glue.attack.value = 0.05;
  glue.release.value = 0.4;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;

  const ceiling = ctx.createWaveShaper();
  ceiling.curve = ceilingCurve();
  ceiling.oversample = '4x';

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.85;

  input.connect(hpf).connect(shelf).connect(lpf).connect(sum);
  const reverbHpf = ctx.createBiquadFilter();
  reverbHpf.type = 'highpass';
  reverbHpf.frequency.value = 80;
  reverbSend.connect(reverbHpf).connect(convolver).connect(reverbTone).connect(reverbReturn).connect(sum);
  sum.connect(user).connect(fader).connect(glue).connect(limiter).connect(ceiling);
  ceiling.connect(analyser);
  ceiling.connect(destination);

  return {
    input,
    reverbSend,
    output: ceiling,
    analyser,
    setVolume(v, at = ctx.currentTime) {
      const level = Math.min(MAX_USER_VOLUME, Math.max(0, v));
      user.gain.cancelScheduledValues(at);
      user.gain.setTargetAtTime(level, at, 0.08);
    },
    fadeTo(level, seconds) {
      const t = ctx.currentTime;
      fader.gain.cancelScheduledValues(t);
      fader.gain.setValueAtTime(fader.gain.value, t);
      fader.gain.linearRampToValueAtTime(Math.max(0, level), t + Math.max(0.01, seconds));
    },
  };
}
