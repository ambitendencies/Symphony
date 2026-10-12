/**
 * Afterglow — the cosmic microwave background.
 *
 * PRD: "The CMB power spectrum becomes a slow harmonic series."
 * 380,000 years after the Big Bang the young universe rang with sound waves
 * in its hot plasma. The peaks of Planck's temperature power spectrum are the
 * fundamental and overtones of that one sound (peaks near ℓ ≈ 220, 537, 813,
 * 1120, 1444). Here they become the first five harmonics of a single low
 * note, each harmonic's loudness set by the measured peak height (amplitude ∝
 * √Dℓ). A slow scan lifts each peak in turn, like reading the spectrum left to
 * right, once every few minutes.
 */

import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, gridTimes, list, num, str } from './base';
import { createDrone, midiToFreq, TIMBRES } from './kit';

export interface Peak {
  l: number;
  Dl: number; // μK²
}
interface Data {
  peaks: Peak[];
  temperatureK: number;
}

/** Bars for one full scan across the peaks. */
export const SCAN_BARS = 40;

export function parseAfterglow(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const peaks = list(doc?.peaks, 'peaks', 3).map((p, i) => {
    const o = p as Record<string, unknown>;
    return { l: num(o.l, `l ${i}`, 2, 5000), Dl: num(o.Dl, `Dl ${i}`, 1, 20000) };
  });
  for (let i = 1; i < peaks.length; i++) if (peaks[i].l <= peaks[i - 1].l) throw new Error('invalid archive: peaks out of order');
  return {
    values: { peaks: peaks.length, firstPeak: peaks[0].l },
    series: peaks.map((p) => p.Dl),
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { peaks, temperatureK: num(doc.temperatureK, 'temperature', 2, 3) },
  };
}

/** Harmonic amplitudes (sum 1) from peak heights: amplitude ∝ √Dℓ. */
export function harmonicAmps(peaks: Peak[]): number[] {
  const a = peaks.map((p) => Math.sqrt(p.Dl));
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / s);
}

class AfterglowVoice extends BaseVoice<Data> {
  private partials: ReturnType<typeof createDrone>[] = [];
  private focus = 0;

  private region(): Role {
    return this.role === 'harmony' ? 'harmony' : 'foundation';
  }

  protected decode(snap: DataSnapshot): Data {
    return { peaks: snap.extra!.peaks as Peak[], temperatureK: snap.extra!.temperatureK as number };
  }

  private build(d: Data, at: number): void {
    const { ctx, harmony } = this.vc;
    const root = midiToFreq(harmony.root(this.region()));
    const amps = harmonicAmps(d.peaks);
    this.partials = amps.map((a, i) =>
      createDrone(ctx, root * (i + 1), {
        timbre: TIMBRES.sine,
        spread: 3 + i,
        cutoff: 4000,
        level: 0.33 * a,
        start: at,
      }),
    );
    for (const p of this.partials) p.output.connect(this.output);
  }

  private teardown(at: number): void {
    for (const p of this.partials) p.stop(at);
    this.partials = [];
  }

  protected onRole(_r: Role, at: number): void {
    const d = this.data;
    this.teardown(at);
    if (d) this.build(d, at);
  }

  protected window(from: number, to: number, d: Data): void {
    const { clock } = this.vc;
    if (!this.partials.length) this.build(d, from);
    const amps = harmonicAmps(d.peaks);
    const scan = SCAN_BARS * clock.secondsPerBar;
    // Every bar, ease toward a balance that lifts the currently scanned peak.
    for (const t of gridTimes(from, to, clock.secondsPerBar, clock.origin)) {
      const pos = (((t - clock.origin) / scan) % 1) * amps.length;
      this.focus = Math.floor(pos);
      this.partials.forEach((p, i) => {
        const dist = Math.min(Math.abs(pos - (i + 0.5)), amps.length - Math.abs(pos - (i + 0.5)));
        const lift = 1 + 0.9 * Math.exp(-dist * dist * 1.5);
        p.setLevel(0.3 * amps[i] * lift, t, clock.secondsPerBar * 1.5);
      });
    }
  }

  protected onDispose(at: number): void {
    this.teardown(at);
  }

  readout(): Readout {
    const d = this.data;
    if (!d) return { headline: 'Afterglow: warming up…' };
    const p = d.peaks[Math.min(this.focus, d.peaks.length - 1)];
    return {
      headline: `Peak ${this.focus + 1} of ${d.peaks.length} at ℓ ≈ ${p.l}: ${Math.round(Math.sqrt(p.Dl))} μK`,
      detail: `Sound waves from when the universe was 380,000 years old, now ${d.temperatureK} K microwaves`,
      series: d.peaks.map((x) => x.Dl),
    };
  }
}

export const afterglow: VoiceDefinition = {
  id: 'afterglow',
  name: 'Afterglow',
  phenomenon: 'The cosmic microwave background, the oldest light in the universe',
  technique: 'sonification',
  color: '#e8a48a',
  roles: ['foundation', 'harmony'],
  live: false,
  credit: {
    mission: 'Planck',
    agency: 'ESA',
    dataset: 'Planck 2018 CMB temperature power spectrum',
    url: 'https://pla.esac.esa.int/',
  },
  cards: [
    { title: 'What it is', body: 'For its first 380,000 years the universe was a hot, glowing plasma that rang with sound waves. When it cooled, that light was set free. We still see it everywhere as faint microwaves at 2.7 degrees above absolute zero, with the sound waves frozen in as a pattern of hot and cold spots.' },
    { title: 'How the sound is made', body: 'A sonification. The peaks in Planck’s power spectrum are the fundamental and overtones of that ancient sound, so they become the first five harmonics of one low note, each as loud as its measured peak. A slow scan lifts each peak in turn.' },
    { title: 'The mission', body: 'ESA’s Planck satellite mapped the whole microwave sky from 2009 to 2013 with a precision of millionths of a degree. Its power spectrum pins down the age, contents and geometry of the universe.' },
  ],
  archive: 'afterglow.json',
  parse: parseAfterglow,
  create: (vc, role) => new AfterglowVoice(vc, role),
};
