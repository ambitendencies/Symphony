/**
 * Small pure helpers shared by the Phase B voices (pulsars, singing stars,
 * black-hole chirps). No sound is made here except `envelopeGain`, which
 * applies the same attack/hold/release rules as kit.playNote.
 */

import { MIN_CHIME_ATTACK, MIN_PAD_ATTACK } from './kit';

/** Move a MIDI value by whole octaves until it lies in [low, high] (as close to the middle as possible). */
export function foldIntoRange(midi: number, low: number, high: number): number {
  let m = midi;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return m;
}

/** Light-years from kiloparsecs. */
export const LY_PER_KPC = 3261.56;

/** "910 light-years", "6,500 light-years" — two significant figures, honest about precision. */
export function formatLy(ly: number): string {
  const digits = Math.max(0, Math.floor(Math.log10(Math.max(1, ly))) - 1);
  const rounded = Math.round(ly / 10 ** digits) * 10 ** digits;
  return `${rounded.toLocaleString('en-US')} light-years`;
}

/** "about 130,000" — two significant figures. */
export function formatFactor(x: number): string {
  if (x < 100) return `${Math.round(x)}`;
  const digits = Math.floor(Math.log10(x)) - 1;
  if (x >= 1e6) return `${(Math.round(x / 1e5) / 10).toLocaleString('en-US')} million`;
  return (Math.round(x / 10 ** digits) * 10 ** digits).toLocaleString('en-US');
}

/** A period in friendly units: "5.4 minutes", "2.5 hours", "1.34 seconds". */
export function formatPeriod(seconds: number): string {
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} seconds`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}

export interface EnvelopeShape {
  start: number;
  attack: number;
  hold: number;
  release: number;
  peak: number;
  kind: 'chime' | 'pad';
}

/**
 * A GainNode carrying an attack/hold/release envelope with the PRD minimums
 * (≥50 ms chimes, ≥1 s pads). Returns the node and the time it reaches zero.
 */
export function envelopeGain(ctx: BaseAudioContext, s: EnvelopeShape): { node: GainNode; end: number } {
  const attack = Math.max(s.kind === 'pad' ? MIN_PAD_ATTACK : MIN_CHIME_ATTACK, s.attack);
  const release = Math.max(0.2, s.release);
  const hold = Math.max(0, s.hold);
  const peak = Math.min(0.5, Math.max(0, s.peak));
  const end = s.start + attack + hold + release;
  const node = ctx.createGain();
  node.gain.setValueAtTime(0, s.start);
  node.gain.linearRampToValueAtTime(peak, s.start + attack);
  node.gain.setValueAtTime(peak, s.start + attack + hold);
  node.gain.setTargetAtTime(0, s.start + attack + hold, release / 4);
  node.gain.setValueAtTime(0, end);
  return { node, end };
}

/** Deterministic Fisher–Yates shuffle with a supplied random source. */
export function shuffled<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isFiniteIn(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > lo && x < hi;
}
