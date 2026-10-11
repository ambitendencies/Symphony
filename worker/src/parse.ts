/**
 * Pure NOAA SWPC → Cosmic Radio conversion (no Worker APIs, unit-tested from
 * app/tests/worker.test.ts).
 *
 * NOAA's 1-day real-time products are arrays of arrays whose first row is a
 * header, with every value a string (or null):
 *   plasma-1-day.json: ["time_tag", "density", "speed", "temperature"]
 *   mag-1-day.json:    ["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "lon_gsm", "lat_gsm", "bt"]
 * time_tag looks like "2026-10-11 00:01:00.000" (UTC).
 *
 * Output: the same versioned envelope as app/public/data/solar-wind.json,
 * with 1-minute samples averaged into 10-minute bins.
 */

export const BIN_MINUTES = 10;

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

export interface SolarWindRow {
  time: string;
  speed: number;
  density: number;
  temperature: number;
  bz: number;
}

export interface SolarWindDoc {
  version: 1;
  voice: 'solar-wind';
  kind: 'live';
  source: string;
  spacecraft: string;
  updated: string;
  series: SolarWindRow[];
}

/** Physically plausible ranges; values outside are treated as missing (fill values such as −99999 included). */
export const LIMITS = {
  speed: { min: 100, max: 3000 }, // km/s
  density: { min: 0.01, max: 300 }, // cm⁻³
  temperature: { min: 1e3, max: 1e8 }, // K
  bz: { min: -300, max: 300 }, // nT
} as const;

type Field = keyof typeof LIMITS;

/** "2026-10-11 00:01:00.000" → epoch ms (UTC), or NaN. */
export function parseTimeTag(tag: unknown): number {
  if (typeof tag !== 'string') return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)Z?$/.exec(tag.trim());
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}Z`);
}

function num(v: unknown, field: Field): number | null {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(x)) return null;
  const r = LIMITS[field];
  return x >= r.min && x <= r.max ? x : null;
}

/**
 * Validate an array-of-arrays product and return rows of the requested columns.
 * Throws SchemaError when the shape or header is wrong.
 */
export function readTable(raw: unknown, product: string, columns: Record<string, Field>): Array<{ t: number } & Partial<Record<Field, number>>> {
  if (!Array.isArray(raw) || raw.length < 2) throw new SchemaError(`${product}: expected a header row and data rows`);
  const header = raw[0];
  if (!Array.isArray(header) || !header.every((h) => typeof h === 'string')) throw new SchemaError(`${product}: bad header row`);
  const ti = header.indexOf('time_tag');
  if (ti < 0) throw new SchemaError(`${product}: no time_tag column`);
  const idx: Array<[number, Field]> = Object.entries(columns).map(([name, field]) => {
    const i = header.indexOf(name);
    if (i < 0) throw new SchemaError(`${product}: missing column ${name}`);
    return [i, field];
  });
  const rows: Array<{ t: number } & Partial<Record<Field, number>>> = [];
  for (const r of raw.slice(1)) {
    if (!Array.isArray(r) || r.length !== header.length) continue;
    const t = parseTimeTag(r[ti]);
    if (!Number.isFinite(t)) continue;
    const row: { t: number } & Partial<Record<Field, number>> = { t };
    for (const [i, field] of idx) {
      const v = num(r[i], field);
      if (v !== null) row[field] = v;
    }
    rows.push(row);
  }
  if (!rows.length) throw new SchemaError(`${product}: no rows with valid time tags`);
  return rows;
}

interface Acc {
  n: Record<Field, number>;
  sum: Record<Field, number>;
}

const FIELDS: Field[] = ['speed', 'density', 'temperature', 'bz'];
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Merge plasma and magnetometer products into 10-minute bins (bin start time).
 * A bin needs a speed and a density; missing temperature/Bz are carried
 * forward from the previous bin (or the first available value).
 */
export function mergeSolarWind(plasmaRaw: unknown, magRaw: unknown, now = Date.now()): SolarWindDoc {
  const plasma = readTable(plasmaRaw, 'plasma', { density: 'density', speed: 'speed', temperature: 'temperature' });
  const mag = readTable(magRaw, 'mag', { bz_gsm: 'bz' });
  const binMs = BIN_MINUTES * 60_000;
  const bins = new Map<number, Acc>();
  const zero = (): Record<Field, number> => ({ speed: 0, density: 0, temperature: 0, bz: 0 });
  for (const r of [...plasma, ...mag]) {
    const key = Math.floor(r.t / binMs) * binMs;
    let acc = bins.get(key);
    if (!acc) bins.set(key, (acc = { n: zero(), sum: zero() }));
    for (const f of FIELDS) {
      const v = r[f];
      if (v !== undefined) {
        acc.n[f]++;
        acc.sum[f] += v;
      }
    }
  }
  const keys = [...bins.keys()].filter((k) => k <= now).sort((a, b) => a - b);
  const mean = (acc: Acc, f: Field) => (acc.n[f] ? acc.sum[f] / acc.n[f] : null);
  const firstOf = (f: Field) => {
    for (const k of keys) {
      const v = mean(bins.get(k)!, f);
      if (v !== null) return v;
    }
    return null;
  };
  let lastT = firstOf('temperature');
  let lastBz = firstOf('bz') ?? 0;
  const series: SolarWindRow[] = [];
  for (const k of keys) {
    const acc = bins.get(k)!;
    const speed = mean(acc, 'speed');
    const density = mean(acc, 'density');
    const temperature = mean(acc, 'temperature') ?? lastT;
    const bz = mean(acc, 'bz') ?? lastBz;
    if (temperature !== null) lastT = temperature;
    lastBz = bz;
    if (speed === null || density === null || temperature === null) continue;
    series.push({
      time: new Date(k).toISOString().replace('.000Z', 'Z'),
      speed: round(speed, 1),
      density: round(density, 2),
      temperature: Math.round(temperature),
      bz: round(bz, 2),
    });
  }
  if (series.length < 3) throw new SchemaError(`only ${series.length} usable 10-minute bins`);
  return {
    version: 1,
    voice: 'solar-wind',
    kind: 'live',
    source: 'NOAA SWPC real-time solar wind (plasma-1-day, mag-1-day), 10-minute means',
    spacecraft: 'DSCOVR / ACE (L1)',
    updated: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    series,
  };
}
