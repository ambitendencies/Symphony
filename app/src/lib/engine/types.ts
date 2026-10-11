/**
 * Contracts shared by the engine, the voices, the stations and the UI.
 * Voices and stations are plug-ins: adding one needs no engine change.
 */

export type Role = 'foundation' | 'pulse' | 'harmony' | 'melody' | 'texture' | 'events';
export const ROLES: readonly Role[] = ['foundation', 'pulse', 'harmony', 'melody', 'texture', 'events'];

export type MoodId = 'drift' | 'focus' | 'sleep';

/** Audification = a real waveform sped up; sonification = data mapped onto music. */
export type Technique = 'audification' | 'sonification';

export interface Mood {
  id: MoodId;
  label: string;
  description: string;
  /** Root of the tonal centre as a MIDI note number (may be fractional). */
  rootMidi: number;
  /** Scale degrees as cents above the root, ascending, within one octave. */
  scaleCents: number[];
  /** Chord progression: each chord is a list of scale-degree indices. */
  progression: number[][];
  barsPerChord: number;
  bpm: number;
  beatsPerBar: number;
  /** 0..1 — scales filter cutoffs and upper partials. */
  brightness: number;
  /** Upper bound on simultaneously active voices. */
  maxVoices: number;
  /** 0..1 — scales how often voices are allowed to play notes. */
  density: number;
}

export interface InfoCard {
  title: string;
  body: string;
}

export interface Credit {
  mission: string;
  agency: string;
  dataset: string;
  url: string;
}

/** Latest data for one voice, already validated. */
export interface DataSnapshot {
  /** Named numeric values, e.g. { speed: 412, density: 4.1 }. */
  values: Record<string, number>;
  /** Optional recent window for the mini graph (most recent last). */
  series?: number[];
  /** ISO time of the measurement. */
  time: string;
  /** Plain-language name of where it came from, e.g. "DSCOVR at L1". */
  source: string;
  /** True when this is the archival loop rather than live data. */
  fallback: boolean;
  /**
   * Archival loops: successive measurements (oldest first, each with a `time`
   * epoch-ms field). The feed steps through them so archival stations still
   * change over time, then loops.
   */
  frames?: Array<Record<string, number>>;
  /** Any other per-voice payload (e.g. mode frequencies, a chirp waveform). */
  extra?: Record<string, unknown>;
}

/** What the "What am I hearing?" panel shows for a voice right now. */
export interface Readout {
  /** e.g. "Solar wind: 412 km/s — a calm day". */
  headline: string;
  /** Optional short secondary line. */
  detail?: string;
  /** Values for the tiny live graph. */
  series?: number[];
}

/** An event caption (PRD F18), e.g. "Two black holes … merged". */
export interface EventCaption {
  text: string;
  voiceId: string;
  at: number;
}

export interface Register {
  /** Inclusive MIDI range the role may use. */
  low: number;
  high: number;
}

export interface Harmony {
  readonly mood: Mood;
  /** Index of the current chord in the progression at audio time t. */
  chordIndexAt(t: number): number;
  /** Chord tones (MIDI, fractional for just intonation) for a role at time t, inside its register. */
  chordTones(role: Role, t: number): number[];
  /** Scale tones inside a role's register. */
  scaleTones(role: Role): number[];
  /** Snap a MIDI value to the nearest scale tone (or chord tone) inside the role's register. */
  snap(midi: number, role: Role, t?: number, toChord?: boolean): number;
  register(role: Role): Register;
  /** Root (tonic) MIDI value placed inside a role's register. */
  root(role: Role): number;
}

export interface Clock {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly secondsPerBeat: number;
  readonly secondsPerBar: number;
  /** Audio time the clock was started. */
  readonly origin: number;
  /** Time of the next beat (or bar) boundary at or after t. */
  nextBeat(t: number): number;
  nextBar(t: number): number;
  /** Bar number (float) at time t. */
  barAt(t: number): number;
}

/** Everything a voice needs to make sound. */
export interface VoiceContext {
  ctx: BaseAudioContext;
  harmony: Harmony;
  clock: Clock;
  /** Seeded random in [0,1) — voices must use this, not Math.random, so renders are reproducible. */
  random: () => number;
  /** Ask the engine to duck the other voices (call and response). */
  requestDuck(at: number, holdSeconds: number): void;
  /** Publish a caption for a notable data moment. */
  caption(text: string, at: number): void;
}

export interface VoiceInstance {
  /** Connect this to the role bus. The engine owns the gain after it. */
  readonly output: AudioNode;
  /** The role the voice plays now; the engine calls setRole on arrangement changes. */
  role: Role;
  setRole(role: Role, at: number): void;
  /** New (smoothed) data arrived. Values must glide, never jump. */
  setData(data: DataSnapshot): void;
  /**
   * Look-ahead scheduler callback: schedule every note that starts in [from, to).
   * Called every ~100 ms with a window of ~0.3 s; must be cheap and idempotent per window.
   */
  schedule(from: number, to: number): void;
  readout(): Readout;
  /** Disconnect and free nodes. Called after the engine has faded the voice out. */
  dispose(): void;
}

export interface VoiceDefinition {
  id: string;
  name: string;
  phenomenon: string;
  technique: Technique;
  /** CSS colour for UI rings and accents. */
  color: string;
  /** Roles this voice can play. */
  roles: Role[];
  /** True when the voice has a live feed (otherwise archival). */
  live: boolean;
  credit: Credit;
  /** Exactly three: what it is, how the sound is made, the mission behind the data. */
  cards: [InfoCard, InfoCard, InfoCard];
  /** Relative path (under /data) of the archival snapshot that is always available. */
  archive: string;
  /** Optional live URL; if absent or failing, the archive is used. */
  liveUrl?: string;
  /** Live refresh period in ms (1–5 minutes per PRD F6). */
  refreshMs?: number;
  /** Turn a raw JSON payload (live or archive) into a validated snapshot, or throw. */
  parse(raw: unknown, fallback: boolean): DataSnapshot;
  create(vc: VoiceContext, role: Role): VoiceInstance;
}

export interface VoiceSlot {
  voice: string;
  role: Role;
  /** Linear gain trim, default 1. */
  level?: number;
}

export interface Movement {
  /** Length in bars (the arrangement changes only on bar boundaries). */
  bars: number;
  voices: VoiceSlot[];
}

export interface StationConfig {
  id: string;
  name: string;
  tagline: string;
  mood: MoodId;
  /** Station hue in degrees (the interface takes this colour). */
  hue: number;
  /** One real idea this station teaches, in plain language. */
  lesson: string;
  /** Approximate sky position of the main source (for the star map, F15). */
  sky?: { ra: number; dec: number };
  movements: Movement[];
}

/** Per-voice user mix (Orchestra view, F5). */
export interface VoiceMix {
  level: number; // 0..1.5
  muted: boolean;
  solo: boolean;
}

export interface ActiveVoiceState {
  id: string;
  name: string;
  color: string;
  role: Role;
  technique: Technique;
  live: boolean;
  fallback: boolean;
  dataTime: string | null;
  source: string | null;
  readout: Readout | null;
  mix: VoiceMix;
}

export interface EngineState {
  status: 'idle' | 'starting' | 'playing' | 'tuning' | 'sleeping' | 'stopped';
  stationId: string;
  mood: MoodId;
  volume: number; // 0..1 user volume (always under the hard ceiling)
  voices: ActiveVoiceState[];
  movementIndex: number;
  bar: number;
  chordIndex: number;
  sleepEndsAt: number | null; // epoch ms
  caption: EventCaption | null;
}
