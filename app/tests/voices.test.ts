import { describe, expect, it } from 'vitest';
import { createClock, createHarmony, MOODS, midiToFreq } from '../src/lib/engine/theory';
import { VOICES } from '../src/lib/voices';
import {
  chirpFrequency,
  chirpMass,
  eventFrequencies,
  formatLightYears,
  planChirp,
  renderChirp,
  ringdownFrequency,
  ringdownTime,
  timeToCoalescence,
  type GwEvent,
} from '../src/lib/voices/gw';
import { captionFor, landingMidi, LANDING, parseEvents } from '../src/lib/voices/blackHoleChirps';
import { characteristicAge, describeSpin, parsePulsars, spinPitch, tempoLock, type Pulsar } from '../src/lib/voices/pulsarClocks';
import { parseStars, referenceMode, speedUp, starPartials, type Star } from '../src/lib/voices/singingStars';
import { foldIntoRange, formatFactor, formatLy, formatPeriod } from '../src/lib/voices/music';
import pulsarArchive from '../public/data/pulsar-clocks.json';
import starArchive from '../public/data/singing-stars.json';
import chirpArchive from '../public/data/black-hole-chirps.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('registry', () => {
  it('registers the three Phase B voices with honest metadata', () => {
    const ids = VOICES.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['pulsar-clocks', 'singing-stars', 'black-hole-chirps']));
    const byId = Object.fromEntries(VOICES.map((v) => [v.id, v]));
    expect(byId['pulsar-clocks'].technique).toBe('sonification');
    expect(byId['pulsar-clocks'].roles).toEqual(['pulse', 'texture', 'melody']);
    expect(byId['singing-stars'].roles).toEqual(['harmony', 'melody']);
    expect(byId['black-hole-chirps'].roles).toEqual(['events', 'foundation']);
    for (const id of ['pulsar-clocks', 'singing-stars', 'black-hole-chirps']) {
      expect(byId[id].live).toBe(false);
      expect(byId[id].archive).toBe(`${id}.json`);
    }
  });

  it('archive envelopes are versioned like solar-wind.json', () => {
    for (const [doc, id] of [
      [pulsarArchive, 'pulsar-clocks'],
      [starArchive, 'singing-stars'],
      [chirpArchive, 'black-hole-chirps'],
    ] as const) {
      expect(doc.version).toBe(1);
      expect(doc.voice).toBe(id);
      expect(doc.kind).toBe('archive');
      expect(typeof doc.source).toBe('string');
    }
  });
});

describe('pulsar clocks', () => {
  const snap = parsePulsars(pulsarArchive, true);
  const pulsars = snap.extra!.pulsars as Pulsar[];
  const byName = (s: string) => pulsars.find((p) => p.bname === s || p.jname === s)!;

  it('parses the ATNF archive with the real values', () => {
    expect(pulsars.length).toBe(6);
    expect(byName('B0833-45').p0).toBeCloseTo(0.08933, 5);
    expect(byName('B0531+21').p0).toBeCloseTo(0.03339, 5); // ATNF epoch-1968 value; ~33.7 ms today
    expect(byName('B0329+54').p0).toBeCloseTo(0.7145, 4);
    expect(byName('J0437-4715').p0).toBeCloseTo(0.005757, 6);
    expect(byName('B1937+21').p0).toBeCloseTo(0.0015578, 7);
    expect(byName('B1919+21').p0).toBeCloseTo(1.3373, 4);
    expect(snap.fallback).toBe(true);
  });

  it('rejects garbage and drops invalid rows', () => {
    expect(() => parsePulsars({}, false)).toThrow();
    expect(() => parsePulsars({ pulsars: [] }, false)).toThrow();
    expect(() => parsePulsars({ pulsars: [{ name: 'x', p0: -1, p1: 1e-15, dm: 10, dist_kpc: 1 }] }, false)).toThrow();
    const doc = clone(pulsarArchive) as { pulsars: Array<Record<string, unknown>> };
    doc.pulsars[0].p0 = 'fast';
    doc.pulsars[1].dist_kpc = NaN;
    expect((parsePulsars(doc, false).extra!.pulsars as Pulsar[]).length).toBe(4);
  });

  it('tempo lock: octave shifts keep the rate within half an octave of a power-of-two subdivision', () => {
    for (const p of pulsars) {
      for (const bpm of [50, 60, 66]) {
        const lock = tempoLock(p.p0, bpm);
        expect([0.5, 1, 2]).toContain(lock.perBeat);
        expect(lock.rateHz).toBeCloseTo((bpm / 60) * lock.perBeat, 9);
        expect(lock.shiftedHz * 2 ** lock.octaves).toBeCloseTo(1 / p.p0, 6);
        expect(lock.nudge).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-9);
        expect(lock.nudge).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
      }
    }
  });

  it('tempo lock: faster pulsars get denser (never sparser) subdivisions', () => {
    const sorted = [...pulsars].sort((a, b) => b.p0 - a.p0); // slowest first
    const tiers = sorted.map((p) => tempoLock(p.p0, 66).perBeat);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]);
    expect(tempoLock(byName('B1919+21').p0, 66).perBeat).toBe(0.5);
    expect(tempoLock(byName('B0833-45').p0, 66).perBeat).toBe(1);
    expect(tempoLock(byName('B1937+21').p0, 66).perBeat).toBe(2);
    // Vela: 11.19 Hz ÷ 2³ = 1.40 Hz, eased to 1.1 Hz at 66 BPM.
    const vela = tempoLock(byName('B0833-45').p0, 66);
    expect(vela.octaves).toBe(3);
    expect(vela.shiftedHz).toBeCloseTo(1.399, 2);
  });

  it('pitch keeps the spin frequency’s pitch class and lands in the register', () => {
    const p = byName('B1937+21');
    const m = spinPitch(p.p0, 57, 74);
    expect(m).toBeGreaterThanOrEqual(57);
    expect(m).toBeLessThanOrEqual(74);
    const raw = 69 + 12 * Math.log2(1 / p.p0 / 440);
    expect(Math.abs(((m - raw) % 12) + 12) % 12).toBeLessThan(1e-9);
  });

  it('describes spin, age and distance in plain words', () => {
    expect(describeSpin(0.08933)).toBe('spins 11.2 times a second');
    expect(describeSpin(1.3373)).toBe('turns once every 1.34 seconds');
    expect(describeSpin(0.0015578)).toBe('spins 642 times a second');
    expect(characteristicAge(0.0333924, 4.20972e-13)).toBeGreaterThan(1200);
    expect(characteristicAge(0.0333924, 4.20972e-13)).toBeLessThan(1300);
    expect(formatLy(0.28 * 3261.56)).toBe('910 light-years');
  });
});

describe('singing stars', () => {
  const snap = parseStars(starArchive, true);
  const stars = snap.extra!.stars as Star[];
  const sun = stars.find((s) => s.name === 'the Sun')!;

  it('parses published asteroseismic parameters', () => {
    expect(stars.length).toBeGreaterThanOrEqual(4);
    expect(sun.numax).toBe(3090);
    expect(sun.dnu).toBeCloseTo(135.1, 1);
    expect(sun.measuredModes).toBe(true);
    const cygA = stars.find((s) => s.name === '16 Cygni A')!;
    expect(cygA.numax).toBeCloseTo(2188, 0);
    expect(cygA.dnu).toBeCloseTo(103.78, 2);
    // Radial modes are spaced by Δν.
    const radial = cygA.modes.filter((m) => m.l === 0).map((m) => m.freq);
    for (let i = 1; i < radial.length; i++) expect(radial[i] - radial[i - 1]).toBeCloseTo(cygA.dnu, 1);
  });

  it('rejects garbage', () => {
    expect(() => parseStars({}, false)).toThrow();
    expect(() => parseStars({ stars: [{ name: 'x', numax: 3000, dnu: 135, modes: [] }] }, false)).toThrow();
    expect(() => parseStars({ stars: [{ name: 'x', numax: -5, dnu: 135, modes: [{ l: 0, freq: 3000 }] }] }, false)).toThrow();
  });

  it('partials keep the star’s own frequency ratios exactly and sum to 1', () => {
    for (const star of stars) {
      const parts = starPartials(star);
      const ref = referenceMode(star);
      expect(ref.l).toBe(0);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(parts.reduce((a, p) => a + p.amp, 0)).toBeCloseTo(1, 9);
      expect(parts.some((p) => Math.abs(p.ratio - 1) < 1e-12)).toBe(true);
      for (const p of parts) {
        const mode = star.modes.find((m) => Math.abs(m.freq / ref.freq - p.ratio) < 1e-12);
        expect(mode, `${star.name} ratio ${p.ratio}`).toBeDefined();
      }
    }
  });

  it('speed-up factor puts the reference mode on the target pitch', () => {
    const f = speedUp(sun, 440);
    expect(f).toBeCloseTo(440 / (referenceMode(sun).freq * 1e-6), 3);
    expect(f).toBeGreaterThan(1e5);
  });

  it('formats periods', () => {
    expect(formatPeriod(1 / (3090e-6))).toBe('5.4 minutes');
    expect(formatPeriod(1 / (109.4e-6))).toBe('2.5 hours');
    expect(formatFactor(132_456)).toBe('130,000');
    expect(formatFactor(2_456_000)).toBe('2.5 million');
  });
});

describe('black hole chirps', () => {
  const snap = parseEvents(chirpArchive, true);
  const events = snap.extra!.events as GwEvent[];
  const gw150914 = events.find((e) => e.name === 'GW150914')!;

  it('parses published GWTC parameters', () => {
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(gw150914.m1).toBeCloseTo(35.6, 1);
    expect(gw150914.m2).toBeCloseTo(30.6, 1);
    expect(gw150914.dl).toBe(440);
    expect(events.find((e) => e.name === 'GW190521')!.m1).toBe(85);
    expect(events.find((e) => e.name === 'GW170817')!.kind).toBe('BNS');
  });

  it('rejects garbage and impossible events', () => {
    expect(() => parseEvents({}, false)).toThrow();
    expect(() => parseEvents({ events: [{ name: 'x', kind: 'BBH', m1: 30, m2: 30, mfinal: 70, dl_mpc: 400, z: 0.1, lookback_gyr: 1 }] }, false)).toThrow();
    expect(() => parseEvents({ events: [{ name: 'x', kind: 'XYZ', m1: 30, m2: 30, mfinal: 50, dl_mpc: 400, z: 0.1, lookback_gyr: 1 }] }, false)).toThrow();
  });

  it('leading-order chirp physics', () => {
    expect(chirpMass(36, 29)).toBeCloseTo(28.1, 1);
    // From 35 Hz a 30 M☉ chirp lasts ~0.17 s (the old Python reference value).
    expect(timeToCoalescence(35, 30)).toBeCloseTo(0.17, 1);
    for (const f of [20, 50, 150]) expect(chirpFrequency(timeToCoalescence(f, 30), 30)).toBeCloseTo(f, 6);
    // f ∝ τ^(-3/8): 2^(8/3) times less time left → twice the frequency.
    expect(chirpFrequency(0.01 / 2 ** (8 / 3), 30) / chirpFrequency(0.01, 30)).toBeCloseTo(2, 9);
  });

  it('ringdown of GW150914’s remnant is ~250 Hz with a few-ms decay', () => {
    const { fEnd, tauRing } = eventFrequencies(gw150914);
    expect(fEnd).toBeGreaterThan(230);
    expect(fEnd).toBeLessThan(270);
    expect(tauRing * 1000).toBeGreaterThan(3);
    expect(tauRing * 1000).toBeLessThan(5);
    expect(ringdownFrequency(100, 0.7)).toBeLessThan(ringdownFrequency(50, 0.7));
    expect(ringdownTime(60, 0.9)).toBeGreaterThan(ringdownTime(60, 0.3));
  });

  it('plans calm swells that land on the requested note; heavier systems sweep slower', () => {
    for (const e of events) {
      const plan = planChirp(e, 220);
      expect(plan.rise).toBeGreaterThanOrEqual(7);
      expect(plan.rise).toBeLessThanOrEqual(12);
      expect(plan.fEnd * plan.pitch).toBeCloseTo(220, 6);
      expect(plan.fEnd / plan.fStart).toBeCloseTo(4, 9);
    }
    const heavy = planChirp(events.find((e) => e.name === 'GW190521')!, 220);
    const light = planChirp(events.find((e) => e.name === 'GW151226')!, 220);
    expect(heavy.realSeconds).toBeGreaterThan(light.realSeconds);
    expect(heavy.rise).toBeGreaterThan(light.rise);
  });

  it('renders a finite, gently starting, rising waveform', () => {
    const sr = 8000;
    const plan = planChirp(gw150914, 220);
    const w = renderChirp(plan, gw150914, sr);
    expect(w.length).toBe(Math.floor(plan.rise * sr) + Math.floor(plan.tail * sr));
    let peak = 0;
    for (const x of w) {
      expect(Number.isFinite(x)).toBe(true);
      peak = Math.max(peak, Math.abs(x));
    }
    expect(peak).toBeLessThanOrEqual(1.0001);
    const rms = (a: number, b: number) => Math.sqrt(w.slice(a, b).reduce((s, x) => s + x * x, 0) / (b - a));
    const n = Math.floor(plan.rise * sr);
    expect(rms(0, sr / 10)).toBeLessThan(0.05); // emerges from silence, no jolt
    expect(rms(n - sr, n)).toBeGreaterThan(rms(n / 4, n / 4 + sr));
    expect(Math.abs(w[w.length - 1])).toBeLessThan(1e-3); // ends at rest
  });

  it('lands on a chord tone in the events register', () => {
    const mood = MOODS.sleep;
    const h = createHarmony(mood, createClock(mood.bpm, mood.beatsPerBar, 0));
    for (const e of events) {
      const tones = h.chordTones('events', 1);
      const m = landingMidi(e, tones);
      expect(tones).toContain(m);
      expect(m).toBeGreaterThanOrEqual(LANDING.low);
      expect(m).toBeLessThanOrEqual(LANDING.high);
      expect(midiToFreq(m)).toBeLessThan(600);
    }
  });

  it('captions in plain language with light-travel distances', () => {
    expect(captionFor(gw150914)).toBe('Two black holes, 1.3 billion light-years away, merged');
    expect(captionFor(events.find((e) => e.name === 'GW170817')!)).toBe('Two neutron stars, 130 million light-years away, collided');
    expect(formatLightYears(7.12)).toBe('7.1 billion light-years');
  });
});

describe('music helpers', () => {
  it('folds by octaves into a range', () => {
    expect(foldIntoRange(5.4, 57, 74)).toBeCloseTo(65.4, 9);
    expect(foldIntoRange(100, 57, 74)).toBe(64);
  });
});
