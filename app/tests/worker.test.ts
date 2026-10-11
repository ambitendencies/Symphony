import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeSolarWind, parseTimeTag, readTable, SchemaError } from '../../worker/src/parse';
import worker, { refresh, type Env } from '../../worker/src/index';
import { parseSolarWind } from '../src/lib/voices/solarWind';

// Inline fixtures in NOAA SWPC's real shape: header row first, every value a string (or null).
const PLASMA = [
  ['time_tag', 'density', 'speed', 'temperature'],
  ['2026-10-11 00:00:00.000', '5.10', '410.2', '81000'],
  ['2026-10-11 00:01:00.000', '5.30', '412.8', '83000'],
  ['2026-10-11 00:02:00.000', null, '411.0', '82000'],
  ['2026-10-11 00:10:00.000', '6.00', '420.0', '90000'],
  ['2026-10-11 00:11:00.000', '-99999.0', '-99999.0', '-99999'], // fill values
  ['2026-10-11 00:20:00.000', '7.00', '430.0', null],
  ['2026-10-11 00:30:00.000', '7.50', '440.0', '95000'],
  ['not a time', '1', '2', '3'],
];
const MAG = [
  ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'],
  ['2026-10-11 00:00:00.000', '1.0', '2.0', '-3.0', '10', '-20', '4.0'],
  ['2026-10-11 00:05:00.000', '1.0', '2.0', '-5.0', '10', '-20', '6.0'],
  ['2026-10-11 00:10:00.000', '1.0', '2.0', '2.0', '10', '20', '3.0'],
  ['2026-10-11 00:30:00.000', '1.0', '2.0', '1.5', '10', '20', '3.0'],
];
const NOW = Date.parse('2026-10-11T00:35:00Z');

describe('worker: NOAA parsing', () => {
  it('parses SWPC time tags as UTC', () => {
    expect(parseTimeTag('2026-10-11 00:01:00.000')).toBe(Date.parse('2026-10-11T00:01:00Z'));
    expect(parseTimeTag('2026-10-11T00:01:00Z')).toBe(Date.parse('2026-10-11T00:01:00Z'));
    expect(parseTimeTag('yesterday')).toBeNaN();
    expect(parseTimeTag(42)).toBeNaN();
  });

  it('validates the array-of-arrays schema', () => {
    expect(() => readTable({}, 'plasma', { speed: 'speed' })).toThrow(SchemaError);
    expect(() => readTable([['time_tag']], 'plasma', { speed: 'speed' })).toThrow(SchemaError);
    expect(() => readTable([['time', 'speed'], ['2026-10-11 00:00:00.000', '400']], 'plasma', { speed: 'speed' })).toThrow(/time_tag/);
    expect(() => readTable([['time_tag', 'velocity'], ['2026-10-11 00:00:00.000', '400']], 'plasma', { speed: 'speed' })).toThrow(/missing column speed/);
    // Fill values and impossible numbers become missing, not data.
    const rows = readTable(PLASMA, 'plasma', { density: 'density', speed: 'speed', temperature: 'temperature' });
    expect(rows.find((r) => r.t === Date.parse('2026-10-11T00:11:00Z'))).toEqual({ t: Date.parse('2026-10-11T00:11:00Z') });
  });

  it('merges plasma and mag into 10-minute bins', () => {
    const doc = mergeSolarWind(PLASMA, MAG, NOW);
    expect(doc.series.map((r) => r.time)).toEqual([
      '2026-10-11T00:00:00Z',
      '2026-10-11T00:10:00Z',
      '2026-10-11T00:20:00Z',
      '2026-10-11T00:30:00Z',
    ]);
    const [b0, b1, b2, b3] = doc.series;
    expect(b0.speed).toBeCloseTo((410.2 + 412.8 + 411.0) / 3, 1);
    expect(b0.density).toBeCloseTo(5.2, 2);
    expect(b0.bz).toBeCloseTo(-4, 2); // mean of −3 and −5
    expect(b1.speed).toBe(420); // fill row ignored
    expect(b2.temperature).toBe(90000); // carried forward
    expect(b2.bz).toBe(2); // carried forward from the previous bin
    expect(b3.bz).toBe(1.5);
  });

  it('writes exactly the app’s solar-wind envelope, which the voice parser accepts', () => {
    const doc = mergeSolarWind(PLASMA, MAG, NOW);
    expect(Object.keys(doc).sort()).toEqual(['kind', 'series', 'source', 'spacecraft', 'updated', 'version', 'voice']);
    expect(doc.version).toBe(1);
    expect(doc.voice).toBe('solar-wind');
    for (const r of doc.series) expect(Object.keys(r).sort()).toEqual(['bz', 'density', 'speed', 'temperature', 'time']);
    const snap = parseSolarWind(doc, false);
    expect(snap.values.speed).toBe(440);
    expect(snap.time).toBe('2026-10-11T00:30:00.000Z');
  });

  it('refuses too little data', () => {
    expect(() => mergeSolarWind(PLASMA.slice(0, 3), MAG, NOW)).toThrow(SchemaError);
  });
});

function memoryEnv(): Env & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    DATA: {
      async get(key: string) {
        const v = objects.get(key);
        return v === undefined ? null : { text: async () => v, httpEtag: 'x', uploaded: new Date() };
      },
      async put(key: string, value: string) {
        objects.set(key, value);
      },
    },
  };
}

describe('worker: cron and serving', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (plasma: unknown, mag: unknown, ok = true) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        ok ? new Response(JSON.stringify(url.includes('plasma') ? plasma : mag)) : new Response('down', { status: 503 }),
      ),
    );

  it('stores a good refresh and serves it with CORS and cache headers', async () => {
    const env = memoryEnv();
    stubFetch(PLASMA, MAG);
    await refresh(env, NOW);
    const res = await worker.fetch(new Request('https://data.example/solar-wind.json'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=60/);
    const body = await res.json();
    expect(body.series).toHaveLength(4);
    const again = await worker.fetch(new Request('https://data.example/solar-wind.json', { headers: { 'If-None-Match': res.headers.get('ETag')! } }), env);
    expect(again.status).toBe(304);
  });

  it('keeps the last good copy when upstream fails or changes schema', async () => {
    const env = memoryEnv();
    stubFetch(PLASMA, MAG);
    await refresh(env, NOW);
    const good = env.objects.get('solar-wind.json');
    stubFetch(PLASMA, MAG, false);
    await expect(refresh(env, NOW)).rejects.toThrow(/503/);
    stubFetch([['when', 'speed']], MAG);
    await expect(refresh(env, NOW)).rejects.toThrow(SchemaError);
    expect(env.objects.get('solar-wind.json')).toBe(good);
  });

  it('answers preflight, 404s unknown paths and 503s before the first refresh', async () => {
    const env = memoryEnv();
    expect((await worker.fetch(new Request('https://d/solar-wind.json', { method: 'OPTIONS' }), env)).status).toBe(204);
    expect((await worker.fetch(new Request('https://d/secret'), env)).status).toBe(404);
    expect((await worker.fetch(new Request('https://d/solar-wind.json'), env)).status).toBe(503);
  });
});
