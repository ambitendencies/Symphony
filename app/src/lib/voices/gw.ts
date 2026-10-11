/**
 * Gravitational-wave physics for the Black Hole Chirps voice. Pure maths —
 * no Web Audio — so it is unit-tested directly.
 *
 * Inspiral: leading-order (quadrupole, "Newtonian") chirp,
 *   f(τ) = (1/π) (5 / (256 τ))^(3/8) (G M_c / c³)^(-5/8)
 * where τ is the time left before coalescence and M_c the detector-frame
 * chirp mass (Peters & Mathews 1963; e.g. Maggiore, Gravitational Waves vol. 1, eq. 4.19).
 * Amplitude grows as f^(2/3).
 *
 * Ringdown: the final black hole's fundamental l=m=2 quasi-normal mode, from
 * the fits of Berti, Cardoso & Will 2006 (PRD 73, 064030, Table VIII):
 *   M ω = 1.5251 − 1.1568 (1 − j)^0.1292,   Q = 0.7000 + 1.4187 (1 − j)^−0.4990.
 *
 * The same formulas are used by the old Python reference
 * (symphony/sources/gravitational.py) and by pipeline/gw_events.py.
 */

export const G = 6.674e-11;
export const C = 2.998e8;
export const M_SUN = 1.989e30;
/** G M☉ / c³ in seconds (≈ 4.93 µs). */
export const T_SUN = (G * M_SUN) / C ** 3;

export function chirpMass(m1: number, m2: number): number {
  return Math.pow(m1 * m2, 0.6) / Math.pow(m1 + m2, 0.2);
}

/** GW frequency (Hz) a time τ (s) before coalescence, for detector-frame chirp mass mc (M☉). */
export function chirpFrequency(tau: number, mc: number): number {
  const t = Math.max(tau, 1e-9);
  return (1 / Math.PI) * Math.pow(5 / (256 * t), 3 / 8) * Math.pow(T_SUN * mc, -5 / 8);
}

/** Inverse of chirpFrequency: time (s) left before coalescence when the GW frequency is f. */
export function timeToCoalescence(f: number, mc: number): number {
  return (5 / 256) * Math.pow(Math.PI * f, -8 / 3) * Math.pow(T_SUN * mc, -5 / 3);
}

/** Ringdown (l=m=2, n=0) frequency in Hz of a black hole of mass m (M☉, detector frame) and spin j. */
export function ringdownFrequency(m: number, spin: number): number {
  const j = Math.min(0.99, Math.max(0, spin));
  const momega = 1.5251 - 1.1568 * Math.pow(1 - j, 0.1292);
  return momega / (2 * Math.PI * T_SUN * m);
}

/** Ringdown e-folding time (s): τ = Q / (π f). */
export function ringdownTime(m: number, spin: number): number {
  const j = Math.min(0.99, Math.max(0, spin));
  const q = 0.7 + 1.4187 * Math.pow(1 - j, -0.499);
  return q / (Math.PI * ringdownFrequency(m, spin));
}

/** GW frequency at the innermost stable circular orbit of total mass m (M☉): c³ / (6^1.5 π G M). */
export function iscoFrequency(m: number): number {
  return 1 / (Math.pow(6, 1.5) * Math.PI * T_SUN * m);
}

export interface GwEvent {
  name: string;
  kind: 'BBH' | 'BNS';
  /** Source-frame component masses (M☉). */
  m1: number;
  m2: number;
  /** Source-frame final mass (M☉); for BNS the remnant is uncertain. */
  mfinal: number;
  /** Final dimensionless spin (BBH). */
  spin: number;
  /** Luminosity distance (Mpc). */
  dl: number;
  z: number;
  /** Light-travel (lookback) time in billions of years = distance in billions of light-years as people usually say it. */
  lookbackGyr: number;
  date: string;
}

/** Frequencies of the event as LIGO/Virgo saw it (detector frame, redshifted by 1+z). */
export function eventFrequencies(e: GwEvent): { mcDet: number; fEnd: number; tauRing: number } {
  const mcDet = chirpMass(e.m1, e.m2) * (1 + e.z);
  if (e.kind === 'BNS') {
    // No ringdown was observed; the inspiral is followed up to the ISCO of the total mass.
    return { mcDet, fEnd: iscoFrequency((e.m1 + e.m2) * (1 + e.z)), tauRing: 0 };
  }
  const mf = e.mfinal * (1 + e.z);
  return { mcDet, fEnd: ringdownFrequency(mf, e.spin), tauRing: ringdownTime(mf, e.spin) };
}

export interface ChirpPlan {
  /** Audio seconds of the rising inspiral. */
  rise: number;
  /** Audio seconds of the (lengthened) ringdown tail. */
  tail: number;
  /** Factor by which time is slowed down. */
  stretch: number;
  /** Factor by which every frequency is multiplied (landing / fEnd). */
  pitch: number;
  /** Physical start frequency (Hz) of the excerpt (two octaves below the end). */
  fStart: number;
  fEnd: number;
  /** Real duration (s) of the excerpt in the detector. */
  realSeconds: number;
}

/** Octaves of inspiral heard: the excerpt starts this many octaves below the end frequency. */
export const CHIRP_OCTAVES = 2;

/**
 * Plan an audible excerpt: the last two octaves of the inspiral, slowed so
 * that heavier systems (which really do sweep more slowly) take longer, and
 * shifted so the final frequency lands on `landingHz` (a chord tone).
 */
export function planChirp(e: GwEvent, landingHz: number): ChirpPlan {
  const { mcDet, fEnd, tauRing } = eventFrequencies(e);
  const fStart = fEnd / 2 ** CHIRP_OCTAVES;
  const realSeconds = timeToCoalescence(fStart, mcDet) - timeToCoalescence(fEnd, mcDet);
  // GW150914's last two octaves last ~37 ms; heavier → longer. Map to 7–12 s of audio.
  const rise = Math.min(12, Math.max(7, 9 * Math.pow(realSeconds / 0.037, 0.18)));
  const stretch = rise / realSeconds;
  // The real ringdown lasts milliseconds (tauRing); we let it ring for seconds (stated in the cards).
  const tail = e.kind === 'BNS' ? 3 : Math.min(6.5, 4.5 + tauRing * stretch);
  return { rise, tail, stretch, pitch: landingHz / fEnd, fStart, fEnd, realSeconds };
}

/**
 * Synthesize the excerpt as a mono strain-like waveform (peak ≈ 1): a sine
 * whose frequency follows the stretched, shifted chirp, amplitude ∝ f^(2/3),
 * emerging gently at the start and decaying smoothly after the merger.
 */
export function renderChirp(plan: ChirpPlan, e: GwEvent, sampleRate: number): Float32Array {
  const { mcDet } = eventFrequencies(e);
  const nRise = Math.max(2, Math.floor(plan.rise * sampleRate));
  const nTail = Math.max(2, Math.floor(plan.tail * sampleRate));
  const out = new Float32Array(nRise + nTail);
  const tau0 = timeToCoalescence(plan.fStart, mcDet);
  const tau1 = timeToCoalescence(plan.fEnd, mcDet);
  const nyq = sampleRate * 0.45;
  let phase = 0;
  for (let i = 0; i < nRise; i++) {
    const u = i / nRise;
    const tau = tau0 - (tau0 - tau1) * u;
    const f = Math.min(nyq, chirpFrequency(tau, mcDet) * plan.pitch);
    phase += (2 * Math.PI * f) / sampleRate;
    // f^(2/3) growth, plus a slow emergence over the first 35% (signal rising out of the noise).
    const amp = Math.pow(f / (plan.fEnd * plan.pitch), 2 / 3) * Math.min(1, Math.sqrt(u / 0.35));
    out[i] = amp * Math.sin(phase);
  }
  const fLand = Math.min(nyq, plan.fEnd * plan.pitch);
  const decay = plan.tail / 3;
  for (let i = 0; i < nTail; i++) {
    const t = i / sampleRate;
    phase += (2 * Math.PI * fLand) / sampleRate;
    // A raised-cosine join keeps the hand-over from rise to ring free of corners.
    const amp = Math.exp(-t / decay) * (1 - Math.max(0, (i - nTail * 0.85) / (nTail * 0.15)));
    out[nRise + i] = amp * Math.sin(phase);
  }
  return out;
}

/** "1.4 billion" / "130 million" light-years (from lookback time in Gyr). */
export function formatLightYears(gyr: number): string {
  if (gyr >= 0.95) return `${gyr.toFixed(1).replace(/\.0$/, '')} billion light-years`;
  const myr = gyr * 1000;
  const rounded = myr >= 100 ? Math.round(myr / 10) * 10 : Math.round(myr);
  return `${rounded} million light-years`;
}
