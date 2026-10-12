/**
 * Atomic Echoes — gamma-ray lines from radioactive nuclei in space.
 *
 * PRD: "Soft, random bells." Supernovae and massive stars forge radioactive
 * isotopes (aluminium-26, iron-60, titanium-44, cobalt-56) whose decays give
 * off gamma rays at exact energies, like atomic fingerprints. Each isotope
 * becomes a bell whose overtones are its own line energies, as ratios folded
 * into one octave, sounding above a fundamental on a chord tone. The bells
 * ring at random moments, as decays do; the rate is musical, not physical.
 */

import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, foldRatio, gridTimes, list, num, str } from './base';
import { midiToFreq } from './kit';

export interface Isotope {
  name: string;
  linesKeV: number[];
  halfLifeYears: number;
  where: string;
  mission: string;
}
interface Data {
  isotopes: Isotope[];
}

export function parseAtomicEchoes(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const isotopes = list(doc?.isotopes, 'isotopes').map((x, i) => {
    const o = x as Record<string, unknown>;
    return {
      name: str(o.name, `name ${i}`),
      linesKeV: list(o.linesKeV, `lines ${i}`).map((e, j) => num(e, `line ${i}.${j}`, 1, 20000)),
      halfLifeYears: num(o.halfLifeYears, `half-life ${i}`, 0),
      where: str(o.where, `where ${i}`),
      mission: str(o.mission, `mission ${i}`),
    };
  });
  return {
    values: { isotopes: isotopes.length },
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { isotopes },
  };
}

/** Bell overtone ratios (above an octave) from an isotope's line energies. */
export function bellRatios(lines: number[]): number[] {
  const ref = Math.min(...lines);
  const folded = lines.map((e) => foldRatio(e / ref)).filter((r) => r > 1.0001);
  return [2, ...folded.map((r) => 2 * r), 3];
}

function formatHalfLife(y: number): string {
  if (y <= 0) return 'annihilates instantly';
  if (y < 1) return `half-life ${Math.round(y * 365.25)} days`;
  if (y < 1e4) return `half-life ${Math.round(y)} years`;
  return `half-life ${(y / 1e6).toFixed(y < 1e6 ? 2 : 1)} million years`;
}

class AtomicEchoesVoice extends BaseVoice<Data> {
  private latest: Isotope | null = null;

  protected decode(snap: DataSnapshot): Data {
    return { isotopes: snap.extra!.isotopes as Isotope[] };
  }

  private bell(t: number, iso: Isotope): void {
    const { ctx, harmony, random } = this.vc;
    const region: Role = this.role === 'melody' ? 'melody' : 'texture';
    const tones = harmony.chordTones(region, t);
    if (!tones.length) return;
    const f = midiToFreq(tones[Math.floor(random() * Math.min(3, tones.length))]);
    const peak = this.role === 'melody' ? 0.12 : 0.08;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (random() - 0.5) * 1.5;
    pan.connect(this.output);
    const ratios = [1, ...bellRatios(iso.linesKeV)];
    ratios.forEach((r, i) => {
      const freq = f * r;
      if (freq > Math.min(7000, ctx.sampleRate * 0.45)) return;
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const a = (peak / (1 + i * 0.9)) * (i === 0 ? 1 : 0.8);
      const decay = 2.6 / (1 + i * 0.6); // higher partials die away sooner, like a bell
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.05);
      g.gain.setTargetAtTime(0, t + 0.05, decay / 3);
      osc.connect(g).connect(pan);
      osc.start(t);
      osc.stop(t + 0.05 + decay * 2);
      if (i === 0) osc.onended = () => pan.disconnect();
    });
  }

  protected window(from: number, to: number, d: Data): void {
    const { clock, harmony, random } = this.vc;
    // Poisson-like: each half-beat has a small chance of a decay.
    const p = (clock.secondsPerBeat / 2) / (5 + 6 * (1 - harmony.mood.density));
    for (const t of gridTimes(from, to, clock.secondsPerBeat / 2, clock.origin)) {
      if (random() > p) continue;
      const iso = d.isotopes[Math.floor(random() * d.isotopes.length)];
      this.bell(t, iso);
      this.latest = iso;
    }
  }

  readout(): Readout {
    if (!this.data) return { headline: 'Atomic echoes: listening for decays…' };
    const iso = this.latest;
    if (!iso) return { headline: 'Atomic echoes: waiting for the next decay', detail: 'Decays come at random' };
    return {
      headline: `${iso.name}: ${iso.linesKeV.map((e) => `${e} keV`).join(', ')}`,
      detail: `${formatHalfLife(iso.halfLifeYears)} · seen in ${iso.where} by ${iso.mission}`,
    };
  }
}

export const atomicEchoes: VoiceDefinition = {
  id: 'atomic-echoes',
  name: 'Atomic Echoes',
  phenomenon: 'Gamma rays from radioactive atoms forged in exploding stars',
  technique: 'sonification',
  color: '#c9b8e8',
  roles: ['texture', 'melody'],
  live: false,
  credit: {
    mission: 'INTEGRAL (SPI), Compton Gamma Ray Observatory (COMPTEL) and NuSTAR',
    agency: 'ESA / NASA',
    dataset: 'Gamma-ray line detections and NNDC line energies',
    url: 'https://www.nndc.bnl.gov/',
  },
  cards: [
    { title: 'What it is', body: 'Exploding and dying stars make radioactive atoms. As they decay they give off gamma rays at exact energies, each isotope its own fingerprint. Aluminium-26 glows across the whole Milky Way; titanium-44 still shines in the 350-year-old remnant Cassiopeia A.' },
    { title: 'How the sound is made', body: 'A sonification. Each isotope is a bell: its overtones are its real gamma-ray line energies as ratios, folded into one octave above a note of the current chord. Bells ring at random, like decays, but how often is chosen for the music.' },
    { title: 'The mission', body: 'ESA’s INTEGRAL spectrometer and NASA’s COMPTEL instrument mapped these lines across the sky. NASA’s NuSTAR imaged titanium-44 inside Cassiopeia A, and INTEGRAL caught cobalt-56 from the supernova SN 2014J.' },
  ],
  archive: 'atomic-echoes.json',
  parse: parseAtomicEchoes,
  create: (vc, role) => new AtomicEchoesVoice(vc, role),
};
