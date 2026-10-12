import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/lib/stations';
import { VOICES } from '../src/lib/voices';
import { foldRatio, gridTimes } from '../src/lib/voices/base';
import { harmonicAmps, parseAfterglow } from '../src/lib/voices/afterglow';
import { bellRatios, parseAtomicEchoes } from '../src/lib/voices/atomicEchoes';
import { lightCurve, parseCollapsingStars, supernovaAt } from '../src/lib/voices/collapsingStars';
import { parseFastRadioBursts, sweepSeconds } from '../src/lib/voices/fastRadioBursts';
import { parsePlanetaryRadio, whistlerShape } from '../src/lib/voices/planetaryRadio';
import { nearResonance, parseResonantWorlds } from '../src/lib/voices/resonantWorlds';
import { flareAt, flareFlux, fluxLevel, parseSolarFlares } from '../src/lib/voices/solarFlares';
import afterglowJson from '../public/data/afterglow.json';
import atomicJson from '../public/data/atomic-echoes.json';
import collapsingJson from '../public/data/collapsing-stars.json';
import frbJson from '../public/data/fast-radio-bursts.json';
import planetaryJson from '../public/data/planetary-radio.json';
import resonantJson from '../public/data/resonant-worlds.json';
import flaresJson from '../public/data/solar-flares.json';

const ARCHIVES: Array<[string, (raw: unknown, fb: boolean) => unknown, unknown]> = [
  ['afterglow', parseAfterglow, afterglowJson],
  ['atomic-echoes', parseAtomicEchoes, atomicJson],
  ['collapsing-stars', parseCollapsingStars, collapsingJson],
  ['fast-radio-bursts', parseFastRadioBursts, frbJson],
  ['planetary-radio', parsePlanetaryRadio, planetaryJson],
  ['resonant-worlds', parseResonantWorlds, resonantJson],
  ['solar-flares', parseSolarFlares, flaresJson],
];

describe('new voice archives', () => {
  it.each(ARCHIVES)('%s parses its archive and rejects garbage', (_id, parse, raw) => {
    const snap = parse(raw, true) as { fallback: boolean; extra: unknown };
    expect(snap.fallback).toBe(true);
    expect(snap.extra).toBeTruthy();
    expect(() => parse({}, false)).toThrow();
    expect(() => parse(null, false)).toThrow();
  });

  it('every registered voice has an archive file wired to its parser', () => {
    const ids = new Set(ARCHIVES.map(([id]) => id));
    for (const v of VOICES) if (ids.has(v.id)) expect(v.archive).toBe(`${v.id}.json`);
  });
});

describe('stations use voices in roles they support', () => {
  const byId = new Map(VOICES.map((v) => [v.id, v]));
  it.each(STATIONS.map((s) => [s.id, s] as const))('%s', (_id, station) => {
    for (const m of station.movements)
      for (const slot of m.voices) expect(byId.get(slot.voice)?.roles, `${slot.voice} as ${slot.role}`).toContain(slot.role);
  });

  it('every voice is used by at least one station', () => {
    const used = new Set(STATIONS.flatMap((s) => s.movements.flatMap((m) => m.voices.map((v) => v.voice))));
    for (const v of VOICES) expect(used.has(v.id), v.id).toBe(true);
  });

  it('station hues are distinct', () => {
    const hues = STATIONS.map((s) => s.hue).sort((a, b) => a - b);
    for (let i = 1; i < hues.length; i++) expect(hues[i] - hues[i - 1]).toBeGreaterThanOrEqual(20);
  });
});

describe('physics helpers', () => {
  it('TRAPPIST-1 neighbours are near the published resonances', () => {
    const p = resonantJson.planets.map((x) => x.periodDays);
    const ratios = p.slice(1).map((x, i) => nearResonance(x / p[i]));
    expect(ratios).toEqual(['8:5', '5:3', '3:2', '3:2', '4:3', '3:2']);
  });

  it('flare flux peaks at the published class, then halves by the end time', () => {
    const d = parseSolarFlares(flaresJson, true).extra as { flares: Parameters<typeof flareFlux>[0][]; background: number };
    const f = d.flares[0];
    expect(flareFlux(f, f.peak - f.start, d.background)).toBeCloseTo(f.peakFlux);
    const atEnd = flareFlux(f, f.end - f.start, d.background);
    expect(atEnd).toBeCloseTo(d.background + (f.peakFlux - d.background) / 2);
    expect(fluxLevel(1e-7)).toBe(0);
    expect(fluxLevel(1e-3)).toBe(1);
    expect(flareAt(d, 0).flare.name).toBe(f.name);
  });

  it('CMB harmonics sum to one and the first peak is loudest', () => {
    const a = harmonicAmps(afterglowJson.peaks);
    expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
    expect(Math.max(...a)).toBe(a[0]);
  });

  it('supernova light curves peak at the rise time and fade', () => {
    const sn = (parseCollapsingStars(collapsingJson, true).extra as { supernovae: Parameters<typeof lightCurve>[0][] }).supernovae;
    for (const s of sn) {
      expect(lightCurve(s, 0)).toBe(0);
      expect(lightCurve(s, s.riseDays)).toBeCloseTo(1);
      expect(lightCurve(s, s.riseDays + s.plateauDays + 3 * s.declineDays)).toBeLessThan(0.06);
    }
    expect(supernovaAt({ supernovae: sn }, 0, 10).index).toBe(0);
  });

  it('more dispersed bursts sweep longer', () => {
    expect(sweepSeconds(87.8)).toBeLessThan(sweepSeconds(557));
    expect(sweepSeconds(1458)).toBeLessThanOrEqual(2.01);
  });

  it('whistler shape falls fast then slowly, from 1 to 0', () => {
    expect(whistlerShape(0)).toBeCloseTo(1);
    expect(whistlerShape(1)).toBeCloseTo(0);
    expect(1 - whistlerShape(0.2)).toBeGreaterThan(whistlerShape(0.2) - whistlerShape(0.8));
  });

  it('bell overtones come from the line-energy ratios, folded above the octave', () => {
    const r = bellRatios([1173.2, 1332.5]); // iron-60
    expect(r[0]).toBe(2);
    expect(r[1]).toBeCloseTo(2 * (1332.5 / 1173.2));
    for (const x of r) expect(x).toBeGreaterThanOrEqual(2);
    expect(foldRatio(17.04)).toBeCloseTo(17.04 / 16);
  });

  it('grid times cover a window exactly once', () => {
    const a = gridTimes(0, 1, 0.25, 0);
    const b = gridTimes(1, 2, 0.25, 0);
    expect(a).toEqual([0, 0.25, 0.5, 0.75]);
    expect(b[0]).toBe(1);
  });
});
