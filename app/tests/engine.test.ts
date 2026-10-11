import { describe, expect, it } from 'vitest';
import { activeSlots, movementAt, nextChangeBar, totalBars, validateStation } from '../src/lib/engine/arrangement';
import { decodeLink, encodeLink } from '../src/lib/engine/deeplink';
import { clampValue, despike, Eased, normalize } from '../src/lib/engine/smoothing';
import { chordTonesIn, createClock, createHarmony, MOODS, REGISTERS, midiToFreq, scaleTonesIn } from '../src/lib/engine/theory';
import { ROLES } from '../src/lib/engine/types';
import { archiveFrame, loadSnapshot } from '../src/lib/data/feeds';
import { STATIONS } from '../src/lib/stations';
import { LAUNCH_VOICE_IDS, VOICES } from '../src/lib/voices';
import { parseSolarWind, describeSpeed } from '../src/lib/voices/solarWind';
import archive from '../public/data/solar-wind.json';

describe('theory', () => {
  it('every mood scale is ascending within an octave', () => {
    for (const m of Object.values(MOODS)) {
      expect(m.scaleCents[0]).toBe(0);
      for (let i = 1; i < m.scaleCents.length; i++) expect(m.scaleCents[i]).toBeGreaterThan(m.scaleCents[i - 1]);
      expect(m.scaleCents.at(-1)!).toBeLessThan(1200);
      expect(m.bpm).toBeGreaterThanOrEqual(50);
      expect(m.bpm).toBeLessThanOrEqual(70);
    }
  });

  it('sleep uses pure just-intonation intervals (perfect fifth = 701.955 cents)', () => {
    expect(MOODS.sleep.scaleCents[3]).toBeCloseTo(701.955, 2);
  });

  it('registers keep roles in safe frequency bands', () => {
    expect(midiToFreq(REGISTERS.foundation.low)).toBeGreaterThan(30);
    expect(midiToFreq(REGISTERS.texture.high)).toBeLessThan(8000);
    for (const role of ROLES) expect(REGISTERS[role].high - REGISTERS[role].low).toBeGreaterThanOrEqual(12);
  });

  it('every role has scale and chord tones in every mood', () => {
    for (const mood of Object.values(MOODS)) {
      const h = createHarmony(mood, createClock(mood.bpm, mood.beatsPerBar, 0));
      for (const role of ROLES) {
        expect(h.scaleTones(role).length).toBeGreaterThan(0);
        for (let c = 0; c < mood.progression.length; c++) {
          const t = c * mood.barsPerChord * h.mood.beatsPerBar * (60 / mood.bpm) + 0.01;
          expect(h.chordIndexAt(t)).toBe(c);
          expect(h.chordTones(role, t).length, `${mood.id}/${role}/chord ${c}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('snapping lands on scale tones; chord tones are a subset of scale tones', () => {
    const mood = MOODS.drift;
    const h = createHarmony(mood, createClock(60, 4, 0));
    const scale = new Set(h.scaleTones('melody').map((x) => x.toFixed(4)));
    expect(scale.has(h.snap(66.3, 'melody').toFixed(4))).toBe(true);
    for (const t of chordTonesIn(mood, mood.progression[1], 62, 81)) expect(scale.has(t.toFixed(4))).toBe(true);
    expect(scaleTonesIn(mood, 50, 62)).toEqual([50, 52, 54, 57, 59, 62]);
  });

  it('root sits inside the role register', () => {
    const h = createHarmony(MOODS.focus, createClock(66, 4, 0));
    for (const role of ROLES) {
      const r = h.root(role);
      expect(r).toBeGreaterThanOrEqual(REGISTERS[role].low);
      expect(r).toBeLessThanOrEqual(REGISTERS[role].high);
    }
  });

  it('clock boundaries', () => {
    const c = createClock(60, 4, 10);
    expect(c.secondsPerBar).toBe(4);
    expect(c.nextBar(10)).toBe(10);
    expect(c.nextBar(10.1)).toBe(14);
    expect(c.nextBeat(12.5)).toBe(13);
    expect(c.barAt(18)).toBe(2);
  });
});

describe('smoothing', () => {
  it('clamps and normalizes', () => {
    expect(clampValue(NaN, { min: 0, max: 10 })).toBe(5);
    expect(clampValue(99, { min: 0, max: 10 })).toBe(10);
    expect(normalize(100, { min: 10, max: 1000 }, true)).toBeCloseTo(0.5);
  });

  it('despike removes a single outlier', () => {
    const s = despike([400, 402, 401, 5000, 403, 404, 402]);
    expect(s[3]).toBeLessThan(410);
    expect(s[0]).toBe(400);
  });

  it('a data step becomes a swell, not a jump', () => {
    const e = new Eased(400, 4, 50);
    e.at(0);
    e.set(800);
    const after1 = e.at(1);
    expect(after1 - 400).toBeLessThanOrEqual(50.0001);
    let v = after1;
    for (let t = 2; t <= 60; t++) v = e.at(t);
    expect(v).toBeGreaterThan(790);
  });
});

describe('arrangement and stations', () => {
  it('launch stations are valid and reference only launch voices', () => {
    const known = new Set(LAUNCH_VOICE_IDS);
    for (const s of STATIONS) expect(validateStation(s, known), s.id).toEqual([]);
    for (const v of VOICES) expect(known.has(v.id)).toBe(true);
  });

  it('movements last 3–8 minutes at their mood tempo', () => {
    for (const s of STATIONS) {
      const mood = MOODS[s.mood];
      for (const m of s.movements) {
        const minutes = (m.bars * mood.beatsPerBar * 60) / mood.bpm / 60;
        expect(minutes, `${s.id}`).toBeGreaterThanOrEqual(2.5);
        expect(minutes, `${s.id}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('movementAt loops and nextChangeBar is on a boundary', () => {
    const s = STATIONS[0];
    const total = totalBars(s);
    expect(movementAt(s, 0)).toEqual({ index: 0, startBar: 0 });
    expect(movementAt(s, s.movements[0].bars)).toEqual({ index: 1, startBar: s.movements[0].bars });
    expect(movementAt(s, total + 1)).toEqual({ index: 0, startBar: total });
    expect(nextChangeBar(s, 3)).toBe(s.movements[0].bars);
  });

  it('voice budget keeps the foundation first', () => {
    const s = STATIONS.find((x) => x.id === 'full-cosmos')!;
    const slots = activeSlots(s, 2, { ...MOODS.drift, maxVoices: 2 });
    expect(slots.map((x) => x.role)).toContain('foundation');
    expect(slots).toHaveLength(2);
  });

  it('rejects bad configs', () => {
    const bad = { ...STATIONS[0], movements: [{ bars: 4, voices: [{ voice: 'a', role: 'foundation' as const }, { voice: 'b', role: 'foundation' as const }] }] };
    const errors = validateStation(bad);
    expect(errors.some((e) => e.includes('three voices'))).toBe(true);
    expect(errors.some((e) => e.includes('more than one foundation'))).toBe(true);
  });
});

describe('deep links', () => {
  it('round-trips station, mood, blend and time', () => {
    const state = {
      station: 'solar-drift',
      mood: 'sleep' as const,
      mix: { 'solar-wind': { level: 0.8, muted: false, solo: false }, 'pulsar-clocks': { level: 1, muted: true, solo: false }, 'singing-stars': { level: 1.2, muted: false, solo: true } },
      time: '2026-10-01T20:00:00.000Z',
    };
    const back = decodeLink(encodeLink(state));
    expect(back.station).toBe('solar-drift');
    expect(back.mood).toBe('sleep');
    expect(back.time).toBe(state.time);
    expect(back.mix!['pulsar-clocks'].muted).toBe(true);
    expect(back.mix!['singing-stars']).toEqual({ level: 1.2, muted: false, solo: true });
  });

  it('drops malformed or hostile input', () => {
    const back = decodeLink('?s=<script>&m=loud&mix=solar-wind:99,x:abc,%3Cimg%3E:1&t=yesterday');
    expect(back.station).toBeUndefined();
    expect(back.mood).toBeUndefined();
    expect(back.time).toBeUndefined();
    expect(back.mix).toEqual({ 'solar-wind': { level: 1.5, muted: false, solo: false } });
  });
});

describe('solar wind voice data', () => {
  it('parses the archive, clamps and despikes', () => {
    const snap = parseSolarWind(archive, true);
    expect(snap.fallback).toBe(true);
    expect(snap.frames!.length).toBe(archive.series.length);
    expect(snap.values.speed).toBeGreaterThan(250);
    const bad = { series: [{ time: '2026-10-01T00:00:00Z', speed: 1e9, density: -4, temperature: NaN, bz: 0 }] };
    const s2 = parseSolarWind(bad, false);
    expect(s2.values.speed).toBeLessThanOrEqual(900);
    expect(s2.values.density).toBeGreaterThanOrEqual(0.5);
  });

  it('rejects garbage', () => {
    expect(() => parseSolarWind({}, false)).toThrow();
    expect(() => parseSolarWind({ series: [{ time: 'nope' }] }, false)).toThrow();
  });

  it('describes speeds in plain words', () => {
    expect(describeSpeed(412)).toBe('a calm day');
    expect(describeSpeed(700)).toMatch(/storm/);
  });
});

describe('feeds', () => {
  const def = VOICES.find((v) => v.id === 'solar-wind')!;
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('uses live data when fresh', async () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const live = { series: [{ time: '2026-10-11T11:58:00Z', speed: 512, density: 3, temperature: 1e5, bz: -2 }] };
    const snap = await loadSnapshot({ ...def, liveUrl: 'https://live/x.json' }, { fetcher: (u) => (u.startsWith('https://live') ? ok(live) : ok(archive)), now });
    expect(snap.fallback).toBe(false);
    expect(snap.values.speed).toBe(512);
  });

  it('falls back to the archive when live is stale or down', async () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    const stale = { series: [{ time: '2026-10-10T00:00:00Z', speed: 512, density: 3, temperature: 1e5, bz: -2 }] };
    const a = await loadSnapshot({ ...def, liveUrl: 'https://live/x.json' }, { fetcher: (u) => (u.startsWith('https://live') ? ok(stale) : ok(archive)), now });
    expect(a.fallback).toBe(true);
    const b = await loadSnapshot({ ...def, liveUrl: 'https://live/x.json' }, { fetcher: (u) => (u.startsWith('https://live') ? Promise.reject(new Error('offline')) : ok(archive)), now });
    expect(b.fallback).toBe(true);
  });

  it('archival loops step through frames and wrap', () => {
    const snap = parseSolarWind(archive, true);
    const f0 = archiveFrame(snap, 0);
    const f1 = archiveFrame(snap, 20);
    expect(f0.values.speed).toBe(snap.frames![0].speed);
    expect(f1.values.speed).toBe(snap.frames![1].speed);
    expect(archiveFrame(snap, 20 * snap.frames!.length).values.speed).toBe(f0.values.speed);
  });
});

describe('voice definitions', () => {
  it('every voice has three cards, a credit, a technique and valid roles', () => {
    for (const v of VOICES) {
      expect(v.cards).toHaveLength(3);
      expect(v.credit.url).toMatch(/^https:\/\//);
      expect(['audification', 'sonification']).toContain(v.technique);
      expect(v.roles.length).toBeGreaterThan(0);
      for (const r of v.roles) expect(ROLES).toContain(r);
      if (v.refreshMs) expect(v.refreshMs).toBeGreaterThanOrEqual(60_000);
    }
  });
});
