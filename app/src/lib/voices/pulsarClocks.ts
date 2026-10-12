/**
 * Pulsar Clocks — spinning neutron stars keep time.
 *
 * PRD: "Real spin rates become soft pulses and bell rhythms, locked to the
 * master tempo." One pulsar is featured at a time (rotating every 48 bars,
 * ~3 minutes).
 *
 * Tempo lock (honest version, see `tempoLock`): the spin rate is halved (or
 * doubled) by whole octaves until it is near the chosen beat subdivision —
 * halving keeps the rhythm's identity, it is every other tick of the same
 * train — then eased by at most ±half an octave onto the subdivision so it
 * lines up with the music. Faster pulsars get denser subdivisions.
 *
 * Pitch: the spin frequency moved by whole octaves into the role's register
 * (keeping its pitch class), then moved to the nearest note of the current
 * chord. Dispersion measure (how much interstellar plasma the pulses crossed)
 * softens and blurs the bell; distance lowers its level a little.
 *
 * Roles:
 *  - pulse:   a soft "beam" tone whose loudness sweeps at the locked rate
 *             (like a lighthouse beam passing), plus glassy mallet notes on
 *             the locked grid, thinned by the mood's density.
 *  - texture: the same idea, high and very quiet.
 *  - melody:  short bell phrases on the locked grid that start on the
 *             pulsar's own pitch and wander by scale steps, with rests.
 */

import { nearest, freqToMidi } from '../engine/theory';
import type { DataSnapshot, Readout, Role, VoiceContext, VoiceDefinition, VoiceInstance } from '../engine/types';
import { createDrone, midiToFreq, playNote, TIMBRES } from './kit';
import { foldIntoRange, formatLy, isFiniteIn, LY_PER_KPC } from './music';

export interface Pulsar {
  name: string;
  bname: string;
  jname: string;
  /** Spin period (s). */
  p0: number;
  /** Period derivative (s/s). */
  p1: number;
  /** Dispersion measure (pc cm⁻³). */
  dm: number;
  distKpc: number;
  ra: number;
  dec: number;
  note: string;
}

/** Bars each pulsar is featured for (≈ 3 minutes at 60–66 BPM). */
export const ROTATE_BARS = 48;

export interface TempoLock {
  /** True spin frequency (Hz). */
  spinHz: number;
  /** Notes per beat on the locked grid: 0.5 (half notes), 1 (quarters) or 2 (eighths). */
  perBeat: number;
  /** Whole octaves the spin rate was divided by (2^octaves); negative = multiplied. */
  octaves: number;
  /** spinHz / 2^octaves — the rate after octave shifting, before easing. */
  shiftedHz: number;
  /** The locked pulse rate (Hz) = beat rate × perBeat. */
  rateHz: number;
  /** rateHz / shiftedHz — the musical easing, always within [0.707, 1.414]. */
  nudge: number;
}

/**
 * Lock a pulsar's spin to the master tempo by octave shifts (×2ⁿ, which keep
 * the pulse train's identity) and the nearest power-of-two subdivision.
 * Spin speed picks the subdivision: every ~3 octaves faster than the beat
 * doubles the density (slow pulsars → half notes, Vela → quarters,
 * Crab and the millisecond pulsars → eighths), capped for calm.
 */
export function tempoLock(periodS: number, bpm: number): TempoLock {
  const spinHz = 1 / periodS;
  const beatHz = bpm / 60;
  const tier = Math.min(2, Math.max(0, Math.round(Math.log2(spinHz / beatHz) / 3)));
  const perBeat = 2 ** (tier - 1);
  const rateHz = beatHz * perBeat;
  const octaves = Math.round(Math.log2(spinHz / rateHz));
  const shiftedHz = spinHz / 2 ** octaves;
  return { spinHz, perBeat, octaves, shiftedHz, rateHz, nudge: rateHz / shiftedHz };
}

/** The pulsar's own pitch: spin frequency moved by whole octaves into [low, high] (MIDI, unsnapped). */
export function spinPitch(periodS: number, low: number, high: number): number {
  return foldIntoRange(freqToMidi(1 / periodS), low, high);
}

/** Characteristic (spin-down) age in years: P / (2 Ṗ). */
export function characteristicAge(p0: number, p1: number): number {
  return p0 / (2 * p1) / 3.15576e7;
}

export function describeSpin(p0: number): string {
  const f = 1 / p0;
  if (f < 1) return `turns once every ${p0.toFixed(2)} seconds`;
  return `spins ${f < 20 ? f.toFixed(1) : Math.round(f)} times a second`;
}

function describeAge(years: number): string {
  if (years < 1e4) return `${Math.round(years / 10) * 10} years`;
  if (years < 1e6) return `${Math.round(years / 1e3)} thousand years`;
  if (years < 1e9) return `${Math.round(years / 1e6)} million years`;
  return `${(years / 1e9).toFixed(1)} billion years`;
}

const SUBDIVISION: Record<number, string> = { 0.5: 'half-note', 1: 'quarter-note', 2: 'eighth-note' };

export function parsePulsars(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as { pulsars?: unknown[]; source?: string; updated?: string };
  if (!doc || !Array.isArray(doc.pulsars) || doc.pulsars.length === 0) throw new Error('pulsars: no pulsar list');
  const pulsars: Pulsar[] = [];
  for (const r of doc.pulsars as Array<Record<string, unknown>>) {
    if (!r || typeof r.name !== 'string') continue;
    if (!isFiniteIn(r.p0, 0.0009, 20) || !isFiniteIn(r.p1, 0, 1e-9) || !isFiniteIn(r.dm, 0, 3000) || !isFiniteIn(r.dist_kpc, 0, 50))
      continue;
    pulsars.push({
      name: r.name,
      bname: typeof r.bname === 'string' ? r.bname : '',
      jname: typeof r.jname === 'string' ? r.jname : '',
      p0: r.p0,
      p1: r.p1,
      dm: r.dm,
      distKpc: r.dist_kpc,
      ra: typeof r.ra_deg === 'number' && Number.isFinite(r.ra_deg) ? r.ra_deg : 0,
      dec: typeof r.dec_deg === 'number' && Number.isFinite(r.dec_deg) ? r.dec_deg : 0,
      note: typeof r.note === 'string' ? r.note : '',
    });
  }
  if (!pulsars.length) throw new Error('pulsars: no valid pulsars');
  const time = typeof doc.updated === 'string' && Number.isFinite(Date.parse(doc.updated)) ? doc.updated : new Date(0).toISOString();
  return {
    values: { count: pulsars.length, period: pulsars[0].p0, dm: pulsars[0].dm, distance: pulsars[0].distKpc },
    series: pulsars.map((p) => Math.log10(1 / p.p0)),
    time,
    source: 'ATNF Pulsar Catalogue',
    fallback,
    extra: { pulsars },
  };
}

class PulsarVoice implements VoiceInstance {
  readonly output: GainNode;
  role: Role;
  private pulsars: Pulsar[] = [];
  private hum: ReturnType<typeof createDrone> | null = null;
  private beam: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode | null = null;
  private humKey = '';
  /** Next grid time to consider (audio seconds). */
  private nextTick: number | null = null;
  /** Melody phrase state. */
  private phraseLeft = 0;
  private restUntil = 0;
  private melodyPitch: number | null = null;
  private lastTo = 0;
  private origin: number;

  constructor(private vc: VoiceContext, role: Role) {
    this.role = role;
    this.output = vc.ctx.createGain();
    this.origin = vc.clock.origin;
    this.build(role, Math.max(vc.ctx.currentTime, vc.clock.origin));
  }

  /** Featured pulsar at audio time t (rotates every ROTATE_BARS, starting with the first in the archive). */
  featured(t: number): Pulsar | null {
    if (!this.pulsars.length) return null;
    const bar = Math.max(0, Math.floor(this.vc.clock.barAt(t) + 1e-6));
    return this.pulsars[Math.floor(bar / ROTATE_BARS) % this.pulsars.length];
  }

  private regionFor(role: Role): Role {
    return role === 'melody' ? 'melody' : role === 'texture' ? 'texture' : 'pulse';
  }

  /** The pulsar's pitch snapped to the nearest chord tone of the role's register at t. */
  private pitchAt(p: Pulsar, role: Role, t: number): number {
    const { harmony } = this.vc;
    const reg = harmony.register(role);
    const raw = spinPitch(p.p0, reg.low, reg.high);
    return nearest(harmony.chordTones(role, t), raw);
  }

  private build(role: Role, at: number): void {
    const { ctx } = this.vc;
    if (role === 'melody') return; // melody is bells only
    // The "beam": a soft tone whose loudness rises and falls once per locked pulse,
    // like a lighthouse beam sweeping past. A cosine LFO, phase-locked to the beat grid.
    const texture = role === 'texture';
    this.beam = ctx.createGain();
    this.beam.gain.value = 0.6;
    this.lfo = ctx.createOscillator();
    this.lfo.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.4;
    this.lfo.connect(this.lfoDepth).connect(this.beam.gain);
    // Start on a bar line: every allowed rate completes whole cycles per bar, so the sweep stays on the beat.
    const start = this.vc.clock.nextBar(at);
    const p = this.featured(start);
    const lock = p ? tempoLock(p.p0, this.vc.clock.bpm) : null;
    this.lfo.frequency.value = lock ? lock.rateHz : this.vc.clock.bpm / 60;
    this.lfo.start(start);
    const midi = p ? this.pitchAt(p, this.regionFor(role), start) : this.vc.harmony.root(this.regionFor(role));
    this.hum = createDrone(ctx, midiToFreq(texture ? midi : midi - 12), {
      timbre: texture ? TIMBRES.sine : TIMBRES.hollow,
      spread: texture ? 8 : 4,
      cutoff: texture ? 4000 : 900,
      level: texture ? 0.05 : 0.32,
      start: at,
    });
    this.hum.output.connect(this.beam).connect(this.output);
    this.humKey = '';
  }

  private teardown(at: number): void {
    this.hum?.stop(at);
    this.lfo?.stop(at + 3.5);
    this.hum = null;
    this.lfo = null;
    this.beam = null;
  }

  setRole(role: Role, at: number): void {
    if (role === this.role) return;
    this.teardown(at);
    this.role = role;
    this.nextTick = null;
    this.melodyPitch = null;
    this.build(role, at);
  }

  setData(data: DataSnapshot): void {
    const list = (data.extra?.pulsars as Pulsar[] | undefined) ?? [];
    if (list.length) this.pulsars = list;
  }

  /** Keep the beam tone on the featured pulsar's chord-snapped pitch and rate. */
  private updateHum(t: number, p: Pulsar): void {
    if (!this.hum || !this.lfo) return;
    const { harmony } = this.vc;
    const key = `${p.jname}|${harmony.chordIndexAt(t)}`;
    if (key === this.humKey) return;
    this.humKey = key;
    const texture = this.role === 'texture';
    const midi = this.pitchAt(p, this.regionFor(this.role), t);
    this.hum.setFreq(midiToFreq(texture ? midi : midi - 12), t, 2.5);
    // Rate changes only at bar lines, where every allowed rate is in phase.
    const bar = this.vc.clock.nextBar(t - 1e-6);
    this.lfo.frequency.setValueAtTime(tempoLock(p.p0, this.vc.clock.bpm).rateHz, bar);
    // Plasma along the line of sight (DM) darkens the tone; nearer pulsars are a touch louder.
    const dmDark = Math.min(1, Math.log10(1 + p.dm) / 2.2);
    this.hum.setCutoff((texture ? 5000 : 1300) * (1 - 0.45 * dmDark) * (0.6 + 0.6 * harmony.mood.brightness), t, 4);
  }

  schedule(from: number, to: number): void {
    this.lastTo = to;
    const { clock } = this.vc;
    if (this.nextTick === null) this.nextTick = clock.nextBeat(from);
    while (this.nextTick !== null && this.nextTick < to) {
      const t: number = this.nextTick;
      const p = this.featured(t);
      if (!p) {
        this.nextTick = t + clock.secondsPerBeat;
        continue;
      }
      const lock = tempoLock(p.p0, clock.bpm);
      const perBeat = this.role === 'melody' ? Math.min(1, lock.perBeat) : lock.perBeat;
      const step = clock.secondsPerBeat / perBeat;
      if (t >= from - 1e-6) {
        this.updateHum(t, p);
        this.tick(t, p, perBeat, step);
      }
      // Step on the grid; a slower grid restarts on the next bar line so it stays aligned.
      const next = t + step;
      const barEnd = clock.nextBar(t + 1e-6);
      this.nextTick = next > barEnd + 1e-6 ? barEnd : next;
    }
  }

  private tick(t: number, p: Pulsar, perBeat: number, step: number): void {
    const { clock, harmony, random, ctx } = this.vc;
    const density = harmony.mood.density;
    const slots = clock.beatsPerBar * perBeat;
    const frac = (((clock.barAt(t) % 1) + 1) % 1) * slots;
    const beatInBar = (Math.round(frac) % slots) / perBeat;
    const downbeat = beatInBar < 1e-6;
    const onBeat = Math.abs(beatInBar - Math.round(beatInBar)) < 1e-6;
    const dmBlur = Math.min(1, Math.log10(1 + p.dm) / 2.2); // 0 (nearby, clean) … 1 (DM ~150)
    const near = 1 - 0.3 * Math.min(1, Math.max(0, Math.log10(p.distKpc / 0.1) / 1.6));
    const pan = Math.max(-0.6, Math.min(0.6, (p.ra / 180 - 1) * 0.6));
    const bright = harmony.mood.brightness;

    if (this.role === 'melody') {
      this.melodyTick(t, p, step, downbeat, pan, dmBlur);
      return;
    }
    const texture = this.role === 'texture';
    // Sparse: downbeats usually sound, other grid points less often, all scaled by mood density.
    const chance = downbeat ? 0.55 + 0.4 * density : onBeat ? 0.2 + 0.45 * density : 0.1 + 0.35 * density;
    if (random() > chance * (texture ? 0.6 : 1)) return;
    const reg = texture ? 'texture' : 'pulse';
    let midi = this.pitchAt(p, reg, t);
    // An occasional neighbouring chord tone above keeps long stretches from droning.
    if (!downbeat && random() < 0.25) {
      const tones = harmony.chordTones(reg, t);
      const i = tones.indexOf(midi);
      if (i >= 0 && i + 1 < tones.length) midi = tones[i + 1];
    }
    const vel = (downbeat ? 1 : onBeat ? 0.8 : 0.6) * (0.85 + 0.15 * random());
    playNote(ctx, this.output, {
      freq: midiToFreq(midi),
      start: t,
      kind: 'chime',
      attack: 0.05 + 0.04 * dmBlur,
      hold: 0,
      release: Math.min(2.6, (texture ? 2.2 : 1.3) + 1.0 * dmBlur),
      gain: (texture ? 0.05 : 0.24) * vel * near,
      timbre: TIMBRES.glass,
      cutoff: (texture ? 5000 : 2600) * (1 - 0.5 * dmBlur) * (0.6 + 0.6 * bright),
      pan,
    });
  }

  private melodyTick(t: number, p: Pulsar, step: number, downbeat: boolean, pan: number, dmBlur: number): void {
    const { harmony, random, ctx } = this.vc;
    const density = harmony.mood.density;
    if (t < this.restUntil - 1e-6) return;
    if (this.phraseLeft <= 0) {
      if (!downbeat) return;
      // A phrase of 3–6 notes, starting on the pulsar's own (chord-snapped) pitch.
      this.phraseLeft = 3 + Math.floor(random() * (2 + 2 * density));
      this.melodyPitch = this.pitchAt(p, 'melody', t);
    }
    // Rests inside phrases, too.
    if (!downbeat && random() > 0.45 + 0.4 * density) return;
    const scale = harmony.scaleTones('melody');
    let midi = this.melodyPitch ?? this.pitchAt(p, 'melody', t);
    this.phraseLeft--;
    const last = this.phraseLeft <= 0;
    if (last || downbeat) midi = nearest(harmony.chordTones('melody', t), midi);
    playNote(ctx, this.output, {
      freq: midiToFreq(midi),
      start: t,
      kind: 'chime',
      attack: 0.06 + 0.04 * dmBlur,
      hold: step * 0.2,
      release: last ? 3 : 1.8,
      gain: 0.28 * (downbeat ? 1 : 0.85),
      timbre: random() < 0.5 ? TIMBRES.glass : TIMBRES.hollow,
      cutoff: 3000 * (1 - 0.4 * dmBlur),
      pan: pan * 0.6,
    });
    // Wander by one or two scale steps for the next note.
    const i = scale.indexOf(nearest(scale, midi));
    const move = (random() < 0.5 ? -1 : 1) * (random() < 0.7 ? 1 : 2);
    this.melodyPitch = scale[Math.max(0, Math.min(scale.length - 1, i + move))];
    if (last) {
      const restBars = 1 + Math.floor(random() * (3 - 2 * density) + 1);
      this.restUntil = this.vc.clock.nextBar(t + 1e-6) + (restBars - 1) * this.vc.clock.secondsPerBar;
    }
  }

  readout(): Readout {
    const t = Math.max(this.lastTo, this.origin);
    const p = this.featured(t);
    if (!p) return { headline: 'Pulsar Clocks: waiting for the catalogue…' };
    const lock = tempoLock(p.p0, this.vc.clock.bpm);
    const ly = formatLy(p.distKpc * LY_PER_KPC);
    const shift = lock.octaves === 0 ? 'no octave shift' : lock.octaves > 0 ? `÷ 2${superscript(lock.octaves)}` : `× 2${superscript(-lock.octaves)}`;
    const age = characteristicAge(p.p0, p.p1);
    // A tiny pulse-train picture for the graph: one bar of the locked rhythm.
    const series = Array.from({ length: 48 }, (_, i) => {
      const phase = (i / 48) * this.vc.clock.beatsPerBar * lock.perBeat;
      return Math.pow(Math.max(0, Math.cos(2 * Math.PI * phase)), 6);
    });
    return {
      headline: `${p.name}: ${describeSpin(p.p0)}, ${ly} away`,
      detail: `Heard as ${SUBDIVISION[lock.perBeat]} pulses (${lock.spinHz < 20 ? lock.spinHz.toFixed(2) : Math.round(lock.spinHz)} Hz ${shift} = ${lock.shiftedHz.toFixed(2)} Hz, eased to the ${this.vc.clock.bpm} BPM beat) · spin-down age ~${describeAge(age)}`,
      series,
    };
  }

  dispose(at: number): void {
    const t = Math.max(at, this.vc.ctx.currentTime);
    this.teardown(t);
    const out = this.output;
    setTimeout(() => out.disconnect(), 4000);
  }
}

function superscript(n: number): string {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(n)
    .split('')
    .map((d) => sup[Number(d)] ?? d)
    .join('');
}

export const pulsarClocks: VoiceDefinition = {
  id: 'pulsar-clocks',
  name: 'Pulsar Clocks',
  phenomenon: 'Spinning neutron stars sweeping radio beams past Earth',
  technique: 'sonification',
  color: '#4fd8e8',
  roles: ['pulse', 'texture', 'melody'],
  live: false,
  credit: {
    mission: 'Radio telescopes worldwide (Parkes/Murriyang, Jodrell Bank, Arecibo, Green Bank and others)',
    agency: 'CSIRO Australia Telescope National Facility — ATNF Pulsar Catalogue',
    dataset: 'ATNF Pulsar Catalogue: spin period, spin-down rate, dispersion measure, distance (Manchester et al. 2005)',
    url: 'https://www.atnf.csiro.au/research/pulsar/psrcat/',
  },
  cards: [
    {
      title: 'What it is',
      body: 'A pulsar is the collapsed core of a dead star: a ball of neutrons about 20 km across, heavier than the Sun, spinning from once a second to over 600 times a second. Its radio beam sweeps past Earth once per turn, like a lighthouse, so steadily that some pulsars rival atomic clocks. We feature one pulsar at a time — Vela, the Crab, B0329+54, J0437−4715, B1937+21 and CP 1919, the first ever found — changing every few minutes.',
    },
    {
      title: 'How the sound is made',
      body: 'This is a sonification, not a recording. Each pulsar’s real spin rate is halved again and again (or doubled) until it is close to the music’s beat — halving keeps the rhythm’s identity, since it is every other tick of the same pulse train — and then eased by up to half an octave onto the nearest beat subdivision so it plays in time: faster pulsars get quicker subdivisions. The pitch is the spin frequency moved up or down by whole octaves into the instrument’s range, then nudged to the nearest note of the current chord (usually a few semitones). Pulses that crossed more interstellar gas (higher dispersion measure) sound softer and more blurred, and nearer pulsars are a little louder. The readout shows the exact numbers.',
    },
    {
      title: 'The mission',
      body: 'The values come from the ATNF Pulsar Catalogue, maintained by CSIRO in Australia, which gathers timing measurements of more than 3,000 pulsars made by radio telescopes around the world since Jocelyn Bell Burnell and Antony Hewish discovered the first pulsar in 1967. Pulsar timing arrays now use the steadiest of them to listen for the gravitational-wave background of the Universe.',
    },
  ],
  archive: 'pulsar-clocks.json',
  parse: parsePulsars,
  create: (vc, role) => new PulsarVoice(vc, role),
};
