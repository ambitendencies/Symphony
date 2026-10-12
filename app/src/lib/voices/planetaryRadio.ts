/**
 * Planetary Radio — plasma waves around Earth, Jupiter, Saturn, and beyond
 * the heliopause.
 *
 * Each world is featured for a few minutes, keeping its real character:
 *  - Earth: "dawn chorus", short rising whistles (birdsong-like);
 *  - Jupiter: lightning "whistlers", tones that fall fast then slowly, the
 *    shape of dispersion (Eckersley's law, f ∝ 1/t²);
 *  - Saturn: kilometric radiation, a held tone that swells with the planet's
 *    10.7-hour rotation (compressed to a slow pulse);
 *  - Voyager 1: the steady ~2.6 kHz plasma line of interstellar space.
 * Every glide starts and ends on chord tones, so the shapes are physical
 * while the pitches stay in key ("softened", per the PRD).
 */

import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, gridTimes, list, num, str } from './base';
import { createDrone, midiToFreq, softWave, TIMBRES } from './kit';

export type WorldKind = 'chorus' | 'whistler' | 'kilometric' | 'plasma-line';
export interface World {
  name: string;
  kind: WorldKind;
  mission: string;
  lowHz: number;
  highHz: number;
  rotationHours: number;
  fact: string;
}
interface Data {
  worlds: World[];
}

/** Bars each world is featured for. */
export const WORLD_BARS = 32;
const KINDS: WorldKind[] = ['chorus', 'whistler', 'kilometric', 'plasma-line'];

export function parsePlanetaryRadio(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const worlds = list(doc?.worlds, 'worlds').map((w, i) => {
    const o = w as Record<string, unknown>;
    const kind = str(o.kind, `kind ${i}`) as WorldKind;
    if (!KINDS.includes(kind)) throw new Error(`invalid archive: kind ${kind}`);
    const lowHz = num(o.lowHz, `lowHz ${i}`, 1);
    return {
      name: str(o.name, `name ${i}`),
      kind,
      mission: str(o.mission, `mission ${i}`),
      lowHz,
      highHz: num(o.highHz, `highHz ${i}`, lowHz),
      rotationHours: num(o.rotationHours, `rotation ${i}`, 0),
      fact: str(o.fact, `fact ${i}`),
    };
  });
  return {
    values: { worlds: worlds.length },
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { worlds },
  };
}

/** Normalised whistler curve: frequency falls ∝ 1/(t+t0)², from 1 to 0 over u ∈ [0, 1]. */
export function whistlerShape(u: number): number {
  const t0 = 0.25;
  const f = 1 / (u + t0) ** 2;
  const f0 = 1 / t0 ** 2;
  const f1 = 1 / (1 + t0) ** 2;
  return (f - f1) / (f0 - f1);
}

class PlanetaryRadioVoice extends BaseVoice<Data> {
  private held: ReturnType<typeof createDrone> | null = null;
  private heldKey = '';
  private featuredName = '';

  protected decode(snap: DataSnapshot): Data {
    return { worlds: snap.extra!.worlds as World[] };
  }

  private featured(d: Data, t: number): World {
    const bar = Math.max(0, Math.floor(this.vc.clock.barAt(t) + 1e-6));
    return d.worlds[Math.floor(bar / WORLD_BARS) % d.worlds.length];
  }

  private region(): Role {
    return this.role === 'melody' ? 'melody' : 'texture';
  }

  /** A gliding sine from f0 to f1 with a soft envelope. */
  private glide(start: number, dur: number, f0: number, f1: number, gain: number, shape: 'rise' | 'fall', pan: number): void {
    const { ctx } = this.vc;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(softWave(ctx, TIMBRES.sine));
    const n = 32;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // rise: gentle ease-in like chorus elements; fall: dispersion curve
      const w = shape === 'rise' ? u * u * (3 - 2 * u) : 1 - whistlerShape(u);
      curve[i] = Math.min(ctx.sampleRate * 0.45, f0 * Math.pow(f1 / f0, w));
    }
    osc.frequency.setValueCurveAtTime(curve, start, dur);
    const env = ctx.createGain();
    const attack = Math.max(0.08, dur * 0.25);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.setTargetAtTime(0, start + attack, (dur - attack) / 3);
    env.gain.setValueAtTime(0, start + dur + 0.6);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(env).connect(p).connect(this.output);
    osc.start(start);
    osc.stop(start + dur + 0.7);
    osc.onended = () => p.disconnect();
  }

  protected window(from: number, to: number, d: Data): void {
    const { clock, harmony, random } = this.vc;
    const w = this.featured(d, from);
    this.featuredName = w.name;
    const region = this.region();
    const density = harmony.mood.density;
    const melody = this.role === 'melody';

    // Held tone for Saturn and Voyager; released for the others.
    const wantHeld = w.kind === 'kilometric' || w.kind === 'plasma-line';
    const key = wantHeld ? `${w.name}:${harmony.chordIndexAt(from)}:${this.role}` : '';
    if (key !== this.heldKey) {
      const at = from;
      this.held?.stop(at);
      this.held = null;
      this.heldKey = key;
      if (wantHeld) {
        const tones = harmony.chordTones(region, at);
        const midi = w.kind === 'plasma-line' ? tones[tones.length - 1] : tones[Math.floor(tones.length / 2)];
        this.held = createDrone(this.vc.ctx, midiToFreq(midi), {
          timbre: TIMBRES.sine,
          spread: 10,
          cutoff: 5000,
          level: w.kind === 'plasma-line' ? 0.08 : 0.14,
          start: at,
        });
        this.held.output.connect(this.output);
      }
    }
    // Saturn: swell once per compressed rotation (two bars).
    if (w.kind === 'kilometric' && this.held) {
      for (const t of gridTimes(from, to, 2 * clock.secondsPerBar, clock.origin)) {
        this.held.setLevel(0.2, t, 2);
        this.held.setLevel(0.07, t + clock.secondsPerBar, 2);
      }
    }

    if (w.kind !== 'chorus' && w.kind !== 'whistler') return;
    // Chorus and whistler phrases start on beats, sparsely.
    for (const t of gridTimes(from, to, clock.secondsPerBeat, clock.origin)) {
      const chance = (w.kind === 'chorus' ? 0.32 : 0.14) * density * (melody ? 0.7 : 1);
      if (random() > chance) continue;
      const tones = harmony.chordTones(region, t);
      if (tones.length < 2) continue;
      const i = Math.floor(random() * (tones.length - 1));
      const lo = midiToFreq(tones[i]);
      const hi = midiToFreq(tones[Math.min(tones.length - 1, i + 1 + Math.floor(random() * 2))]);
      const pan = (random() - 0.5) * 1.2;
      if (w.kind === 'chorus') {
        // 2–4 rising elements, like a flock
        const count = 2 + Math.floor(random() * 3);
        for (let k = 0; k < count; k++) {
          this.glide(t + k * 0.32, 0.45 + random() * 0.25, lo, hi, (melody ? 0.18 : 0.13) * (1 - k * 0.15), 'rise', pan);
        }
      } else {
        // fall from the top chord tone of the register down to a lower one
        this.glide(t, 2.2 + random() * 1.2, midiToFreq(tones[tones.length - 1]), lo, melody ? 0.18 : 0.14, 'fall', pan);
      }
    }
  }

  protected onDispose(at: number): void {
    this.held?.stop(at);
    this.held = null;
  }

  readout(): Readout {
    const d = this.data;
    if (!d) return { headline: 'Planetary radio: tuning…' };
    const w = d.worlds.find((x) => x.name === this.featuredName) ?? d.worlds[0];
    const band = w.highHz >= 100000 ? `${w.lowHz / 1000}–${w.highHz / 1000} kHz` : `${(w.lowHz / 1000).toFixed(1)}–${(w.highHz / 1000).toFixed(1)} kHz`;
    return { headline: `${w.name}: ${w.fact.split(':')[0].toLowerCase()} (${band})`, detail: `${w.fact} · ${w.mission}` };
  }
}

export const planetaryRadio: VoiceDefinition = {
  id: 'planetary-radio',
  name: 'Planetary Radio',
  phenomenon: 'Plasma waves singing around Earth, Jupiter, Saturn and in interstellar space',
  technique: 'sonification',
  color: '#7fc4d8',
  roles: ['texture', 'melody'],
  live: false,
  credit: {
    mission: 'Van Allen Probes, Juno, Cassini and Voyager 1',
    agency: 'NASA',
    dataset: 'Published plasma-wave parameters (NASA Planetary Data System)',
    url: 'https://pds-ppi.igpp.ucla.edu/',
  },
  cards: [
    { title: 'What it is', body: 'Planets with magnetic fields are wrapped in thin plasma that rings with radio and plasma waves. Many fall right in the audio range: Earth’s “dawn chorus” sounds like birds, and lightning on Jupiter sends out falling whistles.' },
    { title: 'How the sound is made', body: 'A sonification, softened. The shape of each world’s waves is kept: rising for chorus, the fast-then-slow fall of a whistler, Saturn’s swell with its 10.7-hour spin. Each glide starts and ends on notes of the current chord so it stays in key.' },
    { title: 'The mission', body: 'NASA’s Van Allen Probes listened to Earth’s chorus, Juno to Jupiter’s whistlers, and Cassini to Saturn’s kilometric radiation. Voyager 1 heard the faint plasma tone of interstellar space after crossing the heliopause in 2012.' },
  ],
  archive: 'planetary-radio.json',
  parse: parsePlanetaryRadio,
  create: (vc, role) => new PlanetaryRadioVoice(vc, role),
};
