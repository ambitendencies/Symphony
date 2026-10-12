/**
 * Fast Radio Bursts — millisecond flashes of radio from far galaxies.
 *
 * PRD: "Rare, sparse chimes." Each burst is one soft chime. On their way to
 * us, bursts pass through thin plasma that delays low frequencies (delay ∝
 * DM / f²); radio telescopes see that as a downward sweep. Each chime keeps
 * that signature: it slides down from one chord tone to the next one below,
 * taking longer for a larger dispersion measure (DM, how much plasma was in
 * the way). Bursts are rare and arrive at random, as real ones do.
 */

import type { DataSnapshot, Readout, VoiceDefinition } from '../engine/types';
import { BaseVoice, list, num, str } from './base';
import { midiToFreq, softWave, TIMBRES } from './kit';
import { formatLy } from './music';

export interface Burst {
  name: string;
  dm: number; // pc cm⁻³
  host: string;
  distanceLy: number;
}
interface Data {
  bursts: Burst[];
}

export function parseFastRadioBursts(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const bursts = list(doc?.bursts, 'bursts').map((b, i) => {
    const o = b as Record<string, unknown>;
    return {
      name: str(o.name, `name ${i}`),
      dm: num(o.dm, `dm ${i}`, 1, 5000),
      host: str(o.host, `host ${i}`),
      distanceLy: num(o.distanceLy, `distance ${i}`, 1),
    };
  });
  return {
    values: { bursts: bursts.length },
    series: bursts.map((b) => b.dm),
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { bursts },
  };
}

/** Sweep length of a chime (s) from DM: 0.25 s for nearby, up to ~2 s for the most dispersed. */
export function sweepSeconds(dm: number): number {
  return 0.25 + 1.75 * Math.min(1, Math.log10(1 + dm) / Math.log10(1 + 1500));
}

class FastRadioBurstsVoice extends BaseVoice<Data> {
  private latest: Burst | null = null;
  private count = 0;
  /** Audio time of the next burst; bursts arrive at random, like the real ones. */
  private next: number | null = null;

  protected decode(snap: DataSnapshot): Data {
    return { bursts: snap.extra!.bursts as Burst[] };
  }

  protected window(from: number, to: number, d: Data): void {
    const { ctx, clock, harmony, random } = this.vc;
    // Mean gap ~25–45 s (exponential waiting times); the first comes within seconds of entering.
    const mean = 25 + 20 * (1 - harmony.mood.density);
    if (this.next === null) this.next = from + 3 + random() * 6;
    while (this.next < to) {
      const t = clock.nextBeat(this.next);
      if (t >= to) {
        this.next = t; // lands on a beat in the next window: keep it, don't drop it
        break;
      }
      this.next = t + Math.max(4, -Math.log(1 - random()) * mean);
      if (t < from) continue;
      const b = d.bursts[Math.floor(random() * d.bursts.length)];
      const tones = harmony.chordTones(this.role === 'melody' ? 'melody' : 'texture', t);
      if (tones.length < 2) continue;
      const i = 1 + Math.floor(random() * (tones.length - 1));
      const f0 = midiToFreq(tones[i]);
      const f1 = midiToFreq(tones[i - 1]);
      const sweep = sweepSeconds(b.dm);
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(softWave(ctx, TIMBRES.glass));
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.setTargetAtTime(f1, t + 0.05, sweep / 3);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(this.role === 'melody' ? 0.14 : 0.1, t + 0.06);
      env.gain.setTargetAtTime(0, t + 0.06, 0.5 + sweep / 2);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (random() - 0.5) * 1.4;
      osc.connect(env).connect(pan).connect(this.output);
      osc.start(t);
      osc.stop(t + 4 + sweep);
      osc.onended = () => pan.disconnect();
      this.latest = b;
      this.count++;
      // Caption the first burst from each source.
      if (this.count <= d.bursts.length && random() < 0.5) {
        this.vc.caption(`A flash of radio from ${b.host}, ${formatLy(b.distanceLy)} away`, t);
      }
    }
  }

  readout(): Readout {
    const b = this.latest;
    if (!this.data) return { headline: 'Fast radio bursts: listening…' };
    if (!b) return { headline: 'Fast radio bursts: waiting for the next flash', detail: 'They are rare, and arrive at random' };
    return {
      headline: `${b.name}: DM ${b.dm} pc/cm³, ${formatLy(b.distanceLy)} away`,
      detail: `From ${b.host}. The slide down is the delay plasma adds to lower radio frequencies.`,
      series: this.data.bursts.map((x) => x.dm),
    };
  }
}

export const fastRadioBursts: VoiceDefinition = {
  id: 'fast-radio-bursts',
  name: 'Fast Radio Bursts',
  phenomenon: 'Millisecond flashes of radio from distant galaxies',
  technique: 'sonification',
  color: '#b9c8f0',
  roles: ['texture', 'melody'],
  live: false,
  credit: {
    mission: 'CHIME/FRB, ASKAP and the European VLBI Network',
    agency: 'CHIME/FRB Collaboration (Canada)',
    dataset: 'CHIME/FRB catalogue and published localisations',
    url: 'https://www.chime-frb.ca/catalog',
  },
  cards: [
    { title: 'What it is', body: 'Fast radio bursts last a thousandth of a second yet can outshine whole galaxies in radio. Most come from billions of light-years away. In 2020 one was caught from a magnetar inside our own Milky Way, a strong clue to what makes them.' },
    { title: 'How the sound is made', body: 'A sonification. Each burst is a single soft chime that slides down to the next note of the chord. The slide is the burst’s real signature: plasma along the way delays low radio frequencies, more for bursts that crossed more of it.' },
    { title: 'The mission', body: 'The CHIME radio telescope in British Columbia has no moving parts; it watches the whole northern sky every day and has found thousands of bursts. Other arrays, such as ASKAP and the European VLBI Network, pin down the galaxies they come from.' },
  ],
  archive: 'fast-radio-bursts.json',
  parse: parseFastRadioBursts,
  create: (vc, role) => new FastRadioBurstsVoice(vc, role),
};
