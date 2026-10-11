/** Pure UI helpers (dial maths, time formatting, saved blends). Unit-tested. */

import type { MoodId, Role, VoiceMix } from '../engine/types';

/** Total sweep of the tuning dial in degrees (centred on 12 o'clock). */
export const DIAL_ARC = 240;

/** Angle (degrees, clockwise from 12 o'clock) of station `i` of `n`. */
export function stationAngle(i: number, n: number, arc = DIAL_ARC): number {
  if (n <= 1) return 0;
  return -arc / 2 + (i * arc) / (n - 1);
}

/** Degrees per station step. */
export function stepAngle(n: number, arc = DIAL_ARC): number {
  return n <= 1 ? arc : arc / (n - 1);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Shortest signed difference between two angles, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Angle in degrees clockwise from 12 o'clock of a point relative to the centre. */
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Fractional station position after dragging from `startPos` by `deltaDeg`. */
export function dragPosition(startPos: number, deltaDeg: number, n: number, arc = DIAL_ARC): number {
  return clamp(startPos + deltaDeg / stepAngle(n, arc), 0, Math.max(0, n - 1));
}

/** Position under an absolute pointer angle (used for tapping a station point). */
export function positionAtAngle(angle: number, n: number, arc = DIAL_ARC): number {
  return clamp((angle + arc / 2) / stepAngle(n, arc), 0, Math.max(0, n - 1));
}

export function nearestIndex(pos: number, n: number): number {
  return clamp(Math.round(pos), 0, Math.max(0, n - 1));
}

/** 0 when exactly on a station, up to 1 midway between two: drives the tuning static. */
export function staticAmount(pos: number): number {
  const d = Math.abs(pos - Math.round(pos));
  return clamp(d * 2, 0, 1);
}

/** "just now", "4 min ago", "3 h ago". */
export function formatAgo(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Remaining sleep time as "h:mm:ss" / "m:ss". */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Normalise a series to 0..1 points in a width×height box for a sparkline path. */
export function sparklinePoints(series: number[] | undefined, width: number, height: number, pad = 2): string {
  if (!series || series.length < 2) return '';
  const clean = series.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return '';
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const span = hi - lo || 1;
  return clean
    .map((v, i) => {
      const x = pad + (i / (clean.length - 1)) * (width - 2 * pad);
      const y = height - pad - ((v - lo) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Circular smoothing step for a hue value (degrees) towards a target. */
export function easeHue(current: number, target: number, k: number): number {
  const d = angleDelta(target, current);
  return (current + d * k + 360) % 360;
}

export const ROLE_LABELS: Record<Role, string> = {
  foundation: 'Foundation',
  pulse: 'Pulse',
  harmony: 'Harmony',
  melody: 'Melody',
  texture: 'Texture',
  events: 'Events',
};

export const TECHNIQUE_LABELS = { audification: 'Audification', sonification: 'Sonification' } as const;

// --- personal stations (saved blends), localStorage, always guarded -----------

export interface SavedBlend {
  id: string;
  name: string;
  station: string;
  mood: MoodId;
  mix: Record<string, VoiceMix>;
}

const KEY = 'cosmic-radio:blends:v1';

export function parseBlends(raw: string | null): SavedBlend[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (b) =>
          b &&
          typeof b.id === 'string' &&
          typeof b.name === 'string' &&
          typeof b.station === 'string' &&
          ['drift', 'focus', 'sleep'].includes(b.mood) &&
          b.mix &&
          typeof b.mix === 'object',
      )
      .slice(0, 12)
      .map((b) => ({
        id: b.id.slice(0, 40),
        name: b.name.slice(0, 60),
        station: b.station,
        mood: b.mood,
        mix: Object.fromEntries(
          Object.entries(b.mix as Record<string, VoiceMix>)
            .filter(([, m]) => m && Number.isFinite(m.level))
            .map(([k, m]) => [k, { level: clamp(m.level, 0, 1.5), muted: !!m.muted, solo: !!m.solo }]),
        ),
      }));
  } catch {
    return [];
  }
}

export function loadBlends(): SavedBlend[] {
  try {
    return parseBlends(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function storeBlends(list: SavedBlend[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
    return true;
  } catch {
    return false;
  }
}
