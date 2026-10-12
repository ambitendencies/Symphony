/**
 * StationPlayer: one station's ensemble on one audio context.
 *
 *   voice.output ─▶ arrangement fade ─▶ user mix ─▶ role bus ─┬─▶ station fader ─▶ master.input
 *                                                            └─▶ reverb send ───▶ master.reverbSend
 *
 * Works identically on a live AudioContext (driven by the engine's
 * look-ahead loop) and an OfflineAudioContext (driven to the end in one go),
 * which is how the audio-safety tests render every station.
 */

import { activeSlots, movementAt } from './arrangement';
import type { MasterBus } from './master';
import { createClock, createHarmony } from './theory';
import type {
  Clock,
  DataSnapshot,
  Harmony,
  Mood,
  Role,
  StationConfig,
  VoiceDefinition,
  VoiceInstance,
  VoiceMix,
  VoiceSlot,
} from './types';
import { ROLES } from './types';
import { seededRandom } from '../voices/kit';

/** Per-role mixing (PRD "per-voice mixing ... set by its role"). */
export const ROLE_MIX: Record<Role, { gain: number; send: number }> = {
  foundation: { gain: 0.9, send: 0.25 },
  pulse: { gain: 0.7, send: 0.4 },
  harmony: { gain: 0.75, send: 0.45 },
  melody: { gain: 0.7, send: 0.4 },
  texture: { gain: 0.45, send: 0.6 },
  events: { gain: 0.85, send: 0.55 },
};

/** Fade voices in/out over this many bars when the arrangement changes. */
const ENTRY_BARS = 2;
/** How far the other roles dip while an event voice speaks (call and response). */
const DUCK_LEVEL = 0.45;

interface Bus {
  input: GainNode;
  duck: GainNode;
}

interface Live {
  def: VoiceDefinition;
  inst: VoiceInstance;
  fade: GainNode;
  mix: GainNode;
  slotLevel: number;
  role: Role;
  /** Audio time after which the voice is gone (when leaving). */
  leavingAt: number | null;
}

export interface PlayerOptions {
  origin: number;
  seed?: number;
  /** Cap on simultaneous voices (sleep timer lowers it). */
  voiceCap?: number;
  onCaption?: (text: string, voiceId: string, at: number) => void;
}

export class StationPlayer {
  readonly clock: Clock;
  readonly harmony: Harmony;
  readonly fader: GainNode;
  private buses = new Map<Role, Bus>();
  private live = new Map<string, Live>();
  private data = new Map<string, DataSnapshot>();
  private mixes: Record<string, VoiceMix> = {};
  private appliedMovement = -1;
  private nextChange: number;
  private scheduledTo: number;
  private random: () => number;
  voiceCap: number;
  movementIndex = 0;

  constructor(
    private ctx: BaseAudioContext,
    private master: MasterBus,
    readonly station: StationConfig,
    readonly mood: Mood,
    private voices: Map<string, VoiceDefinition>,
    private opts: PlayerOptions,
  ) {
    this.clock = createClock(mood.bpm, mood.beatsPerBar, opts.origin);
    this.harmony = createHarmony(mood, this.clock);
    this.random = seededRandom((opts.seed ?? 1) * 7919 + hash(station.id));
    this.voiceCap = opts.voiceCap ?? mood.maxVoices;
    this.fader = ctx.createGain();
    this.fader.connect(master.input);
    for (const role of ROLES) {
      const input = ctx.createGain();
      input.gain.value = ROLE_MIX[role].gain;
      const duck = ctx.createGain();
      const rev = ctx.createGain();
      rev.gain.value = ROLE_MIX[role].send;
      input.connect(duck);
      duck.connect(this.fader);
      duck.connect(rev).connect(master.reverbSend);
      this.buses.set(role, { input, duck });
    }
    this.nextChange = opts.origin;
    this.scheduledTo = opts.origin;
  }

  /** Voice ids used anywhere in this station (for starting feeds). */
  get voiceIds(): string[] {
    return [...new Set(this.station.movements.flatMap((m) => m.voices.map((v) => v.voice)))].filter((id) =>
      this.voices.has(id),
    );
  }

  get activeVoices(): Array<{ def: VoiceDefinition; inst: VoiceInstance; role: Role; mix: VoiceMix }> {
    return [...this.live.values()]
      .filter((l) => l.leavingAt === null)
      .map((l) => ({ def: l.def, inst: l.inst, role: l.role, mix: this.mixFor(l.def.id) }));
  }

  fadeIn(seconds: number, at = this.ctx.currentTime): void {
    this.fader.gain.setValueAtTime(0, at);
    this.fader.gain.linearRampToValueAtTime(1, at + seconds);
  }

  fadeOut(seconds: number, at = this.ctx.currentTime): void {
    this.fader.gain.cancelScheduledValues(at);
    this.fader.gain.setValueAtTime(this.fader.gain.value, at);
    this.fader.gain.linearRampToValueAtTime(0, at + seconds);
  }

  setData(voiceId: string, snap: DataSnapshot): void {
    this.data.set(voiceId, snap);
    this.live.get(voiceId)?.inst.setData(snap);
  }

  snapshot(voiceId: string): DataSnapshot | undefined {
    return this.data.get(voiceId);
  }

  setMixes(mixes: Record<string, VoiceMix>, at = this.ctx.currentTime): void {
    this.mixes = mixes;
    for (const l of this.live.values()) l.mix.gain.setTargetAtTime(this.mixGain(l.def.id), at, 0.15);
  }

  private mixFor(id: string): VoiceMix {
    return this.mixes[id] ?? { level: 1, muted: false, solo: false };
  }

  private mixGain(id: string): number {
    const anySolo = Object.values(this.mixes).some((m) => m.solo);
    const m = this.mixFor(id);
    if (m.muted || (anySolo && !m.solo)) return 0;
    return Math.max(0, Math.min(1.5, m.level));
  }

  /** Lower the other roles while an event voice speaks, then restore. */
  duck(at: number, holdSeconds: number): void {
    for (const [role, bus] of this.buses) {
      if (role === 'events') continue;
      const g = bus.duck.gain;
      g.cancelScheduledValues(at);
      g.setTargetAtTime(DUCK_LEVEL, at, 0.6);
      g.setTargetAtTime(1, at + Math.max(1, holdSeconds), 1.2);
    }
  }

  /**
   * Advance the arrangement and schedule all voices up to audio time `to`.
   * Safe to call repeatedly with increasing `to`.
   */
  advance(to: number): void {
    while (this.nextChange <= to) this.applyArrangement(this.nextChange);
    const from = this.scheduledTo;
    if (to <= from) return;
    for (const l of this.live.values()) {
      if (l.leavingAt !== null && l.leavingAt <= from) continue;
      try {
        l.inst.schedule(from, to);
      } catch (e) {
        console.error(`[cosmic-radio] ${l.def.id} schedule failed`, e);
      }
    }
    this.scheduledTo = to;
    this.reap(from);
  }

  /** Re-apply the current arrangement now (e.g. the voice cap changed). */
  rearrange(at: number): void {
    this.appliedMovement = -1;
    this.applyArrangement(this.clock.nextBar(at), true);
  }

  private applyArrangement(at: number, keepSchedule = false): void {
    const bar = Math.round(this.clock.barAt(at));
    const { index, startBar } = movementAt(this.station, bar);
    const movement = this.station.movements[index];
    if (!keepSchedule) this.nextChange = this.clock.origin + (startBar + movement.bars) * this.clock.secondsPerBar;
    if (index === this.appliedMovement && !keepSchedule) return;
    this.appliedMovement = index;
    this.movementIndex = index;

    const capMood = { ...this.mood, maxVoices: Math.min(this.mood.maxVoices, this.voiceCap) };
    const slots = activeSlots(this.station, index, capMood, (id) => this.voices.has(id));
    const wanted = new Map<string, VoiceSlot>(slots.map((s) => [s.voice, s]));
    const fadeTime = ENTRY_BARS * this.clock.secondsPerBar;

    // Leaving voices fade over two bars.
    for (const [id, l] of this.live) {
      if (!wanted.has(id) && l.leavingAt === null) {
        l.fade.gain.cancelScheduledValues(at);
        l.fade.gain.setValueAtTime(l.fade.gain.value || 1, at);
        l.fade.gain.linearRampToValueAtTime(0, at + fadeTime);
        l.leavingAt = at + fadeTime;
      }
    }
    // Entering voices and role changes.
    for (const slot of slots) {
      const existing = this.live.get(slot.voice);
      if (existing && existing.leavingAt === null) {
        if (existing.role !== slot.role) {
          existing.inst.setRole(slot.role, at);
          existing.mix.disconnect();
          existing.mix.connect(this.buses.get(slot.role)!.input);
          existing.role = slot.role;
        }
        existing.slotLevel = slot.level ?? 1;
        existing.fade.gain.setTargetAtTime(existing.slotLevel, at, 1);
        continue;
      }
      if (existing) this.drop(slot.voice, at, true);
      this.enter(slot, at, fadeTime);
    }
  }

  private enter(slot: VoiceSlot, at: number, fadeTime: number): void {
    const def = this.voices.get(slot.voice)!;
    const inst = def.create(
      {
        ctx: this.ctx,
        harmony: this.harmony,
        clock: this.clock,
        random: this.random,
        requestDuck: (t, hold) => this.duck(t, hold),
        caption: (text, t) => this.opts.onCaption?.(text, def.id, t),
      },
      slot.role,
    );
    const fade = this.ctx.createGain();
    const level = slot.level ?? 1;
    fade.gain.setValueAtTime(0, at);
    fade.gain.linearRampToValueAtTime(level, at + fadeTime);
    const mix = this.ctx.createGain();
    mix.gain.value = this.mixGain(def.id);
    inst.output.connect(fade).connect(mix).connect(this.buses.get(slot.role)!.input);
    const snap = this.data.get(def.id);
    if (snap) inst.setData(snap);
    this.live.set(def.id, { def, inst, fade, mix, slotLevel: level, role: slot.role, leavingAt: null });
  }

  private drop(id: string, at: number, disconnect: boolean): void {
    const l = this.live.get(id);
    if (!l) return;
    try {
      l.inst.dispose(at);
    } catch (e) {
      console.error(e);
    }
    if (disconnect) l.mix.disconnect();
    this.live.delete(id);
  }

  /**
   * Free voices whose fade-out has finished. `from` runs ahead of the real
   * clock by the look-ahead (up to 2.5 s in background tabs), so wait a margin.
   * Offline, the whole schedule is built before rendering starts, so nodes
   * must stay connected: the voice disposes itself at its own end time.
   */
  private reap(from: number): void {
    const offline = 'startRendering' in this.ctx;
    for (const [id, l] of this.live)
      if (l.leavingAt !== null && l.leavingAt + 3 < from) this.drop(id, l.leavingAt, !offline);
  }

  dispose(at = this.ctx.currentTime): void {
    for (const id of [...this.live.keys()]) this.drop(id, at, true);
    this.fader.disconnect();
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
