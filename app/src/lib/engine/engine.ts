/**
 * Engine: the one object the UI talks to.
 *
 * Owns the AudioContext, master bus, data feeds and the current
 * StationPlayer; runs the look-ahead scheduler; handles tuning (static +
 * crossfade, F2), moods (F9), the orchestra mix (F5), the sleep timer (F10),
 * volume under a hard ceiling (F11) and event captions (F18). UI code only
 * calls methods and subscribes to EngineState.
 */

import { startFeed } from '../data/feeds';
import { noiseBuffer, playNote, TIMBRES } from '../voices/kit';
import { createMasterBus, type MasterBus } from './master';
import { StationPlayer } from './player';
import { MOODS, midiToFreq } from './theory';
import type { DataSnapshot, EngineState, EventCaption, MoodId, StationConfig, VoiceDefinition, VoiceMix } from './types';

export const CROSSFADE_SECONDS = 3;
export const SLEEP_FADE_SECONDS = 5 * 60;
const TICK_MS = 100;
const LOOKAHEAD = 0.4;
const HIDDEN_LOOKAHEAD = 2.5; // browsers throttle timers in background tabs
const CAPTION_SECONDS = 9;

type Listener = (s: EngineState) => void;

export interface EngineInit {
  stations: StationConfig[];
  voices: VoiceDefinition[];
  /** Base URL for /data files (default "./"). */
  dataBase?: string;
  /** Inject a context (tests); default creates an AudioContext on start(). */
  createContext?: () => AudioContext;
}

export class Engine {
  private stations: Map<string, StationConfig>;
  private voices: Map<string, VoiceDefinition>;
  private ctx: AudioContext | null = null;
  private master: MasterBus | null = null;
  private player: StationPlayer | null = null;
  private feeds = new Map<string, () => void>();
  private latest = new Map<string, DataSnapshot>();
  private outgoing: StationPlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private mixes: Record<string, Record<string, VoiceMix>> = {};
  private sleepStartVoices = 0;
  private lastEmit = 0;
  private startedAt = Date.now();
  state: EngineState;

  constructor(private init: EngineInit) {
    this.stations = new Map(init.stations.map((s) => [s.id, s]));
    this.voices = new Map(init.voices.map((v) => [v.id, v]));
    const first = init.stations[0];
    this.state = {
      status: 'idle',
      stationId: first.id,
      mood: first.mood,
      volume: 0.8,
      voices: [],
      movementIndex: 0,
      bar: 0,
      chordIndex: 0,
      sleepEndsAt: null,
      caption: null,
    };
  }

  // --- public API -----------------------------------------------------------

  get stationList(): StationConfig[] {
    return [...this.stations.values()];
  }

  get voiceList(): VoiceDefinition[] {
    return [...this.voices.values()];
  }

  station(id = this.state.stationId): StationConfig | undefined {
    return this.stations.get(id);
  }

  voice(id: string): VoiceDefinition | undefined {
    return this.voices.get(id);
  }

  /** For visuals: the master analyser (null before start). */
  get analyser(): AnalyserNode | null {
    return this.master?.analyser ?? null;
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Must be called from a user gesture (browser autoplay rules, iOS). */
  async start(stationId = this.state.stationId, mood?: MoodId): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return this.tune(stationId, mood);
    }
    this.set({ status: 'starting' });
    const ctx = this.init.createContext?.() ?? new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    // iOS: unlock by resuming inside the gesture, and play a silent buffer.
    const unlock = ctx.createBufferSource();
    unlock.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    unlock.connect(ctx.destination);
    unlock.start();
    await ctx.resume();
    this.master = createMasterBus(ctx);
    this.master.setVolume(this.state.volume);
    this.startedAt = Date.now();
    const station = this.stations.get(stationId) ?? this.init.stations[0];
    this.player = this.makePlayer(station, mood ?? station.mood, ctx.currentTime + 0.15);
    this.player.fadeIn(4, ctx.currentTime + 0.1);
    this.set({ status: 'playing', stationId: station.id, mood: mood ?? station.mood });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Tune to a station (and optionally a mood) with static and a crossfade. */
  async tune(stationId: string, mood?: MoodId): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station) return;
    const nextMood = mood ?? (stationId === this.state.stationId ? this.state.mood : station.mood);
    if (!this.ctx || !this.master) {
      this.set({ stationId, mood: nextMood });
      return;
    }
    if (stationId === this.state.stationId && nextMood === this.state.mood && this.player) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.set({ status: 'tuning' });
    this.playStatic(now, CROSSFADE_SECONDS);
    const old = this.player;
    if (old) {
      this.outgoing?.dispose();
      old.fadeOut(CROSSFADE_SECONDS, now);
      this.outgoing = old;
      setTimeout(() => {
        if (this.outgoing === old) this.outgoing = null;
        old.dispose();
      }, (CROSSFADE_SECONDS + 1) * 1000);
    }
    const player = this.makePlayer(station, nextMood, now + 0.05);
    player.fadeIn(CROSSFADE_SECONDS, now + 0.05);
    this.player = player;
    this.playLockChime(now + CROSSFADE_SECONDS * 0.8, player);
    this.set({ stationId, mood: nextMood, movementIndex: 0, caption: null });
    setTimeout(() => this.state.status === 'tuning' && this.set({ status: 'playing' }), CROSSFADE_SECONDS * 1000);
  }

  setMood(mood: MoodId): Promise<void> {
    return this.tune(this.state.stationId, mood);
  }

  setVolume(v: number): void {
    const volume = Math.min(1, Math.max(0, v));
    this.master?.setVolume(volume);
    this.set({ volume });
  }

  /** Orchestra view: mute / solo / level for a voice on the current station. */
  setVoiceMix(voiceId: string, patch: Partial<VoiceMix>): void {
    const sid = this.state.stationId;
    const current = this.mixes[sid] ?? {};
    const prev = current[voiceId] ?? { level: 1, muted: false, solo: false };
    this.mixes[sid] = { ...current, [voiceId]: { ...prev, ...patch } };
    this.player?.setMixes(this.mixes[sid]);
    this.emit(true);
  }

  /** Apply a whole blend at once (deep links, saved stations). */
  setBlend(stationId: string, blend: Record<string, VoiceMix>): void {
    this.mixes[stationId] = { ...blend };
    if (stationId === this.state.stationId) this.player?.setMixes(this.mixes[stationId]);
    this.emit(true);
  }

  blend(stationId = this.state.stationId): Record<string, VoiceMix> {
    return { ...(this.mixes[stationId] ?? {}) };
  }

  /** Sleep timer (F10): 15/30/60/90 minutes, or null to cancel. */
  setSleepTimer(minutes: number | null): void {
    if (minutes === null) {
      this.sleepStartVoices = 0;
      if (this.player) {
        this.player.voiceCap = this.player.mood.maxVoices;
        this.ctx && this.player.rearrange(this.ctx.currentTime);
      }
      this.master?.fadeTo(1, 2);
      this.set({ sleepEndsAt: null, status: this.ctx ? 'playing' : this.state.status });
      return;
    }
    this.sleepStartVoices = 0;
    this.set({ sleepEndsAt: Date.now() + minutes * 60_000 });
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const stopFeed of this.feeds.values()) stopFeed();
    this.feeds.clear();
    this.master?.fadeTo(0, 1.5);
    await new Promise((r) => setTimeout(r, 1600));
    this.player?.dispose();
    this.player = null;
    await this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.set({ status: 'stopped', voices: [], sleepEndsAt: null });
  }

  /** Pause/resume output (Media Session, visibility). */
  async suspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  // --- internals ------------------------------------------------------------

  private makePlayer(station: StationConfig, mood: MoodId, origin: number): StationPlayer {
    const player = new StationPlayer(this.ctx!, this.master!, station, MOODS[mood], this.voices, {
      origin,
      onCaption: (text, voiceId, at) => this.showCaption({ text, voiceId, at }),
    });
    player.setMixes(this.mixes[station.id] ?? {});
    for (const id of player.voiceIds) this.ensureFeed(id);
    return player;
  }

  private ensureFeed(voiceId: string): void {
    const def = this.voices.get(voiceId);
    if (!def) return;
    if (this.feeds.has(voiceId)) {
      const latest = this.latest.get(voiceId);
      if (latest) this.player?.setData(voiceId, latest);
      return;
    }
    const stop = startFeed(
      def,
      (snap) => {
        this.latest.set(voiceId, snap);
        this.player?.setData(voiceId, snap);
        this.emit(true);
      },
      { base: this.init.dataBase ?? './', startedAt: this.startedAt },
    );
    this.feeds.set(voiceId, stop);
  }

  private tick(): void {
    const ctx = this.ctx;
    const player = this.player;
    if (!ctx || !player) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const now = ctx.currentTime;
    const horizon = now + (hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
    player.advance(horizon);
    this.outgoing?.advance(horizon); // still audible during a crossfade
    this.sleepTick(player, now);
    this.emit(false);
  }

  private sleepTick(player: StationPlayer, now: number): void {
    const ends = this.state.sleepEndsAt;
    if (ends === null) return;
    const remaining = (ends - Date.now()) / 1000;
    if (remaining > SLEEP_FADE_SECONDS) return;
    if (this.state.status !== 'sleeping') this.set({ status: 'sleeping' });
    if (!this.sleepStartVoices) this.sleepStartVoices = Math.max(1, player.activeVoices.length);
    // Voices drop out one by one across the final five minutes; the last fades with the master.
    const cap = Math.max(1, Math.ceil((this.sleepStartVoices * remaining) / SLEEP_FADE_SECONDS));
    if (cap < player.voiceCap) {
      player.voiceCap = cap;
      player.rearrange(now);
    }
    if (remaining <= 60 && remaining > 0) this.master?.fadeTo(0, remaining);
    if (remaining <= 0) void this.stop();
  }

  private playStatic(at: number, seconds: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, seconds + 0.5, 3, 'pink');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, at);
    bp.frequency.exponentialRampToValueAtTime(2400, at + seconds * 0.6);
    bp.frequency.exponentialRampToValueAtTime(1200, at + seconds);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.06, at + 0.4);
    g.gain.setValueAtTime(0.06, at + seconds * 0.5);
    g.gain.linearRampToValueAtTime(0, at + seconds);
    src.connect(bp).connect(g).connect(this.master!.input);
    src.start(at);
    src.stop(at + seconds + 0.5);
  }

  private playLockChime(at: number, player: StationPlayer): void {
    const root = player.harmony.root('melody') + 12;
    playNote(this.ctx!, this.master!.input, {
      freq: midiToFreq(root),
      start: at,
      attack: 0.06,
      release: 2.5,
      gain: 0.06,
      timbre: TIMBRES.glass,
      kind: 'chime',
    });
  }

  private showCaption(c: EventCaption): void {
    const delayMs = Math.max(0, (c.at - (this.ctx?.currentTime ?? 0)) * 1000);
    setTimeout(() => {
      this.set({ caption: c });
      setTimeout(() => this.state.caption === c && this.set({ caption: null }), CAPTION_SECONDS * 1000);
    }, delayMs);
  }

  private emit(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 500) return;
    this.lastEmit = now;
    const p = this.player;
    if (!p) return this.notify();
    const t = this.ctx?.currentTime ?? 0;
    this.state = {
      ...this.state,
      movementIndex: p.movementIndex,
      bar: Math.max(0, Math.floor(p.clock.barAt(t))),
      chordIndex: p.harmony.chordIndexAt(t),
      voices: p.activeVoices.map(({ def, inst, role, mix }) => {
        const snap = p.snapshot(def.id) ?? this.latest.get(def.id);
        return {
          id: def.id,
          name: def.name,
          color: def.color,
          role,
          technique: def.technique,
          live: def.live,
          fallback: snap?.fallback ?? true,
          dataTime: snap?.time ?? null,
          source: snap?.source ?? null,
          readout: safe(() => inst.readout()),
          mix,
        };
      }),
    };
    this.notify();
  }

  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
