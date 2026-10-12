/**
 * Resonant Worlds — the seven planets of TRAPPIST-1.
 *
 * The planets sit in a near-resonant chain: neighbouring orbital periods are
 * close to 8:5, 5:3, 3:2, 3:2, 4:3 and 3:2. Each planet plays a soft mallet
 * note every time it completes an orbit. Time is compressed by one factor for
 * all seven (planet b's 1.51-day orbit becomes two beats), so the rhythm
 * between them is exactly the real one — a slowly phasing polyrhythm.
 *
 * Pitch: inner (faster) planets are higher; each planet is given a chord
 * tone of the current chord, so the polyrhythm is always consonant.
 */

import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, list, num, str } from './base';
import { midiToFreq, playNote, TIMBRES } from './kit';

export interface Planet {
  name: string;
  periodDays: number;
}
interface Data {
  planets: Planet[];
  distanceLy: number;
}

/** Simplest small-integer ratio within 2% of x (for the readout). */
export function nearResonance(x: number): string {
  for (let q = 1; q <= 6; q++) {
    for (let p = q; p <= 10; p++) if (Math.abs(p / q - x) / x < 0.02) return `${p}:${q}`;
  }
  return x.toFixed(2);
}

export function parseResonantWorlds(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const planets = list(doc?.planets, 'planets', 2).map((p, i) => {
    const o = p as Record<string, unknown>;
    return { name: str(o.name, `planet ${i}`), periodDays: num(o.periodDays, `period ${i}`, 0.1, 1e5) };
  });
  return {
    values: { planets: planets.length, innerPeriod: planets[0].periodDays },
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { planets, distanceLy: num(doc.distanceLy, 'distance', 0) },
  };
}

class ResonantWorldsVoice extends BaseVoice<Data> {
  private lastNote = new Map<string, number>();

  protected decode(snap: DataSnapshot): Data {
    return { planets: snap.extra!.planets as Planet[], distanceLy: snap.extra!.distanceLy as number };
  }

  /** Audio seconds per real day: planet b's orbit lasts two beats. */
  private secondsPerDay(d: Data): number {
    return (2 * this.vc.clock.secondsPerBeat) / d.planets[0].periodDays;
  }

  protected window(from: number, to: number, d: Data): void {
    const { ctx, clock, harmony } = this.vc;
    const melody = this.role === 'melody';
    const region: Role = melody ? 'melody' : 'pulse';
    const spd = this.secondsPerDay(d);
    // As a melody, only the outer, slower worlds speak, so it stays sparse.
    const voices = melody ? d.planets.slice(3) : d.planets;
    voices.forEach((p, idx) => {
      const step = p.periodDays * spd;
      const k0 = Math.ceil((from - clock.origin - 1e-9) / step);
      for (let k = k0; ; k++) {
        const t = clock.origin + k * step;
        if (t >= to) break;
        if (t < from) continue;
        // Density: drop some strikes in sparse moods, deterministically per orbit.
        if (((k * 7 + idx * 13) % 10) / 10 >= 0.35 + 0.65 * harmony.mood.density) continue;
        const tones = harmony.chordTones(region, t);
        if (!tones.length) continue;
        // Inner planets high, outer low.
        const rank = d.planets.indexOf(p) / Math.max(1, d.planets.length - 1);
        const midi = tones[Math.round((1 - rank) * (tones.length - 1))];
        playNote(ctx, this.output, {
          freq: midiToFreq(midi),
          start: t,
          attack: 0.06,
          release: melody ? 2.6 : 1.4 + rank * 1.6,
          gain: (melody ? 0.2 : 0.15) * (0.75 + 0.5 * rank),
          timbre: TIMBRES.glass,
          cutoff: 2600 + 2400 * harmony.mood.brightness,
          pan: (rank - 0.5) * 1.2,
          kind: 'chime',
        });
        this.lastNote.set(p.name, t);
      }
    });
  }

  readout(): Readout {
    const d = this.data;
    if (!d) return { headline: 'TRAPPIST-1: waiting for orbits…' };
    const now = this.vc.ctx.currentTime;
    let latest: Planet = d.planets[0];
    let lt = -1;
    for (const p of d.planets) {
      const t = this.lastNote.get(p.name) ?? -1;
      if (t <= now && t > lt) [latest, lt] = [p, t];
    }
    const i = d.planets.indexOf(latest);
    const next = d.planets[i + 1];
    const ratio = next ? ` · ${nearResonance(next.periodDays / latest.periodDays)} with ${next.name}` : '';
    return {
      headline: `TRAPPIST-1 ${latest.name}: one orbit every ${latest.periodDays.toFixed(2)} days${ratio}`,
      detail: `Seven Earth-sized worlds, ${d.distanceLy} light-years away, in a resonant chain`,
      series: d.planets.map((p) => p.periodDays),
    };
  }
}

export const resonantWorlds: VoiceDefinition = {
  id: 'resonant-worlds',
  name: 'Resonant Worlds',
  phenomenon: 'Seven planets of TRAPPIST-1, locked in orbital resonance',
  technique: 'sonification',
  color: '#8fd4a8',
  roles: ['pulse', 'melody'],
  live: false,
  credit: {
    mission: 'Spitzer and ground-based transit timing',
    agency: 'NASA / ESO',
    dataset: 'TRAPPIST-1 orbital periods (Agol et al. 2021)',
    url: 'https://iopscience.iop.org/article/10.3847/PSJ/abd022',
  },
  cards: [
    { title: 'What it is', body: 'TRAPPIST-1 is a small, cool star 40.7 light-years away with seven Earth-sized planets. Their orbits are linked: while the innermost circles eight times, the next circles five, and so on down the chain.' },
    { title: 'How the sound is made', body: 'A sonification. Each planet plays a note when it completes an orbit. Time is sped up by the same factor for all seven, so the rhythm between them is exactly the real one. The notes come from the current chord, inner planets higher.' },
    { title: 'The mission', body: 'The planets were found by timing tiny dips in starlight as each crossed its star, mostly with NASA’s Spitzer Space Telescope. Small shifts in those timings, caused by the planets tugging each other, pinned down their periods to seconds.' },
  ],
  archive: 'resonant-worlds.json',
  parse: parseResonantWorlds,
  create: (vc, role) => new ResonantWorldsVoice(vc, role),
};
