/**
 * Solar Flares — X-ray bursts from the Sun, as seen by GOES.
 *
 * PRD: "Flux swells into shimmering pads." The archive holds real flares
 * (class, start, peak and end times from NOAA's event reports). Their 1–8 Å
 * light curves are modelled from those times: a smooth rise to the published
 * peak flux, then an exponential decay whose half-life matches NOAA's end
 * time (defined as the flux falling halfway back to background). One real
 * minute plays as three seconds.
 *
 * Mapping: log X-ray flux (10⁻⁷ … 10⁻³ W/m²) → level and brightness of a
 * high shimmer of chord tones plus filtered air. A flare is a swell, never a
 * jump: the flux itself rises over minutes and every change is eased.
 */

import { pick } from '../engine/theory';
import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, gridTimes, list, num, str } from './base';
import { createDrone, midiToFreq, noiseBuffer, TIMBRES } from './kit';

export interface Flare {
  name: string;
  date: string;
  start: number; // minutes after midnight UT
  peak: number;
  end: number;
  peakFlux: number; // W/m²
  region: string;
}
interface Data {
  flares: Flare[];
  background: number;
}

/** Audio seconds per real minute. */
export const SECONDS_PER_MINUTE = 3;
/** Quiet Sun between flares, in real minutes. */
const QUIET_MINUTES = 14;

const hm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid archive: time ${s}`);
  return +m[1] * 60 + +m[2];
};

export function parseSolarFlares(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const flares = list(doc?.flares, 'flares').map((f, i) => {
    const o = f as Record<string, unknown>;
    const start = hm(str(o.start, `start ${i}`));
    const peak = hm(str(o.peak, `peak ${i}`));
    const end = hm(str(o.end, `end ${i}`));
    if (!(start < peak && peak < end)) throw new Error(`invalid archive: flare ${i} times out of order`);
    return {
      name: str(o.name, `name ${i}`),
      date: str(o.date, `date ${i}`),
      start,
      peak,
      end,
      peakFlux: num(o.peakFlux, `peakFlux ${i}`, 1e-7, 1e-2),
      region: str(o.region, `region ${i}`),
    };
  });
  return {
    values: { flares: flares.length },
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { flares, background: num(doc.backgroundFlux, 'background', 1e-9, 1e-4) },
  };
}

/** Modelled GOES 1–8 Å flux of one flare at `m` minutes after its start. */
export function flareFlux(f: Flare, m: number, background: number): number {
  const rise = f.peak - f.start;
  const halfLife = f.end - f.peak; // NOAA end ≈ halfway back to background
  if (m <= 0) return background;
  if (m <= rise) {
    const u = m / rise;
    return background + (f.peakFlux - background) * (u * u * (3 - 2 * u));
  }
  return background + (f.peakFlux - background) * Math.pow(0.5, (m - rise) / halfLife);
}

/** 0..1 loudness from flux on a log scale (B-class quiet → X10). */
export function fluxLevel(flux: number): number {
  return Math.min(1, Math.max(0, (Math.log10(flux) + 7) / 4));
}

/** Which flare is playing and how far into it, for `audioSeconds` since the clock origin. */
export function flareAt(d: Data, audioSeconds: number): { flare: Flare; minute: number } {
  const lengths = d.flares.map((f) => f.end - f.start + 3 * (f.end - f.peak) + QUIET_MINUTES);
  const total = lengths.reduce((a, b) => a + b, 0);
  let m = (Math.max(0, audioSeconds) / SECONDS_PER_MINUTE) % total;
  for (let i = 0; i < d.flares.length; i++) {
    if (m < lengths[i]) return { flare: d.flares[i], minute: m - QUIET_MINUTES / 2 };
    m -= lengths[i];
  }
  return { flare: d.flares[0], minute: 0 };
}

class SolarFlaresVoice extends BaseVoice<Data> {
  private tones: ReturnType<typeof createDrone>[] = [];
  private air: AudioBufferSourceNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private airGain: GainNode | null = null;
  private chord = -1;
  private now = { flux: 0, name: '', minute: 0, series: [] as number[] };

  private region(): Role {
    return this.role === 'harmony' ? 'harmony' : 'texture';
  }

  protected decode(snap: DataSnapshot): Data {
    return { flares: snap.extra!.flares as Flare[], background: snap.extra!.background as number };
  }

  private build(at: number): void {
    const { ctx, harmony } = this.vc;
    const region = this.region();
    const tones = harmony.chordTones(region, at);
    const picks = region === 'texture' ? [pick(tones, 0.2), pick(tones, 0.6), pick(tones, 0.95)] : [pick(tones, 0.1), pick(tones, 0.5)];
    this.tones = picks.map((m, i) =>
      createDrone(ctx, midiToFreq(m), { timbre: region === 'texture' ? TIMBRES.sine : TIMBRES.hollow, spread: 14 + i * 4, cutoff: 3000, level: 0.03, start: at }),
    );
    for (const t of this.tones) t.output.connect(this.output);
    this.air = ctx.createBufferSource();
    this.air.buffer = noiseBuffer(ctx, 5, 23, 'pink');
    this.air.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass';
    this.airFilter.frequency.value = 3000;
    this.airFilter.Q.value = 1.1;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    this.air.connect(this.airFilter).connect(this.airGain).connect(this.output);
    this.air.start(at);
    this.chord = harmony.chordIndexAt(at);
  }

  private teardown(at: number): void {
    for (const t of this.tones) t.stop(at);
    this.tones = [];
    this.airGain?.gain.setTargetAtTime(0, at, 0.5);
    this.air?.stop(at + 3);
    this.air = null;
  }

  protected onRole(_r: Role, at: number): void {
    this.teardown(at);
    this.build(at);
  }

  protected window(from: number, to: number, d: Data): void {
    const { clock, harmony } = this.vc;
    if (!this.tones.length) this.build(from);
    // Re-voice on chord changes (glide, never jump).
    const ci = harmony.chordIndexAt(to);
    if (ci !== this.chord) {
      this.chord = ci;
      const tones = harmony.chordTones(this.region(), to);
      const ps = this.tones.length === 3 ? [0.2, 0.6, 0.95] : [0.1, 0.5];
      this.tones.forEach((t, i) => t.setFreq(midiToFreq(pick(tones, ps[i])), Math.max(from, clock.nextBar(from)), 5));
    }
    const bright = harmony.mood.brightness;
    const texture = this.region() === 'texture';
    for (const t of gridTimes(from, to, 0.5, clock.origin)) {
      const { flare, minute } = flareAt(d, t - clock.origin);
      const flux = flareFlux(flare, minute, d.background);
      const u = fluxLevel(flux);
      this.tones.forEach((tone, i) => {
        tone.setLevel((texture ? 0.02 : 0.05) + (texture ? 0.07 : 0.11) * u * (1 - i * 0.2), t, 4);
        tone.setCutoff((1500 + 5000 * u) * (0.6 + 0.6 * bright), t, 4);
      });
      this.airGain?.gain.setTargetAtTime((texture ? 0.004 : 0.008) + 0.03 * u * u, t, 1.5);
      this.airFilter?.frequency.setTargetAtTime(1800 + 4500 * u, t, 1.5);
      if (t <= this.vc.ctx.currentTime + 1 || this.now.name === '') {
        this.now = { flux, name: `${flare.name} flare, ${flare.date}`, minute, series: [...this.now.series.slice(-59), Math.log10(flux)] };
      }
    }
  }

  protected onDispose(at: number): void {
    this.teardown(at);
  }

  readout(): Readout {
    if (!this.data) return { headline: 'Solar flares: watching the Sun…' };
    const { flux, name, minute } = this.now;
    const exp = Math.floor(Math.log10(flux));
    const mant = (flux / 10 ** exp).toFixed(1);
    const phase = minute < 0 ? 'quiet Sun before the flare' : fluxLevel(flux) > 0.8 ? 'near peak' : 'fading';
    return {
      headline: `${name}: X-rays ${mant}×10${superscript(exp)} W/m²`,
      detail: `${phase} · GOES 1–8 Å · one real minute plays as ${SECONDS_PER_MINUTE} seconds`,
      series: this.now.series,
    };
  }
}

function superscript(n: number): string {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return (n < 0 ? '⁻' : '') + String(Math.abs(n)).split('').map((c) => sup[+c]).join('');
}

export const solarFlares: VoiceDefinition = {
  id: 'solar-flares',
  name: 'Solar Flares',
  phenomenon: 'Bursts of X-rays from magnetic explosions on the Sun',
  technique: 'sonification',
  color: '#f0b46a',
  roles: ['texture', 'harmony'],
  live: false,
  credit: {
    mission: 'GOES-16 and GOES-18 X-Ray Sensor',
    agency: 'NOAA Space Weather Prediction Center',
    dataset: 'GOES X-ray flux and solar event reports',
    url: 'https://www.swpc.noaa.gov/products/goes-x-ray-flux',
  },
  cards: [
    { title: 'What it is', body: 'A solar flare is a sudden release of magnetic energy above a sunspot. In minutes the Sun’s X-ray output can jump ten-thousand-fold; the biggest are “X-class”. The X9.0 flare of 3 October 2024 was the strongest of the current solar cycle so far.' },
    { title: 'How the sound is made', body: 'A sonification. X-ray brightness, on a logarithmic scale, sets how loud and bright a high shimmer is. Each flare’s curve is modelled from NOAA’s published start, peak and end times, and one real minute plays as three seconds, so a flare is a slow swell.' },
    { title: 'The mission', body: 'NOAA’s GOES weather satellites watch the whole Sun’s X-rays every second from geostationary orbit. Their flare alerts warn airlines, radio operators and power grids. Live GOES data can feed this voice once the data worker supports it.' },
  ],
  archive: 'solar-flares.json',
  parse: parseSolarFlares,
  create: (vc, role) => new SolarFlaresVoice(vc, role),
};
