/**
 * Black Hole Chirps — gravitational waves from merging black holes.
 *
 * PRD: "rare rising swells over a deep pad".
 *
 * Each event is the leading-order (quadrupole) chirp computed from the
 * published masses (see gw.ts): the last two octaves of the inspiral, slowed
 * down a few hundred times and shifted so the final ringdown frequency lands
 * on a chord tone, band-passed, widened and sent to the hall reverb. Heavier
 * systems really do sweep more slowly, and they take longer here too.
 *
 * Roles:
 *  - events:     every ~2–4 minutes (seeded, on a bar line) one merger plays;
 *                the ensemble ducks to make room and a caption appears at the
 *                moment of merger. A soft chord blooms where the chirp lands.
 *  - foundation: a deep pad on the mood's root (plus the chord's lowest tone);
 *                its brightness and level rise along a slowed-down chirp curve
 *                and decay like a ringdown, cycling through the events.
 */

import { freqToMidi, nearest } from '../engine/theory';
import type { DataSnapshot, Readout, Role, VoiceContext, VoiceDefinition, VoiceInstance } from '../engine/types';
import { arrayToBuffer, createDrone, midiToFreq, playNote, TIMBRES } from './kit';
import {
  chirpFrequency,
  chirpMass,
  eventFrequencies,
  formatLightYears,
  planChirp,
  renderChirp,
  timeToCoalescence,
  type ChirpPlan,
  type GwEvent,
} from './gw';
import { foldIntoRange, formatFactor, isFiniteIn, shuffled } from './music';

/** Landing notes are chord tones in this part of the events register (MIDI). */
export const LANDING = { low: 55, high: 72 };
/** Seconds between events: 120–240 (PRD "every ~2–4 minutes"). */
export const EVENT_GAP = { min: 120, max: 240 };
/** Peak level of a chirp (linear, before the role bus) — a noticeable swell, never a jolt. */
const CHIRP_GAIN = 0.26;
/** Foundation pad level at the top of a breath. */
const SHAPE_LEVEL = 0.6;

export function parseEvents(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as { events?: unknown[]; updated?: string };
  if (!doc || !Array.isArray(doc.events) || doc.events.length === 0) throw new Error('chirps: no event list');
  const events: GwEvent[] = [];
  for (const r of doc.events as Array<Record<string, unknown>>) {
    if (!r || typeof r.name !== 'string' || (r.kind !== 'BBH' && r.kind !== 'BNS')) continue;
    if (!isFiniteIn(r.m1, 0.5, 500) || !isFiniteIn(r.m2, 0.5, 500) || !isFiniteIn(r.dl_mpc, 0, 50000)) continue;
    if (!isFiniteIn(r.z, 0, 20) || !isFiniteIn(r.lookback_gyr, 0, 14)) continue;
    const spin = typeof r.spin === 'number' && r.spin >= 0 && r.spin < 1 ? r.spin : 0.69;
    const mfinal = isFiniteIn(r.mfinal, 0.5, 1000) ? r.mfinal : 0.95 * (r.m1 + r.m2);
    if (r.kind === 'BBH' && mfinal >= r.m1 + r.m2) continue;
    events.push({
      name: r.name,
      kind: r.kind,
      m1: Math.max(r.m1, r.m2),
      m2: Math.min(r.m1, r.m2),
      mfinal,
      spin,
      dl: r.dl_mpc,
      z: r.z,
      lookbackGyr: r.lookback_gyr,
      date: typeof r.date === 'string' ? r.date : '',
    });
  }
  if (!events.length) throw new Error('chirps: no valid events');
  const time = typeof doc.updated === 'string' && Number.isFinite(Date.parse(doc.updated)) ? doc.updated : new Date(0).toISOString();
  return {
    values: { count: events.length, mchirp: chirpMass(events[0].m1, events[0].m2), distance: events[0].lookbackGyr },
    series: events.map((e) => chirpMass(e.m1, e.m2)),
    time,
    source: 'LIGO–Virgo–KAGRA (GWOSC)',
    fallback,
    extra: { events },
  };
}

/** Plain-language caption, e.g. "Two black holes, 1.3 billion light-years away, merged". */
export function captionFor(e: GwEvent): string {
  const where = formatLightYears(e.lookbackGyr);
  return e.kind === 'BNS'
    ? `Two neutron stars, ${where} away, collided`
    : `Two black holes, ${where} away, merged`;
}

/** Chord tone (in LANDING) nearest to the event's end frequency moved down one octave. */
export function landingMidi(e: GwEvent, chordTones: number[]): number {
  const { fEnd } = eventFrequencies(e);
  const target = foldIntoRange(freqToMidi(fEnd) - 12, LANDING.low, LANDING.high);
  const pool = chordTones.filter((m) => m >= LANDING.low && m <= LANDING.high);
  return pool.length ? nearest(pool, target) : target;
}

function describeEvent(e: GwEvent): string {
  const what = e.kind === 'BNS' ? 'neutron stars' : 'black holes';
  return `${Math.round(e.m1 * 10) / 10 >= 10 ? Math.round(e.m1) : e.m1} + ${Math.round(e.m2 * 10) / 10 >= 10 ? Math.round(e.m2) : e.m2} suns of ${what}`;
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

class BlackHoleVoice implements VoiceInstance {
  readonly output: GainNode;
  role: Role;
  private events: GwEvent[] = [];
  private order: GwEvent[] = [];
  private orderIndex = 0;
  private nextEventAt: number | null = null;
  private last: { event: GwEvent; plan: ChirpPlan; landing: number; at: number; mergeAt: number } | null = null;
  // foundation
  private drones: ReturnType<typeof createDrone>[] = [];
  private shape: GainNode | null = null;
  private shapeFilter: BiquadFilterNode | null = null;
  private cycleEnd: number | null = null;
  private cycleEvent: GwEvent | null = null;
  private lastChord = -1;
  private lastTo = 0;
  private roleStart = 0;

  constructor(private vc: VoiceContext, role: Role) {
    this.role = role;
    this.output = vc.ctx.createGain();
    this.roleStart = Math.max(vc.ctx.currentTime, vc.clock.origin);
    this.build(role, this.roleStart);
  }

  private nextFromOrder(): GwEvent | null {
    if (!this.events.length) return null;
    if (!this.order.length) this.order = shuffled(this.events, this.vc.random);
    const e = this.order[this.orderIndex % this.order.length];
    this.orderIndex++;
    return e;
  }

  private build(role: Role, at: number): void {
    const { ctx, harmony } = this.vc;
    if (role !== 'foundation') return;
    const root = harmony.root('foundation');
    const chordLow = harmony.chordTones('foundation', at)[0] ?? root;
    this.shape = ctx.createGain();
    this.shape.gain.value = SHAPE_LEVEL * 0.73;
    this.shapeFilter = ctx.createBiquadFilter();
    this.shapeFilter.type = 'lowpass';
    this.shapeFilter.frequency.value = this.shapeBase();
    this.shapeFilter.Q.value = 0.6;
    this.shapeFilter.connect(this.shape).connect(this.output);
    this.drones = [
      createDrone(ctx, midiToFreq(root), { timbre: TIMBRES.warm, level: 0.42, cutoff: 900, spread: 5, start: at }),
      createDrone(ctx, midiToFreq(chordLow + 12), { timbre: TIMBRES.hollow, level: 0.2, cutoff: 1200, spread: 7, start: at }),
      createDrone(ctx, midiToFreq(root + 12), { timbre: TIMBRES.sine, level: 0.1, cutoff: 2000, spread: 3, start: at }),
    ];
    for (const d of this.drones) d.output.connect(this.shapeFilter);
    this.cycleEnd = null;
    this.lastChord = harmony.chordIndexAt(at);
  }

  private teardown(at: number): void {
    for (const d of this.drones) d.stop(at);
    this.drones = [];
    this.shape = null;
    this.shapeFilter = null;
  }

  setRole(role: Role, at: number): void {
    if (role === this.role) return;
    this.teardown(at);
    this.role = role;
    this.roleStart = at;
    this.nextEventAt = null;
    this.build(role, at);
  }

  setData(data: DataSnapshot): void {
    const list = (data.extra?.events as GwEvent[] | undefined) ?? [];
    if (list.length && list !== this.events) {
      this.events = list;
      this.order = [];
    }
  }

  schedule(from: number, to: number): void {
    this.lastTo = to;
    if (!this.events.length) return;
    if (this.role === 'foundation') this.scheduleFoundation(from, to);
    else this.scheduleEvents(from, to);
  }

  // --- events -----------------------------------------------------------------

  private scheduleEvents(from: number, to: number): void {
    const { clock, random } = this.vc;
    if (this.nextEventAt === null) {
      // The first merger comes soon after the voice enters (4–6 bars), later ones every 2–4 minutes.
      const start = Math.max(from, this.roleStart);
      this.nextEventAt = clock.nextBar(start) + (4 + Math.floor(random() * 3)) * clock.secondsPerBar;
    }
    while (this.nextEventAt < to) {
      const at = this.nextEventAt;
      const e = this.nextFromOrder();
      if (!e) return;
      const end = at >= from - 1e-6 ? this.playEvent(e, at) : at;
      const gap = EVENT_GAP.min + (EVENT_GAP.max - EVENT_GAP.min) * random();
      this.nextEventAt = clock.nextBar(end + gap);
    }
  }

  /** Play one merger starting at `at`; returns when it has died away. */
  private playEvent(e: GwEvent, at: number): number {
    const { ctx, harmony, clock } = this.vc;
    // Aim the merger at a bar line, landing on a chord tone of the chord sounding then.
    const guess = planChirp(e, 220);
    const mergeAt = clock.nextBar(at + guess.rise - clock.secondsPerBar / 2);
    const landing = landingMidi(e, harmony.chordTones('events', mergeAt + 0.01));
    const plan = planChirp(e, midiToFreq(landing));
    const rise = mergeAt - at; // stretch the excerpt so the merger falls exactly on the bar line
    const fitted: ChirpPlan = { ...plan, rise, stretch: rise / plan.realSeconds };
    const wave = renderChirp(fitted, e, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = arrayToBuffer(ctx, wave, ctx.sampleRate);

    // Band-pass around the landing note: the low start emerges gradually, nothing shrill.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = midiToFreq(landing) * 0.8;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    lp.Q.value = 0.5;
    const env = ctx.createGain();
    const total = fitted.rise + fitted.tail;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(CHIRP_GAIN, at + Math.min(3, fitted.rise * 0.3));
    env.gain.setValueAtTime(CHIRP_GAIN, at + total - 0.6);
    env.gain.linearRampToValueAtTime(0, at + total);
    // Two detectors, two ears: Hanford left, Livingston right, ~7 ms apart (GW150914 arrived 6.9 ms apart).
    const left = ctx.createStereoPanner();
    left.pan.value = -0.5;
    const right = ctx.createStereoPanner();
    right.pan.value = 0.5;
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.007;
    src.connect(bp).connect(lp).connect(env);
    env.connect(left).connect(this.output);
    env.connect(delay).connect(right).connect(this.output);
    src.start(at);
    src.stop(at + total + 0.1);
    src.onended = () => {
      for (const n of [bp, lp, env, left, right, delay]) n.disconnect();
    };

    // A soft chord blooms where the chirp lands (the "response").
    const chord = harmony.chordTones('events', mergeAt + 0.01).filter((m) => m < landing && m >= landing - 12);
    const bloom = [landing, ...(chord.length ? [chord[chord.length - 1]] : []), landing - 12];
    bloom.forEach((m, i) =>
      playNote(ctx, this.output, {
        freq: midiToFreq(m),
        start: mergeAt - 0.6,
        kind: 'pad',
        attack: 1.6 + 0.3 * i,
        hold: 1.5,
        release: 6,
        gain: 0.07 - 0.012 * i,
        timbre: TIMBRES.warm,
        cutoff: 1500,
        spread: 6,
        pan: (i - 1) * 0.3,
      }),
    );

    // Duck while the chirp rises; the ensemble returns (≈1 s glide) just after the merger.
    const duckAt = at + fitted.rise * 0.35;
    this.vc.requestDuck(duckAt, mergeAt + 2 - duckAt);
    this.vc.caption(captionFor(e), mergeAt);
    this.last = { event: e, plan: fitted, landing, at, mergeAt };
    return mergeAt + Math.max(fitted.tail, 1.6 + 1.5 + 6);
  }

  // --- foundation ---------------------------------------------------------------

  private scheduleFoundation(from: number, to: number): void {
    const { clock, harmony } = this.vc;
    // Follow the chord: glide the chord-tone drone on chord changes.
    const idx = harmony.chordIndexAt(to);
    if (idx !== this.lastChord && this.drones[1]) {
      this.lastChord = idx;
      const at = Math.max(from, clock.nextBar(from));
      const low = harmony.chordTones('foundation', at)[0];
      if (low !== undefined) this.drones[1].setFreq(midiToFreq(low + 12), at, 4);
    }
    // Chirp-shaped breathing, one cycle per event, scheduled a cycle ahead.
    if (!this.shape || !this.shapeFilter) return;
    if (this.cycleEnd === null) this.cycleEnd = Math.max(clock.nextBar(from), this.roleStart);
    while (this.cycleEnd < to + 1) {
      const e = this.nextFromOrder();
      if (!e) return;
      this.cycleEnd = this.shapeCycle(e, this.cycleEnd);
    }
  }

  /**
   * One breath shaped like a chirp: over ~30–45 s the pad brightens and swells
   * following f(τ) ∝ τ^(−3/8) and h ∝ f^(2/3) (stretched ~1000×), then dims
   * like a ringdown. Returns the end time (a bar line).
   */
  private shapeBase(): number {
    return 140 + 120 * this.vc.harmony.mood.brightness;
  }

  private shapeCycle(e: GwEvent, start: number): number {
    const { clock } = this.vc;
    const plan = planChirp(e, 100);
    const { mcDet } = eventFrequencies(e);
    const riseBars = Math.max(6, Math.round((plan.rise * 3.5) / clock.secondsPerBar));
    const rise = riseBars * clock.secondsPerBar;
    const fallBars = Math.max(3, Math.round(riseBars / 2));
    const end = start + (riseBars + fallBars) * clock.secondsPerBar;
    const tau0 = timeToCoalescence(plan.fStart, mcDet);
    const tau1 = timeToCoalescence(plan.fEnd, mcDet);
    const base = this.shapeBase();
    const f = this.shapeFilter!.frequency;
    const g = this.shape!.gain;
    // Level follows the strain amplitude h ∝ f^(2/3), from (1/4)^(2/3) of full at the start.
    const x0 = Math.pow(1 / 4, 2 / 3);
    const level = (x: number) => SHAPE_LEVEL * (0.55 + 0.45 * x);
    f.setValueAtTime(base, start);
    g.setValueAtTime(level(x0), start);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const ratio = chirpFrequency(tau0 - (tau0 - tau1) * u, mcDet) / plan.fStart; // 1 → 4
      f.linearRampToValueAtTime(base * ratio, start + rise * u);
      g.linearRampToValueAtTime(level(Math.pow(ratio / 4, 2 / 3)), start + rise * u);
    }
    // Ringdown: an exponential fall back to exactly the starting point (no step at the next cycle).
    const fall = end - start - rise;
    for (let i = 1; i <= 8; i++) {
      const u = i / 8;
      const k = (Math.exp(-4 * u) - Math.exp(-4)) / (1 - Math.exp(-4));
      f.linearRampToValueAtTime(base * (1 + 3 * k), start + rise + fall * u);
      g.linearRampToValueAtTime(level(x0 + (1 - x0) * k), start + rise + fall * u);
    }
    this.cycleEvent = e;
    return end;
  }

  readout(): Readout {
    const t = this.lastTo;
    if (this.role === 'foundation') {
      const e = this.cycleEvent ?? this.events[0];
      if (!e) return { headline: 'Black Hole Chirps: waiting for the catalogue…' };
      return {
        headline: `Deep pad breathing with ${e.name}’s chirp`,
        detail: `${describeEvent(e)}, ${formatLightYears(e.lookbackGyr)} away · the swell follows its rising frequency, slowed about a thousand times`,
        series: this.events.map((x) => chirpMass(x.m1, x.m2)),
      };
    }
    const l = this.last;
    if (!l || t < l.at) {
      const next = this.order[this.orderIndex % Math.max(1, this.order.length)] ?? this.events[0];
      return {
        headline: 'Listening for merging black holes…',
        detail: next ? `Next from the catalogue: ${next.name} (${describeEvent(next)})` : undefined,
      };
    }
    const e = l.event;
    const lower = l.plan.pitch < 1;
    return {
      headline: `${e.name}: ${describeEvent(e)} ${e.kind === 'BNS' ? 'collided' : 'merged'}, ${formatLightYears(e.lookbackGyr)} away`,
      detail: `Detected ${formatDate(e.date)} · heard ${formatFactor(l.plan.stretch)}× slower and ${
        lower ? `${formatFactor(1 / l.plan.pitch)}× lower` : `${formatFactor(l.plan.pitch)}× higher`
      } in pitch, landing on a chord tone`,
      series: Array.from({ length: 40 }, (_, i) => Math.pow((i + 1) / 40, 3)),
    };
  }

  dispose(at: number): void {
    const t = Math.max(at, this.vc.ctx.currentTime);
    this.teardown(t);
    const out = this.output;
    setTimeout(() => out.disconnect(), 15000);
  }
}

export const blackHoleChirps: VoiceDefinition = {
  id: 'black-hole-chirps',
  name: 'Black Hole Chirps',
  phenomenon: 'Gravitational waves from merging black holes and neutron stars',
  technique: 'audification',
  color: '#a98bff',
  roles: ['events', 'foundation'],
  live: false,
  credit: {
    mission: 'LIGO (Hanford & Livingston) and Virgo gravitational-wave observatories',
    agency: 'LIGO–Virgo–KAGRA Collaboration via GWOSC (Gravitational Wave Open Science Center)',
    dataset: 'GWTC catalogue source-frame masses and distances (Abbott et al. 2019, PRX 9, 031040; Abbott et al. 2020, PRL 125, 101102)',
    url: 'https://gwosc.org/eventapi/',
  },
  cards: [
    {
      title: 'What it is',
      body: 'When two black holes orbit each other they shake spacetime, losing energy as gravitational waves, and spiral together faster and faster until they merge into one larger black hole that “rings” briefly and falls silent. The wave frequency rises as they close in: a chirp. LIGO first caught one on 14 September 2015 — GW150914, two black holes of about 36 and 31 suns, about 1.3 billion light-years away. You may also hear GW190521, the heaviest early detection, and GW170817, two neutron stars whose collision was also seen as light.',
    },
    {
      title: 'How the sound is made',
      body: 'This is an audification of a model waveform, not of the noisy detector recording: from each event’s published masses we compute the chirp with the leading-order (quadrupole) formula, from two octaves below the merger up to the final black hole’s ringing frequency. Real chirps last a fraction of a second, so we slow time down a few hundred times (heavier systems sweep more slowly and stay slower here) and shift every frequency by one factor so the final note lands on a chord tone. The real ringdown lasts milliseconds; we let it ring for a few seconds, band-pass it and add hall reverb. As a foundation, a deep pad on the key’s root brightens and swells along a chirp curve slowed about a thousand times. Distances are light-travel distances.',
    },
    {
      title: 'The mission',
      body: 'LIGO’s two detectors in Washington and Louisiana, and Virgo in Italy, are laser interferometers with arms 3–4 km long that sense changes smaller than a thousandth of a proton’s width. The LIGO–Virgo–KAGRA collaboration publishes its catalogue of events — masses, distances and the strain data itself — through the Gravitational Wave Open Science Center.',
    },
  ],
  archive: 'black-hole-chirps.json',
  parse: parseEvents,
  create: (vc, role) => new BlackHoleVoice(vc, role),
};
