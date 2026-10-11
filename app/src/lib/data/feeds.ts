/**
 * Data feeds: live where possible, archival loop otherwise (PRD F6, F7).
 *
 * - Live data is fetched with a timeout, validated by the voice's parser and
 *   rejected if stale; any failure falls back to the bundled archive.
 * - Archival snapshots with `frames` are stepped through over time so they
 *   still evolve, then loop.
 */

import type { DataSnapshot, VoiceDefinition } from '../engine/types';

/** Live data older than this is treated as stale (F7). */
export const STALE_AFTER_MS = 30 * 60_000;
/** Seconds of listening per archival frame. */
export const ARCHIVE_FRAME_SECONDS = 20;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Base URL for live JSON published by the worker, e.g. "https://data.cosmicradio.app/". */
export function liveBase(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_LIVE_BASE || null;
}

export function archiveUrl(def: VoiceDefinition, base = './'): string {
  return `${base}data/${def.archive}`;
}

async function fetchJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface LoadOptions {
  fetcher?: Fetcher;
  base?: string;
  now?: number;
  timeoutMs?: number;
}

/** Load the best available snapshot for a voice: live, else archive. */
export async function loadSnapshot(def: VoiceDefinition, opts: LoadOptions = {}): Promise<DataSnapshot> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const live = def.liveUrl ?? (def.live && liveBase() ? `${liveBase()}${def.archive}` : null);
  if (live) {
    try {
      const snap = def.parse(await fetchJson(fetcher, live, timeoutMs), false);
      const age = now - Date.parse(snap.time);
      if (!(age <= STALE_AFTER_MS)) throw new Error(`stale (${Math.round(age / 60000)} min old)`);
      return snap;
    } catch (e) {
      console.warn(`[cosmic-radio] ${def.id}: live data unavailable, using archive —`, (e as Error).message);
    }
  }
  return def.parse(await fetchJson(fetcher, archiveUrl(def, opts.base), timeoutMs), true);
}

/** The frame of an archival loop to play `elapsedSeconds` into listening. */
export function archiveFrame(snap: DataSnapshot, elapsedSeconds: number): DataSnapshot {
  const frames = snap.frames;
  if (!frames || frames.length === 0) return snap;
  const i = Math.floor(Math.max(0, elapsedSeconds) / ARCHIVE_FRAME_SECONDS) % frames.length;
  const { time, ...values } = frames[i];
  const lo = Math.max(0, i - 59);
  const key = Object.keys(snap.values)[0];
  return {
    ...snap,
    values: { ...snap.values, ...values },
    time: new Date(time).toISOString(),
    series: key ? frames.slice(lo, i + 1).map((f) => f[key]) : snap.series,
  };
}

/**
 * Keep a voice fed: loads now, refreshes live data every `refreshMs`, and
 * steps archival frames. Returns a stop function.
 */
export function startFeed(
  def: VoiceDefinition,
  onData: (snap: DataSnapshot) => void,
  opts: LoadOptions & { startedAt?: number } = {},
): () => void {
  let stopped = false;
  let snap: DataSnapshot | null = null;
  const startedAt = opts.startedAt ?? Date.now();
  const emit = () => {
    if (!snap || stopped) return;
    onData(snap.fallback ? archiveFrame(snap, (Date.now() - startedAt) / 1000) : snap);
  };
  const load = async () => {
    try {
      snap = await loadSnapshot(def, opts);
      emit();
    } catch (e) {
      console.error(`[cosmic-radio] ${def.id}: no data at all`, e);
    }
  };
  void load();
  const timers = [
    setInterval(() => void load(), Math.min(5, Math.max(1, (def.refreshMs ?? 120_000) / 60_000)) * 60_000),
    setInterval(emit, ARCHIVE_FRAME_SECONDS * 1000),
  ];
  return () => {
    stopped = true;
    timers.forEach(clearInterval);
  };
}
