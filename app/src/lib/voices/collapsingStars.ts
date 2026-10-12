/**
 * Collapsing Stars — supernova light curves.
 *
 * PRD: "Light curves shape long rises and fades." Each supernova's
 * brightness over its first months (modelled from standard Type Ia and
 * Type II templates using the published rise and decline times) shapes the
 * swell of a soft chord: one real day plays as one second, so a Type Ia rises
 * for ~18 s and fades over a minute, and SN 1987A's slow 84-day climb is a
 * long, patient crescendo.
 *
 * As harmony the supernovae follow one another as a continuous pad; as
 * events, one every few minutes blooms out of silence with a caption.
 */

import { pick } from '../engine/theory';
import type { DataSnapshot, Readout, Role, VoiceDefinition } from '../engine/types';
import { BaseVoice, gridTimes, list, num, str } from './base';
import { createDrone, midiToFreq, TIMBRES } from './kit';
import { formatLy } from './music';

export interface Supernova {
  name: string;
  type: string;
  galaxy: string;
  distanceLy: number;
  riseDays: number;
  declineDays: number;
  plateauDays: number;
  what: string;
}
interface Data {
  supernovae: Supernova[];
}

/** Audio seconds per real day. */
export const SECONDS_PER_DAY = 1;
/** Real days of darkness between supernovae (harmony) / between events (events role). */
const GAP_DAYS = { harmony: 16, events: 150 };

export function parseCollapsingStars(raw: unknown, fallback: boolean): DataSnapshot {
  const doc = raw as Record<string, unknown>;
  const supernovae = list(doc?.supernovae, 'supernovae').map((s, i) => {
    const o = s as Record<string, unknown>;
    return {
      name: str(o.name, `name ${i}`),
      type: str(o.type, `type ${i}`),
      galaxy: str(o.galaxy, `galaxy ${i}`),
      distanceLy: num(o.distanceLy, `distance ${i}`, 1),
      riseDays: num(o.riseDays, `rise ${i}`, 1, 200),
      declineDays: num(o.declineDays, `decline ${i}`, 1, 400),
      plateauDays: num(o.plateauDays, `plateau ${i}`, 0, 300),
      what: str(o.what, `what ${i}`),
    };
  });
  return {
    values: { supernovae: supernovae.length },
    time: String(doc.updated ?? new Date(0).toISOString()),
    source: str(doc.source, 'source'),
    fallback,
    extra: { supernovae },
  };
}

/** Relative brightness 0..1 of a supernova `day` days after explosion. */
export function lightCurve(sn: Supernova, day: number): number {
  if (day <= 0) return 0;
  if (day < sn.riseDays) {
    const u = day / sn.riseDays;
    return u * u * (3 - 2 * u);
  }
  let d = day - sn.riseDays;
  if (sn.plateauDays > 0) {
    if (d < sn.plateauDays) return 1 - 0.25 * (d / sn.plateauDays); // gently sloping plateau
    d -= sn.plateauDays;
    return 0.75 * Math.exp(-d / sn.declineDays);
  }
  return Math.exp(-d / sn.declineDays);
}

/** Length of one supernova's segment in days (until it has faded to ~2%). */
function lifeDays(sn: Supernova): number {
  return sn.riseDays + sn.plateauDays + 4 * sn.declineDays;
}

/** Real days of quiet before each supernova (the rest of the gap comes after it). */
const LEAD_DAYS = 8;

export function supernovaAt(d: Data, seconds: number, gap: number): { sn: Supernova; day: number; index: number } {
  const lengths = d.supernovae.map((s) => lifeDays(s) + gap);
  const total = lengths.reduce((a, b) => a + b, 0);
  let day = (Math.max(0, seconds) / SECONDS_PER_DAY) % total;
  for (let i = 0; i < d.supernovae.length; i++) {
    if (day < lengths[i]) return { sn: d.supernovae[i], day: day - Math.min(LEAD_DAYS, gap / 2), index: i };
    day -= lengths[i];
  }
  return { sn: d.supernovae[0], day: 0, index: 0 };
}

class CollapsingStarsVoice extends BaseVoice<Data> {
  private tones: ReturnType<typeof createDrone>[] = [];
  private chord = -1;
  private captioned = new Set<string>();
  private current: { sn: Supernova; b: number } | null = null;

  private region(): Role {
    return this.role === 'events' ? 'events' : 'harmony';
  }

  protected decode(snap: DataSnapshot): Data {
    return { supernovae: snap.extra!.supernovae as Supernova[] };
  }

  private build(at: number): void {
    const { ctx, harmony } = this.vc;
    const tones = harmony.chordTones(this.region(), at);
    this.tones = [0.15, 0.5, 0.85].map((u, i) =>
      createDrone(ctx, midiToFreq(pick(tones, u)), { timbre: i === 2 ? TIMBRES.sine : TIMBRES.warm, spread: 8, cutoff: 600, level: 0, start: at }),
    );
    for (const t of this.tones) t.output.connect(this.output);
    this.chord = harmony.chordIndexAt(at);
  }

  private teardown(at: number): void {
    for (const t of this.tones) t.stop(at);
    this.tones = [];
  }

  protected onRole(_r: Role, at: number): void {
    this.teardown(at);
    this.build(at);
  }

  protected window(from: number, to: number, d: Data): void {
    const { clock, harmony } = this.vc;
    if (!this.tones.length) this.build(from);
    const ci = harmony.chordIndexAt(to);
    if (ci !== this.chord) {
      this.chord = ci;
      const tones = harmony.chordTones(this.region(), to);
      [0.15, 0.5, 0.85].forEach((u, i) => this.tones[i]?.setFreq(midiToFreq(pick(tones, u)), Math.max(from, clock.nextBar(from)), 6));
    }
    const events = this.role === 'events';
    const gap = events ? GAP_DAYS.events : GAP_DAYS.harmony;
    const base = events ? 0 : 0.06;
    const bright = harmony.mood.brightness;
    for (const t of gridTimes(from, to, 0.5, clock.origin)) {
      const { sn, day } = supernovaAt(d, t - clock.origin, gap);
      const b = lightCurve(sn, day);
      this.tones.forEach((tone, i) => {
        tone.setLevel(base + (events ? 0.2 : 0.14) * b * (1 - i * 0.25), t, 2.5);
        tone.setCutoff((450 + 2600 * b) * (0.6 + 0.6 * bright), t, 2.5);
      });
      if (t <= this.vc.ctx.currentTime + 1 || !this.current) this.current = { sn, b };
      // Caption each supernova once, as it nears its peak.
      if (events && day >= sn.riseDays * 0.9 && day < sn.riseDays * 0.9 + 0.5 && !this.captioned.has(sn.name)) {
        this.captioned.add(sn.name);
        this.vc.caption(`In ${sn.galaxy}, ${formatLy(sn.distanceLy)} away, ${sn.what} (${sn.name})`, t);
      }
    }
  }

  protected onDispose(at: number): void {
    this.teardown(at);
  }

  readout(): Readout {
    if (!this.data) return { headline: 'Collapsing stars: waiting…' };
    const c = this.current;
    if (!c || c.b < 0.02) return { headline: 'Collapsing stars: the sky is quiet', detail: 'The next supernova is on its way' };
    return {
      headline: `${c.sn.name} (Type ${c.sn.type}): ${Math.round(c.b * 100)}% of peak brightness`,
      detail: `In ${c.sn.galaxy}, ${formatLy(c.sn.distanceLy)} away · one day plays as one second`,
    };
  }
}

export const collapsingStars: VoiceDefinition = {
  id: 'collapsing-stars',
  name: 'Collapsing Stars',
  phenomenon: 'Supernovae: exploding stars brightening and fading over months',
  technique: 'sonification',
  color: '#e88f7a',
  roles: ['harmony', 'events'],
  live: false,
  credit: {
    mission: 'Ground and space telescopes worldwide, incl. the Zwicky Transient Facility',
    agency: 'Open Supernova Catalog / Transient Name Server',
    dataset: 'Published supernova discovery and light-curve parameters',
    url: 'https://www.wis-tns.org/',
  },
  cards: [
    { title: 'What it is', body: 'A supernova is a star blowing itself apart: either a white dwarf that ignites (Type Ia) or a massive star whose core collapses (Type II). For weeks it can outshine its whole galaxy, then fades over months as radioactive nickel and cobalt decay.' },
    { title: 'How the sound is made', body: 'A sonification. Each supernova’s brightness over time shapes how a soft chord swells and fades: one real day plays as one second. The curves are standard Type Ia and II shapes fitted to each event’s published rise and decline times.' },
    { title: 'The mission', body: 'Robotic surveys such as the Zwicky Transient Facility scan the sky every night and catch thousands of supernovae a year. SN 2011fe and SN 2023ixf, both in the Pinwheel Galaxy, are among the nearest and best studied of recent decades.' },
  ],
  archive: 'collapsing-stars.json',
  parse: parseCollapsingStars,
  create: (vc, role) => new CollapsingStarsVoice(vc, role),
};
