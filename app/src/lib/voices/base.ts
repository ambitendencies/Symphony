/**
 * Shared scaffolding for the second wave of voices, so each voice file is
 * about its physics and its sound rather than plumbing.
 *
 * A BaseVoice owns an output gain, remembers its role and latest data, and
 * calls `window(from, to)` only once data has arrived. Subclasses schedule
 * notes with kit.playNote / createDrone into `this.output`.
 */

import type { DataSnapshot, Readout, Role, VoiceContext, VoiceInstance } from '../engine/types';

export abstract class BaseVoice<D = unknown> implements VoiceInstance {
  readonly output: GainNode;
  role: Role;
  protected snap: DataSnapshot | null = null;
  protected data: D | null = null;
  protected lastTo = 0;

  constructor(protected vc: VoiceContext, role: Role) {
    this.role = role;
    this.output = vc.ctx.createGain();
  }

  /** Turn a validated snapshot into the voice's own data shape. */
  protected abstract decode(snap: DataSnapshot): D;
  /** Schedule everything that starts in [from, to). */
  protected abstract window(from: number, to: number, data: D): void;
  abstract readout(): Readout;
  /** Optional hooks. */
  protected onRole(_role: Role, _at: number): void {}
  protected onData(_data: D, _at: number): void {}
  protected onDispose(_at: number): void {}

  setRole(role: Role, at: number): void {
    if (role === this.role) return;
    this.role = role;
    this.onRole(role, at);
  }

  setData(snap: DataSnapshot): void {
    this.snap = snap;
    this.data = this.decode(snap);
    this.onData(this.data, Math.max(this.vc.ctx.currentTime, this.lastTo));
  }

  schedule(from: number, to: number): void {
    this.lastTo = Math.max(this.lastTo, to);
    if (this.data !== null) this.window(from, to, this.data);
  }

  dispose(at: number): void {
    this.onDispose(at);
    const out = this.output;
    setTimeout(() => out.disconnect(), 8000);
  }
}

/** Grid times origin + k·step that fall in [from, to). */
export function gridTimes(from: number, to: number, step: number, origin: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  for (let k = Math.ceil((from - origin - 1e-9) / step); ; k++) {
    const t = origin + k * step;
    if (t >= to) break;
    if (t >= from) out.push(t);
  }
  return out;
}

/** Fold a frequency ratio into [1, 2) by whole octaves (keeps its pitch class). */
export function foldRatio(r: number): number {
  let x = r;
  while (x >= 2) x /= 2;
  while (x < 1) x *= 2;
  return x;
}

/** Validation helper for archive parsers. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error(`invalid archive: ${what}`);
  }
  return value;
}

export function num(x: unknown, what: string, lo = -Infinity, hi = Infinity): number {
  const v = Number(x);
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`invalid archive: ${what} = ${String(x)}`);
  return v;
}

export function str(x: unknown, what: string): string {
  if (typeof x !== 'string' || !x.trim()) throw new Error(`invalid archive: ${what}`);
  return x;
}

export function list(x: unknown, what: string, min = 1): unknown[] {
  if (!Array.isArray(x) || x.length < min) throw new Error(`invalid archive: ${what}`);
  return x;
}
