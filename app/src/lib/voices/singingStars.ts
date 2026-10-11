/**
 * Singing Stars — asteroseismology.
 *
 * PRD: "Each star's oscillation modes shifted into hearing range as a gentle
 * chord, rotating through stars every few minutes."
 *
 * Sun-like stars ring with many sound waves at once (p modes) with periods
 * of minutes. A star's measured (or, from published Δν and νmax, computed)
 * mode frequencies are sped up by a single factor so their *ratios* are kept
 * exactly; that sped-up cluster becomes the shimmering upper partials of
 * every note. The factor is chosen per note so the central radial mode lands
 * one octave above a chord tone, and a plain fundamental on that chord tone
 * sits underneath — so the harmony stays in tune while the shimmer is the
 * star's own pattern.
 *
 * Roles:
 *  - harmony: slow pads (4 s attacks, ≥1 s enforced) on three chord tones,
 *             re-voiced every 8 bars and on every chord change.
 *  - melody:  sparse phrases of 2–5 soft notes, with bars of rest between,
 *             starting higher for stars that ring faster (higher νmax).
 */

import { nearest } from '../engine/theory';
import type { DataSnapshot, Readout, Role, VoiceContext, VoiceDefinition, VoiceInstance } from '../engine/types';
import { midiToFreq } from './kit';
import { envelopeGain, formatFactor, formatPeriod, isFiniteIn } from './music';

export interface Mode {
  l: number;
  n: number;
  /** µHz */
  freq: number;
}

export interface Star {
  name: string;
  kind: string;
  /** Frequency of maximum oscillation power (µHz). */
  numax: number;
  /** Large frequency separation (µHz). */
  dnu: number;
  modes: Mode[];
  measuredModes: boolean;
  reference: string;
  note: string;
}

export interface Partial {
  /** Frequency relative to the reference (central radial) mode. */
  ratio: number;
  /** Relative amplitude; all partials sum to 1. */
  amp: number;
  l: number;
}

/** Bars each star is featured for (~3–4 minutes). */
export const ROTATE_BARS = 48;
/** Pads are re-voiced every this many bars (chord changes fall on these lines). */
export const SEGMENT_BARS = 8;
/** The star's central mode sounds this many times the note's fundamental (one octave up). */
export const CLUSTER_OCTAVE = 2;

/** Relative amplitude by angular degree l (√ of typical Kepler mode visibilities 1 : 1.5 : 0.5). */
const VISIBILITY: Record<number, number> = { 0: 1, 1: 1.22, 2: 0.71 };

/** The radial (l = 0) mode closest to νmax — the "fundamental" of the star's chord. */
export function referenceMode(star: Star): Mode {
  const radial = star.modes.filter((m) => m.l === 0);
  const pool = radial.length ? radial : star.modes;
  return pool.reduce((best, m) => (Math.abs(m.freq - star.numax) < Math.abs(best.freq - star.numax) ? m : best));
}

/**
 * The star's modes within ±1.15 Δν of νmax as partial ratios to the reference
 * mode, weighted by a Gaussian power envelope around νmax (FWHM ≈ 0.66 νmax^0.88,
 * Mosser et al. 2012) and typical visibilities. Ratios are the star's own.
 */
export function starPartials(star: Star): Partial[] {
  const ref = referenceMode(star);
  const sigma = (0.66 * Math.pow(star.numax, 0.88)) / 2.355;
  const sel = star.modes.filter((m) => Math.abs(m.freq - star.numax) <= 1.15 * star.dnu || m === ref);
  const raw = sel.map((m) => ({
    ratio: m.freq / ref.freq,
    amp: (VISIBILITY[m.l] ?? 0.5) * Math.exp(-((m.freq - star.numax) ** 2) / (2 * sigma * sigma)),
    l: m.l,
  }));
  const sum = raw.reduce((a, p) => a + p.amp, 0) || 1;
  return raw.map((p) => ({ ...p, amp: p.amp / sum })).sort((a, b) => a.ratio - b.ratio);
}

/** Speed-up factor that puts the reference mode at `hz`. */
export function speedUp(star: Star, hz: number): number {
  return hz / (referenceMode(star).freq * 1e-6);
}

export function parseStars(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as { stars?: unknown[]; updated?: string };
  if (!doc || !Array.isArray(doc.stars) || doc.stars.length === 0) throw new Error('singing stars: no star list');
  const stars: Star[] = [];
  for (const r of doc.stars as Array<Record<string, unknown>>) {
    if (!r || typeof r.name !== 'string' || !isFiniteIn(r.numax, 1, 20000) || !isFiniteIn(r.dnu, 0.05, 1000)) continue;
    const numax = r.numax;
    const dnu = r.dnu;
    const modes = (Array.isArray(r.modes) ? r.modes : [])
      .filter(
        (m): m is Mode =>
          !!m &&
          [0, 1, 2].includes((m as Mode).l) &&
          isFiniteIn((m as Mode).freq, 0, 1e5) &&
          Math.abs((m as Mode).freq - numax) <= 3 * dnu,
      )
      .map((m) => ({ l: m.l, n: Number.isFinite(m.n) ? m.n : 0, freq: m.freq }));
    if (modes.length < 3) continue;
    stars.push({
      name: r.name,
      kind: typeof r.kind === 'string' ? r.kind : '',
      numax,
      dnu,
      modes,
      measuredModes: r.measuredModes === true,
      reference: typeof r.reference === 'string' ? r.reference : '',
      note: typeof r.note === 'string' ? r.note : '',
    });
  }
  if (!stars.length) throw new Error('singing stars: no valid stars');
  const time = typeof doc.updated === 'string' && Number.isFinite(Date.parse(doc.updated)) ? doc.updated : new Date(0).toISOString();
  return {
    values: { count: stars.length, numax: stars[0].numax, dnu: stars[0].dnu },
    series: stars[0].modes.map((m) => m.freq),
    time,
    source: 'Kepler & BiSON asteroseismology',
    fallback,
    extra: { stars },
  };
}

interface StarNote {
  f0: number;
  start: number;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  kind: 'chime' | 'pad';
  partials: Partial[];
  /** Share of the level given to the star's cluster (the rest is the plain fundamental). */
  cluster: number;
  cutoff: number;
  pan: number;
}

/** One note: a sine fundamental on a chord tone plus the star's sped-up mode cluster an octave above. */
function playStarNote(ctx: BaseAudioContext, dest: AudioNode, o: StarNote): number {
  const { node: env, end } = envelopeGain(ctx, {
    start: o.start,
    attack: o.attack,
    hold: o.hold,
    release: o.release,
    peak: o.gain,
    kind: o.kind,
  });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(o.cutoff, ctx.sampleRate * 0.45);
  lp.Q.value = 0.5;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, o.pan));
  env.connect(lp).connect(pan).connect(dest);
  const voices: Array<{ f: number; a: number }> = [{ f: o.f0, a: 1 - o.cluster }];
  for (const p of o.partials) voices.push({ f: o.f0 * CLUSTER_OCTAVE * p.ratio, a: o.cluster * p.amp });
  let pending = voices.length;
  for (const v of voices) {
    if (v.f >= ctx.sampleRate * 0.45 || v.a <= 0) {
      pending--;
      continue;
    }
    const osc = ctx.createOscillator();
    osc.frequency.value = v.f;
    const g = ctx.createGain();
    g.gain.value = v.a;
    osc.connect(g).connect(env);
    osc.start(o.start);
    osc.stop(end + 0.05);
    osc.onended = () => {
      g.disconnect();
      if (--pending <= 0) {
        env.disconnect();
        lp.disconnect();
        pan.disconnect();
      }
    };
  }
  return end;
}

class SingingStarsVoice implements VoiceInstance {
  readonly output: GainNode;
  role: Role;
  private stars: Star[] = [];
  /** Harmony: end of the pads already scheduled. */
  private padUntil: number | null = null;
  /** Melody: next note time and phrase state. */
  private nextNote: number | null = null;
  private phraseLeft = 0;
  private pitch: number | null = null;
  private lastF0 = 0;
  private lastTo = 0;
  private roleChangeAt = 0;

  constructor(private vc: VoiceContext, role: Role) {
    this.role = role;
    this.output = vc.ctx.createGain();
  }

  featured(t: number): Star | null {
    if (!this.stars.length) return null;
    const bar = Math.max(0, Math.floor(this.vc.clock.barAt(t) + 1e-6));
    return this.stars[Math.floor(bar / ROTATE_BARS) % this.stars.length];
  }

  setRole(role: Role, at: number): void {
    if (role === this.role) return;
    this.role = role;
    // What is sounding rings out; the new role starts at the next bar line after `at`.
    this.roleChangeAt = this.vc.clock.nextBar(at);
    this.padUntil = null;
    this.nextNote = null;
    this.phraseLeft = 0;
    this.pitch = null;
  }

  setData(data: DataSnapshot): void {
    const list = (data.extra?.stars as Star[] | undefined) ?? [];
    if (list.length) this.stars = list;
  }

  schedule(from: number, to: number): void {
    this.lastTo = to;
    if (!this.stars.length) return;
    if (this.role === 'melody') this.scheduleMelody(from, to);
    else this.scheduleHarmony(from, to);
  }

  /** Segment boundaries every SEGMENT_BARS bars from the clock origin. */
  private segmentEnd(t: number): number {
    const { clock } = this.vc;
    const bar = Math.floor(clock.barAt(t) + 1e-6);
    const endBar = (Math.floor(bar / SEGMENT_BARS) + 1) * SEGMENT_BARS;
    return clock.origin + endBar * clock.secondsPerBar;
  }

  private scheduleHarmony(from: number, to: number): void {
    const { harmony, ctx, clock } = this.vc;
    if (this.padUntil === null) this.padUntil = Math.max(clock.nextBeat(from), this.roleChangeAt);
    while (this.padUntil < to) {
      const start = this.padUntil;
      const end = this.segmentEnd(start + 1e-3);
      const star = this.featured(start);
      if (!star) return;
      const partials = starPartials(star);
      const tones = harmony.chordTones('harmony', start + 1e-3);
      // Open voicing: lowest, middle and top-but-one chord tones.
      const pick = [...new Set([tones[0], tones[Math.floor(tones.length / 2)], tones[Math.max(0, tones.length - 2)]])];
      const dur = end - start;
      const attack = Math.min(4, Math.max(1.5, dur * 0.25));
      const bright = harmony.mood.brightness;
      pick.forEach((m, i) => {
        const f0 = midiToFreq(m);
        this.lastF0 = f0;
        playStarNote(ctx, this.output, {
          f0,
          start,
          attack: attack + 0.4 * i,
          hold: Math.max(0, dur - attack - 0.4 * i),
          release: 5,
          gain: 0.17 - 0.028 * i,
          kind: 'pad',
          partials,
          cluster: 0.4,
          cutoff: 1400 + 1600 * bright,
          pan: (i - 1) * 0.35,
        });
      });
      this.padUntil = end;
    }
  }

  private scheduleMelody(from: number, to: number): void {
    const { harmony, ctx, clock, random } = this.vc;
    if (this.nextNote === null) this.nextNote = Math.max(clock.nextBar(from), this.roleChangeAt);
    const density = harmony.mood.density;
    while (this.nextNote !== null && this.nextNote < to) {
      const t: number = this.nextNote;
      const star = this.featured(t);
      if (!star) return;
      const scale = harmony.scaleTones('melody');
      if (this.phraseLeft <= 0) {
        // New phrase: 2–5 notes. Stars that ring faster (higher νmax) start higher.
        this.phraseLeft = 2 + Math.floor(random() * (2 + 2 * density));
        const u = (Math.log(star.numax) - Math.log(50)) / (Math.log(6000) - Math.log(50));
        const start = scale[Math.max(0, Math.min(scale.length - 1, Math.round(u * (scale.length - 1))))];
        this.pitch = nearest(harmony.chordTones('melody', t), start);
      }
      this.phraseLeft--;
      const last = this.phraseLeft <= 0;
      let midi = this.pitch!;
      if (last) midi = nearest(harmony.chordTones('melody', t), midi);
      const beats = random() < 0.6 ? 2 : random() < 0.5 ? 1 : 3;
      const f0 = midiToFreq(midi);
      this.lastF0 = f0;
      playStarNote(ctx, this.output, {
        f0,
        start: t,
        attack: 0.25,
        hold: beats * clock.secondsPerBeat * 0.4,
        release: last ? 4 : 2.5,
        gain: 0.36,
        kind: 'chime',
        partials: starPartials(star),
        cluster: 0.35,
        cutoff: 2500 + 2000 * harmony.mood.brightness,
        pan: (random() - 0.5) * 0.5,
      });
      // Step through the scale: mostly by step, sometimes a third.
      const i = scale.indexOf(nearest(scale, midi));
      const move = (random() < 0.55 ? -1 : 1) * (random() < 0.75 ? 1 : 2);
      this.pitch = scale[Math.max(0, Math.min(scale.length - 1, i + move))];
      if (last) {
        // Rest 2–4 bars (fewer when the mood is denser), then start on a bar line.
        const rest = 2 + Math.floor(random() * (3 - 2 * density));
        this.nextNote = clock.nextBar(t + beats * clock.secondsPerBeat) + (rest - 1) * clock.secondsPerBar;
      } else {
        this.nextNote = t + beats * clock.secondsPerBeat;
      }
    }
  }

  readout(): Readout {
    const star = this.featured(Math.max(this.lastTo, this.vc.clock.origin));
    if (!star) return { headline: 'Singing Stars: waiting for data…' };
    const period = formatPeriod(1 / (star.numax * 1e-6));
    const factor = this.lastF0 ? speedUp(star, this.lastF0 * CLUSTER_OCTAVE) : 0;
    const modes = starPartials(star).length;
    return {
      headline: `${star.name}: rings every ${period} (νmax ${Math.round(star.numax)} µHz)`,
      detail: `${factor ? `Sped up about ${formatFactor(factor)}×; ` : ''}its ${modes} strongest modes are the shimmer in each note${
        star.measuredModes ? ' (measured frequencies)' : ' (frequencies from its published Δν = ' + star.dnu + ' µHz)'
      }`,
      series: starPartials(star).map((p) => p.amp),
    };
  }

  dispose(_at: number): void {
    const out = this.output;
    setTimeout(() => out.disconnect(), 8000);
  }
}

export const singingStars: VoiceDefinition = {
  id: 'singing-stars',
  name: 'Singing Stars',
  phenomenon: 'Sound waves ringing inside Sun-like stars and red giants',
  technique: 'audification',
  color: '#f2d06b',
  roles: ['harmony', 'melody'],
  live: false,
  credit: {
    mission: 'NASA Kepler space telescope; BiSON (Birmingham Solar Oscillations Network) for the Sun',
    agency: 'NASA / MAST; University of Birmingham',
    dataset: 'Published asteroseismic νmax, Δν and mode frequencies (Huber et al. 2011; Metcalfe et al. 2012; Campante et al. 2015; Lillo-Box et al. 2014; Broomhall et al. 2009)',
    url: 'https://archive.stsci.edu/missions-and-data/kepler',
  },
  cards: [
    {
      title: 'What it is',
      body: 'Stars like the Sun are hollow bells of hot gas. Turbulence near the surface rings them with thousands of sound waves at once, making the whole star swell and shrink by a few metres per second with periods of minutes (hours for giant stars). Kepler saw these as tiny flickers in starlight. The pattern of tones reveals a star’s size, mass and age. We feature one star at a time: the Sun, 16 Cygni A and B, Kepler-444 and the red giant Kepler-91.',
    },
    {
      title: 'How the sound is made',
      body: 'Each star’s oscillation frequencies are sped up — by about 100,000 to several million times — by one factor, so the ratios between its tones are exactly the star’s own. That cluster of tones is the shimmer in every note. To keep the music in tune we pick the speed-up so the star’s central tone lands an octave above a note of the current chord, and add a plain tone on that note underneath. Honest caveats: this re-creates the star’s ringing from its list of frequencies rather than playing the flickering light itself; the Sun’s frequencies are measured, the other stars’ are computed from their published spacing (Δν) and peak (νmax) using the standard pattern, so they can differ from measured ones by a few parts in a thousand; and loudness of each tone follows a smooth typical envelope, not the measured power.',
    },
    {
      title: 'The mission',
      body: 'NASA’s Kepler telescope (2009–2018) watched 150,000 stars almost continuously, precise enough to see stars breathe. The Sun’s low-degree modes were measured by BiSON, a network of ground telescopes running since 1976. Asteroseismology from Kepler now dates stars and their planets, from 16 Cygni’s twin suns to the 11-billion-year-old Kepler-444 system.',
    },
  ],
  archive: 'singing-stars.json',
  parse: parseStars,
  create: (vc, role) => new SingingStarsVoice(vc, role),
};
