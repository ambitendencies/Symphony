/**
 * The harmony engine's music theory: moods, scales, chord progressions,
 * role registers and pitch snapping. Pure functions — no Web Audio here.
 */

import type { Clock, Harmony, Mood, MoodId, Register, Role } from './types';

const ET = (semis: number[]) => semis.map((s) => s * 100);
/** Just-intonation ratios → cents. */
const JI = (ratios: number[]) => ratios.map((r) => 1200 * Math.log2(r));

export const MOODS: Record<MoodId, Mood> = {
  drift: {
    id: 'drift',
    label: 'Drift',
    description: 'Warm and open. Major pentatonic, unhurried.',
    rootMidi: 50, // D3
    scaleCents: ET([0, 2, 4, 7, 9]),
    // D – Bm – Esus4 – Asus4, from pentatonic degrees (0=D, 1=E, 2=F#, 3=A, 4=B)
    progression: [[0, 2, 3], [4, 0, 2], [1, 3, 4], [3, 0, 1]],
    barsPerChord: 8,
    bpm: 60,
    beatsPerBar: 4,
    brightness: 0.6,
    maxVoices: 5,
    density: 0.6,
  },
  focus: {
    id: 'focus',
    label: 'Focus',
    description: 'Bright, steady, gently pulsing. Lydian.',
    rootMidi: 53, // F3
    scaleCents: ET([0, 2, 4, 6, 7, 9, 11]),
    // F – G – Em – Fmaj7(no3): the raised 4th (B) lives in the G chord
    progression: [[0, 2, 4], [1, 3, 5], [6, 1, 3], [0, 4, 6]],
    barsPerChord: 8,
    bpm: 66,
    beatsPerBar: 4,
    brightness: 0.75,
    maxVoices: 5,
    density: 0.7,
  },
  sleep: {
    id: 'sleep',
    label: 'Sleep',
    description: 'Low, slow and dark. A just-intonation drone.',
    rootMidi: 45, // A2
    // 1, 9/8, 5/4, 3/2, 5/3 — pure intervals, no beating against the drone
    scaleCents: JI([1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]),
    progression: [[0, 2, 3], [0, 3, 4], [0, 1, 3], [0, 2, 3]],
    barsPerChord: 16,
    bpm: 50,
    beatsPerBar: 4,
    brightness: 0.35,
    maxVoices: 4,
    density: 0.35,
  },
};

/**
 * Each role owns a pitch range so layers never crowd each other (PRD
 * "register spacing"). Foundation stays above the 30 Hz rumble cut, texture
 * stays below the 8 kHz softening shelf.
 */
export const REGISTERS: Record<Role, Register> = {
  foundation: { low: 33, high: 45 }, // A1–A2  (55–110 Hz)
  pulse: { low: 57, high: 74 }, //       A3–D5
  harmony: { low: 48, high: 67 }, //     C3–G4
  melody: { low: 62, high: 81 }, //      D4–A5
  texture: { low: 81, high: 98 }, //     A5–D7  (880–2350 Hz)
  events: { low: 40, high: 76 },
};

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function freqToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

/** All scale tones (MIDI, possibly fractional) of a mood within [low, high]. */
export function scaleTonesIn(mood: Mood, low: number, high: number): number[] {
  const out: number[] = [];
  for (let oct = -6; oct <= 6; oct++) {
    for (const c of mood.scaleCents) {
      const m = mood.rootMidi + oct * 12 + c / 100;
      if (m >= low - 1e-9 && m <= high + 1e-9) out.push(m);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Chord tones (from scale-degree indices) within [low, high]. */
export function chordTonesIn(mood: Mood, chord: number[], low: number, high: number): number[] {
  const pcs = chord.map((d) => mood.scaleCents[((d % mood.scaleCents.length) + mood.scaleCents.length) % mood.scaleCents.length] / 100);
  const out: number[] = [];
  for (let oct = -6; oct <= 6; oct++) {
    for (const pc of pcs) {
      const m = mood.rootMidi + oct * 12 + pc;
      if (m >= low - 1e-9 && m <= high + 1e-9) out.push(m);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function nearest(values: number[], x: number): number {
  let best = values[0];
  for (const v of values) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  return best;
}

/** Map a 0..1 value onto the tones of a list (e.g. data → note within the chord). */
export function pick(values: number[], u: number): number {
  const i = Math.min(values.length - 1, Math.max(0, Math.floor(u * values.length)));
  return values[i];
}

export function createHarmony(mood: Mood, clock: Clock): Harmony {
  const scaleCache = new Map<Role, number[]>();
  const reg = (role: Role) => REGISTERS[role];
  const chordIndexAt = (t: number) => {
    const bar = Math.max(0, Math.floor(clock.barAt(t)));
    return Math.floor(bar / mood.barsPerChord) % mood.progression.length;
  };
  return {
    mood,
    chordIndexAt,
    register: reg,
    scaleTones(role) {
      let s = scaleCache.get(role);
      if (!s) {
        s = scaleTonesIn(mood, reg(role).low, reg(role).high);
        scaleCache.set(role, s);
      }
      return s;
    },
    chordTones(role, t) {
      const chord = mood.progression[chordIndexAt(t)];
      return chordTonesIn(mood, chord, reg(role).low, reg(role).high);
    },
    snap(midi, role, t = 0, toChord = false) {
      const pool = toChord ? this.chordTones(role, t) : this.scaleTones(role);
      return nearest(pool, midi);
    },
    root(role) {
      const r = reg(role);
      let m = mood.rootMidi;
      while (m < r.low) m += 12;
      while (m - 12 >= r.low) m -= 12;
      return m;
    },
  };
}

export function createClock(bpm: number, beatsPerBar: number, origin: number): Clock {
  const spb = 60 / bpm;
  const spBar = spb * beatsPerBar;
  const ceilTo = (t: number, step: number) => origin + Math.ceil((t - origin - 1e-9) / step) * step;
  return {
    bpm,
    beatsPerBar,
    secondsPerBeat: spb,
    secondsPerBar: spBar,
    origin,
    nextBeat: (t) => ceilTo(t, spb),
    nextBar: (t) => ceilTo(t, spBar),
    barAt: (t) => (t - origin) / spBar,
  };
}
