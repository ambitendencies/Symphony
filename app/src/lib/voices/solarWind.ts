/**
 * Solar Wind — the reference voice.
 *
 * PRD sound design: a breathing drone. Wind speed sets brightness, density
 * sets warmth, magnetic field direction (IMF Bz) sets slow stereo drift.
 * As foundation it holds the mood's root plus the current chord's root;
 * as texture it becomes a quiet, high, airy shimmer on chord tones.
 */

import { clampValue, despike, normalize } from '../engine/smoothing';
import type { DataSnapshot, Readout, Role, VoiceContext, VoiceDefinition, VoiceInstance } from '../engine/types';
import { createDrone, midiToFreq, noiseBuffer, TIMBRES } from './kit';

const SPEED = { min: 250, max: 900 }; // km/s
const DENSITY = { min: 0.5, max: 40 }; // protons / cm³
const BZ = { min: -25, max: 25 }; // nT (GSM)

interface Row {
  time: string;
  speed: number;
  density: number;
  temperature: number;
  bz: number;
}

export function describeSpeed(speed: number): string {
  if (speed < 380) return 'a slow, calm stream';
  if (speed < 480) return 'a calm day';
  if (speed < 600) return 'a brisk high-speed stream';
  if (speed < 750) return 'a gusty, stormy wind';
  return 'a fast storm front';
}

export function parseSolarWind(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as { series?: Row[]; source?: string; spacecraft?: string };
  if (!doc || !Array.isArray(doc.series) || doc.series.length === 0) throw new Error('solar wind: no series');
  const rows = doc.series.filter((r) => r && typeof r.time === 'string' && Number.isFinite(Date.parse(r.time)));
  if (!rows.length) throw new Error('solar wind: no valid rows');
  const clean = (key: 'speed' | 'density' | 'bz' | 'temperature', range: { min: number; max: number }) =>
    despike(rows.map((r) => clampValue(Number(r[key]), range)));
  const speed = clean('speed', SPEED);
  const density = clean('density', DENSITY);
  const bz = clean('bz', BZ);
  const temperature = clean('temperature', { min: 1e3, max: 5e6 });
  const frames = rows.map((r, i) => ({
    time: Date.parse(r.time),
    speed: speed[i],
    density: density[i],
    bz: bz[i],
    temperature: temperature[i],
  }));
  const last = frames[frames.length - 1];
  return {
    values: { speed: last.speed, density: last.density, bz: last.bz, temperature: last.temperature },
    series: speed.slice(-60),
    time: new Date(last.time).toISOString(),
    source: doc.spacecraft ?? 'DSCOVR at L1',
    fallback,
    frames: fallback ? frames : undefined,
  };
}

class SolarWindVoice implements VoiceInstance {
  readonly output: GainNode;
  role: Role;
  private drones: ReturnType<typeof createDrone>[] = [];
  private air: AudioBufferSourceNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private airGain: GainNode | null = null;
  private panner: StereoPannerNode;
  private breath: OscillatorNode;
  private breathDepth: GainNode;
  private body: GainNode;
  private lastChord = -1;
  private data: DataSnapshot | null = null;

  constructor(private vc: VoiceContext, role: Role) {
    const { ctx } = vc;
    this.role = role;
    this.output = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.panner.connect(this.output);

    // Breathing: a very slow LFO (one breath every ~11 s) on the level.
    const body = ctx.createGain();
    body.gain.value = 0.8;
    this.breath = ctx.createOscillator();
    this.breath.frequency.value = 0.09;
    this.breathDepth = ctx.createGain();
    this.breathDepth.gain.value = 0.2;
    this.breath.connect(this.breathDepth).connect(body.gain);
    this.breath.start(ctx.currentTime);
    body.connect(this.panner);
    this.body = body;
    this.build(role, ctx.currentTime);
  }

  private build(role: Role, at: number): void {
    const { ctx, harmony } = this.vc;
    const bright = harmony.mood.brightness;
    if (role === 'foundation' || role === 'harmony') {
      const reg = role === 'foundation' ? 'foundation' : 'harmony';
      const root = harmony.root(reg);
      // Mood root (always) + current chord's lowest tone + a soft fifth above.
      const chordLow = harmony.chordTones(reg, at)[0] ?? root;
      this.drones = [
        createDrone(ctx, midiToFreq(root), { timbre: TIMBRES.warm, level: 0.32, cutoff: 500 * (0.5 + bright), start: at }),
        createDrone(ctx, midiToFreq(chordLow + 12), { timbre: TIMBRES.hollow, level: 0.14, cutoff: 900 * (0.5 + bright), start: at }),
        createDrone(ctx, midiToFreq(root + 19), { timbre: TIMBRES.sine, level: 0.05, cutoff: 2000, start: at }),
      ];
    } else {
      // Texture / other roles: two high, quiet sine shimmers on chord tones.
      const tones = harmony.chordTones('texture', at);
      this.drones = [tones[0], tones[Math.min(1, tones.length - 1)]].map((m, i) =>
        createDrone(ctx, midiToFreq(m), { timbre: TIMBRES.sine, level: 0.05 + 0.02 * i, cutoff: 6000, spread: 12, start: at }),
      );
    }
    for (const d of this.drones) d.output.connect(this.body);

    // Solar "breath": soft filtered noise. Density → loudness (warmth), speed → cutoff (brightness).
    this.air = ctx.createBufferSource();
    this.air.buffer = noiseBuffer(ctx, 6, 11, role === 'texture' ? 'pink' : 'brown');
    this.air.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass';
    this.airFilter.frequency.value = role === 'texture' ? 3000 : 250;
    this.airFilter.Q.value = 0.7;
    this.airGain = ctx.createGain();
    this.airGain.gain.setValueAtTime(0, at);
    this.airGain.gain.linearRampToValueAtTime(0.04, at + 4);
    this.air.connect(this.airFilter).connect(this.airGain).connect(this.body);
    this.air.start(at);
    this.lastChord = harmony.chordIndexAt(at);
    if (this.data) this.apply(this.data, at);
  }

  private teardown(at: number): void {
    for (const d of this.drones) d.stop(at);
    this.drones = [];
    if (this.air && this.airGain) {
      this.airGain.gain.setTargetAtTime(0, at, 0.5);
      this.air.stop(at + 3);
    }
  }

  setRole(role: Role, at: number): void {
    if (role === this.role) return;
    this.role = role;
    this.teardown(at);
    this.build(role, at);
  }

  setData(data: DataSnapshot): void {
    this.data = data;
    this.apply(data, this.vc.ctx.currentTime);
  }

  private apply(data: DataSnapshot, at: number): void {
    const speed = normalize(data.values.speed, SPEED, true);
    const density = normalize(data.values.density, DENSITY, true);
    const bz = normalize(data.values.bz, BZ) * 2 - 1;
    const bright = this.vc.harmony.mood.brightness;
    const glide = 8; // seconds — data never jumps
    const texture = this.role === 'texture';
    // Speed → brightness (filter cutoffs).
    this.drones.forEach((d, i) => {
      const base = texture ? 4000 : [350, 700, 1500][i] ?? 800;
      d.setCutoff(base * (0.6 + 1.4 * speed) * (0.6 + 0.8 * bright), at, glide);
    });
    if (this.airFilter) this.airFilter.frequency.setTargetAtTime((texture ? 2000 : 150) * (1 + 2 * speed), at, glide / 3);
    // Density → warmth: more breath and more low drone.
    if (this.airGain) this.airGain.gain.setTargetAtTime((texture ? 0.015 : 0.03) + 0.05 * density, at, glide / 3);
    if (!texture && this.drones[0]) this.drones[0].setLevel(0.24 + 0.14 * density, at, glide);
    // Bz → slow stereo drift (southward = left, northward = right), never fully hard.
    this.panner.pan.setTargetAtTime(0.45 * bz, at, glide / 2);
    // Faster wind breathes a little faster.
    this.breath.frequency.setTargetAtTime(0.06 + 0.06 * speed, at, glide / 3);
  }

  schedule(from: number, to: number): void {
    // Follow the chord progression: glide the chord-root drone on chord changes.
    const { harmony } = this.vc;
    const idx = harmony.chordIndexAt(to);
    if (idx === this.lastChord || !this.drones.length) return;
    this.lastChord = idx;
    const at = Math.max(from, this.vc.clock.nextBar(from));
    if (this.role === 'texture') {
      const tones = harmony.chordTones('texture', at);
      this.drones.forEach((d, i) => d.setFreq(midiToFreq(tones[Math.min(i, tones.length - 1)]), at, 4));
    } else if (this.drones[1]) {
      const reg = this.role === 'foundation' ? 'foundation' : 'harmony';
      const low = harmony.chordTones(reg, at)[0];
      if (low !== undefined) this.drones[1].setFreq(midiToFreq(low + 12), at, 4);
    }
  }

  readout(): Readout {
    const d = this.data;
    if (!d) return { headline: 'Solar wind: waiting for data…' };
    const v = d.values;
    const dir = v.bz < -5 ? 'southward — auroras likely' : v.bz < 0 ? 'slightly southward' : 'northward — quiet';
    return {
      headline: `Solar wind: ${Math.round(v.speed)} km/s, ${describeSpeed(v.speed)}`,
      detail: `${v.density.toFixed(1)} protons/cm³ · magnetic field ${dir} (${v.bz.toFixed(1)} nT)`,
      series: d.series,
    };
  }

  dispose(): void {
    const t = this.vc.ctx.currentTime;
    this.teardown(t);
    this.breath.stop(t + 3);
    setTimeout(() => this.output.disconnect(), 3500);
  }
}

export const solarWind: VoiceDefinition = {
  id: 'solar-wind',
  name: 'Solar Wind',
  phenomenon: 'Charged particles streaming from the Sun',
  technique: 'sonification',
  color: '#f4a340',
  roles: ['foundation', 'harmony', 'texture'],
  live: true,
  credit: {
    mission: 'DSCOVR and ACE at the Sun–Earth L1 point',
    agency: 'NOAA Space Weather Prediction Center',
    dataset: 'Real-time solar wind plasma and magnetometer (1-day products)',
    url: 'https://www.swpc.noaa.gov/products/real-time-solar-wind',
  },
  cards: [
    {
      title: 'What it is',
      body: 'The Sun constantly blows a thin wind of charged particles into space at 300–800 km/s. It reaches Earth in two to four days, and when its magnetic field points south it can pour energy into our magnetosphere and light up auroras.',
    },
    {
      title: 'How the sound is made',
      body: 'This is a sonification: the numbers shape a drone rather than being a recording. Faster wind makes the drone brighter, denser wind makes it warmer and breathier, and the direction of the magnetic field slowly drifts it left (south) or right (north).',
    },
    {
      title: 'The mission',
      body: 'NOAA’s DSCOVR satellite and NASA’s ACE sit 1.5 million km sunward of Earth at the L1 point, sampling the wind about an hour before it arrives. NOAA publishes their measurements every minute.',
    },
  ],
  archive: 'solar-wind.json',
  refreshMs: 2 * 60_000,
  parse: parseSolarWind,
  create: (vc, role) => new SolarWindVoice(vc, role),
};
