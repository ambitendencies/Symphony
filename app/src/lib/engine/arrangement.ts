/**
 * Arrangement: which voices play which roles, movement by movement.
 * Changes happen only on bar boundaries (PRD F4). Pure — no Web Audio.
 */

import type { Mood, Role, StationConfig, VoiceSlot } from './types';

/** Priority when the mood's voice budget forces voices out (first kept). */
const ROLE_PRIORITY: Role[] = ['foundation', 'harmony', 'pulse', 'melody', 'events', 'texture'];

export function totalBars(station: StationConfig): number {
  return station.movements.reduce((n, m) => n + m.bars, 0);
}

/** Movement index and the bar at which it started, for an absolute bar number (loops forever). */
export function movementAt(station: StationConfig, bar: number): { index: number; startBar: number } {
  const total = totalBars(station);
  let start = Math.floor(bar / total) * total;
  for (let i = 0; i < station.movements.length; i++) {
    const end = start + station.movements[i].bars;
    if (bar < end) return { index: i, startBar: start };
    start = end;
  }
  return { index: station.movements.length - 1, startBar: start - station.movements[station.movements.length - 1].bars };
}

/** Next bar (strictly after `bar`) at which the movement changes. */
export function nextChangeBar(station: StationConfig, bar: number): number {
  const { index, startBar } = movementAt(station, Math.floor(bar));
  return startBar + station.movements[index].bars;
}

/**
 * Active slots for a movement under a mood: drops voices that are not
 * available, then trims to the mood's voice budget by role priority.
 */
export function activeSlots(
  station: StationConfig,
  movementIndex: number,
  mood: Mood,
  available: (voiceId: string) => boolean = () => true,
): VoiceSlot[] {
  const slots = station.movements[movementIndex].voices.filter((s) => available(s.voice));
  const ranked = [...slots].sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));
  const kept = new Set(ranked.slice(0, mood.maxVoices));
  return slots.filter((s) => kept.has(s));
}

/** Validation errors for a station config (empty list = valid). */
export function validateStation(station: StationConfig, knownVoices?: Set<string>): string[] {
  const errors: string[] = [];
  if (!station.movements.length) errors.push('no movements');
  station.movements.forEach((m, i) => {
    const where = `${station.id} movement ${i}`;
    if (m.bars < 1 || !Number.isInteger(m.bars)) errors.push(`${where}: bars must be a positive integer`);
    if (m.voices.length < 3) errors.push(`${where}: needs at least three voices (F3)`);
    for (const role of ['foundation', 'melody'] as Role[]) {
      if (m.voices.filter((v) => v.role === role).length > 1) errors.push(`${where}: more than one ${role}`);
    }
    const ids = m.voices.map((v) => v.voice);
    if (new Set(ids).size !== ids.length) errors.push(`${where}: a voice appears twice`);
    if (knownVoices) for (const id of ids) if (!knownVoices.has(id)) errors.push(`${where}: unknown voice ${id}`);
  });
  return errors;
}
