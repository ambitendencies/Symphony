/**
 * Shareable deep links (PRD F13): station, mood, custom voice blend and an
 * optional data timestamp, encoded in the query string.
 *
 *   ?s=solar-drift&m=sleep&mix=solar-wind:0.8,pulsar-clocks:0,singing-stars:1.2s&t=2026-10-01T20:00:00Z
 *
 * In `mix`, a level of 0 means muted and a trailing "s" means solo.
 */

import type { MoodId, VoiceMix } from './types';

export interface LinkState {
  station?: string;
  mood?: MoodId;
  mix?: Record<string, VoiceMix>;
  time?: string;
}

const MOODS: MoodId[] = ['drift', 'focus', 'sleep'];
const ID = /^[a-z0-9-]{1,40}$/;

export function encodeLink(state: LinkState): string {
  const p = new URLSearchParams();
  if (state.station) p.set('s', state.station);
  if (state.mood) p.set('m', state.mood);
  if (state.mix) {
    const parts = Object.entries(state.mix)
      .filter(([id]) => ID.test(id))
      .map(([id, m]) => `${id}:${m.muted ? 0 : +m.level.toFixed(2)}${m.solo ? 's' : ''}`);
    if (parts.length) p.set('mix', parts.join(','));
  }
  if (state.time) p.set('t', state.time);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/** Parse untrusted query strings defensively: unknown or malformed parts are dropped. */
export function decodeLink(search: string): LinkState {
  const p = new URLSearchParams(search);
  const out: LinkState = {};
  const s = p.get('s');
  if (s && ID.test(s)) out.station = s;
  const m = p.get('m');
  if (m && (MOODS as string[]).includes(m)) out.mood = m as MoodId;
  const mix = p.get('mix');
  if (mix) {
    const parsed: Record<string, VoiceMix> = {};
    for (const part of mix.split(',').slice(0, 12)) {
      const match = /^([a-z0-9-]{1,40}):(\d+(?:\.\d+)?)(s?)$/.exec(part);
      if (!match) continue;
      const level = Math.min(1.5, Math.max(0, parseFloat(match[2])));
      parsed[match[1]] = { level: level || 1, muted: level === 0, solo: match[3] === 's' };
    }
    if (Object.keys(parsed).length) out.mix = parsed;
  }
  const t = p.get('t');
  if (t && Number.isFinite(Date.parse(t))) out.time = new Date(Date.parse(t)).toISOString();
  return out;
}
