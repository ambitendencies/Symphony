/**
 * Offline rendering of a station through the real master bus, using
 * OfflineAudioContext. Used by the audio-safety tests (peak, loudness, NaNs)
 * and handy for previews. Runs in any browser; not in Node.
 */

import { createMasterBus } from './master';
import { StationPlayer } from './player';
import { MOODS } from './theory';
import type { DataSnapshot, MoodId, StationConfig, VoiceDefinition } from './types';

export interface RenderResult {
  buffer: AudioBuffer;
  /** Sample peak in dBFS across channels. */
  peakDb: number;
  /** Approximate loudness: K-weighting-free gated RMS in dBFS (a LUFS stand-in). */
  rmsDb: number;
  nonFinite: number;
  captions: string[];
}

export async function renderStation(
  station: StationConfig,
  voices: VoiceDefinition[],
  data: Record<string, DataSnapshot>,
  opts: { mood?: MoodId; seconds?: number; sampleRate?: number } = {},
): Promise<RenderResult> {
  const seconds = opts.seconds ?? 60;
  const sr = opts.sampleRate ?? 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const master = createMasterBus(ctx);
  const mood = MOODS[opts.mood ?? station.mood];
  const captions: string[] = [];
  const origin = 0.05;
  const player = new StationPlayer(ctx, master, station, mood, new Map(voices.map((v) => [v.id, v])), {
    origin,
    onCaption: (text) => captions.push(text),
  });
  player.fadeIn(2, 0);
  for (const [id, snap] of Object.entries(data)) player.setData(id, snap);
  // Advance in small windows, as the live scheduler would.
  for (let t = origin; t < seconds; t += 0.25) player.advance(Math.min(seconds, t + 0.4));
  const buffer = await ctx.startRendering();

  let peak = 0;
  let nonFinite = 0;
  const blockRms: number[] = [];
  const block = Math.floor(0.4 * sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (!Number.isFinite(x)) nonFinite++;
      else if (Math.abs(x) > peak) peak = Math.abs(x);
    }
  }
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  for (let i = 0; i + block <= L.length; i += block) {
    let s = 0;
    for (let j = i; j < i + block; j++) s += (L[j] * L[j] + R[j] * R[j]) / 2;
    blockRms.push(s / block);
  }
  // Absolute gate at −70 dB, as in BS.1770, then mean power.
  const gated = blockRms.filter((p) => p > 1e-7);
  const mean = gated.length ? gated.reduce((a, b) => a + b, 0) / gated.length : 0;
  player.dispose();
  return {
    buffer,
    peakDb: 20 * Math.log10(peak || 1e-9),
    rmsDb: 10 * Math.log10(mean || 1e-12),
    nonFinite,
    captions,
  };
}
