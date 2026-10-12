/**
 * Launch stations (PRD "Launch stations (ensembles)"). Each is pure config:
 * which voices play, in which roles, and for how many bars. Movements run
 * 3–8 minutes; voices enter, leave and swap roles on bar boundaries.
 *
 * Every movement carries 4–6 voices (the PRD's density budget). Bar lengths:
 * Drift 60 BPM → 4 s/bar; Focus 66 BPM → 3.64 s/bar; Sleep 50 BPM → 4.8 s/bar.
 */

import type { StationConfig, VoiceSlot } from '../engine/types';

const v = (voice: string, role: VoiceSlot['role'], level?: number): VoiceSlot => (level === undefined ? { voice, role } : { voice, role, level });

export const SOLAR_DRIFT: StationConfig = {
  id: 'solar-drift',
  name: 'Solar Drift',
  tagline: 'The Sun’s wind, breathing under singing stars',
  mood: 'drift',
  hue: 36, // solar amber
  lesson: 'The Sun blows a wind of charged particles past Earth at hundreds of kilometres per second — you are hearing today’s speed as the brightness of the drone.',
  movements: [
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'harmony'), v('pulsar-clocks', 'pulse', 0.6), v('solar-flares', 'texture', 0.8)] },
    { bars: 64, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'melody'), v('pulsar-clocks', 'pulse', 0.5), v('solar-flares', 'harmony', 0.7), v('planetary-radio', 'texture', 0.7)] },
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'harmony'), v('pulsar-clocks', 'texture', 0.6), v('resonant-worlds', 'pulse', 0.6), v('atomic-echoes', 'melody', 0.6)] },
  ],
};

export const AURORA: StationConfig = {
  id: 'aurora',
  name: 'Aurora',
  tagline: 'The Sun’s weather, and the planets singing back',
  mood: 'drift',
  hue: 140, // aurora green
  lesson: 'When a gust of solar wind or a flare reaches a planet with a magnetic field, the plasma around it rings with radio waves, and the same energy lights the auroras.',
  movements: [
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('solar-flares', 'texture'), v('planetary-radio', 'melody', 0.9), v('singing-stars', 'harmony', 0.7)] },
    { bars: 64, voices: [v('solar-wind', 'foundation'), v('planetary-radio', 'texture'), v('singing-stars', 'harmony', 0.7), v('solar-flares', 'harmony', 0.7), v('fast-radio-bursts', 'melody', 0.7)] },
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('planetary-radio', 'melody', 0.9), v('pulsar-clocks', 'pulse', 0.5), v('solar-flares', 'texture', 0.8), v('collapsing-stars', 'harmony', 0.6)] },
  ],
};

export const NEUTRON_FOCUS: StationConfig = {
  id: 'neutron-focus',
  name: 'Neutron Focus',
  tagline: 'Spinning neutron stars keep time',
  mood: 'focus',
  hue: 198, // pulsar cyan
  lesson: 'A pulsar is a city-sized neutron star spinning many times a second; its radio beam sweeps past Earth like a lighthouse, steadier than most clocks.',
  sky: { ra: 128.84, dec: -45.18 }, // Vela pulsar
  movements: [
    { bars: 56, voices: [v('pulsar-clocks', 'pulse'), v('singing-stars', 'melody', 0.8), v('solar-wind', 'texture', 0.7), v('afterglow', 'foundation', 0.7)] },
    { bars: 72, voices: [v('pulsar-clocks', 'pulse'), v('singing-stars', 'harmony', 0.8), v('solar-wind', 'texture', 0.7), v('afterglow', 'foundation', 0.7), v('fast-radio-bursts', 'melody', 0.7)] },
    { bars: 56, voices: [v('pulsar-clocks', 'melody', 0.8), v('singing-stars', 'harmony', 0.8), v('solar-wind', 'foundation', 0.8), v('resonant-worlds', 'pulse', 0.5), v('atomic-echoes', 'texture', 0.6)] },
  ],
};

export const PLANET_SONG: StationConfig = {
  id: 'planet-song',
  name: 'Planet Song',
  tagline: 'Seven worlds circling a small red star, in resonance',
  mood: 'focus',
  hue: 168, // sea green
  lesson: 'The seven planets of TRAPPIST-1 tug on each other into a chain of simple rhythms: while one orbits three times, its neighbour orbits twice.',
  movements: [
    { bars: 56, voices: [v('resonant-worlds', 'pulse'), v('singing-stars', 'harmony', 0.7), v('solar-wind', 'foundation', 0.8), v('planetary-radio', 'texture', 0.7)] },
    { bars: 72, voices: [v('resonant-worlds', 'pulse'), v('afterglow', 'foundation'), v('planetary-radio', 'texture', 0.8), v('singing-stars', 'harmony', 0.6), v('fast-radio-bursts', 'melody', 0.7)] },
    { bars: 56, voices: [v('resonant-worlds', 'melody', 0.9), v('pulsar-clocks', 'pulse', 0.5), v('afterglow', 'foundation'), v('planetary-radio', 'texture', 0.7), v('solar-flares', 'harmony', 0.6)] },
  ],
};

export const GRAVITY_HYMN: StationConfig = {
  id: 'gravity-hymn',
  name: 'Gravity Hymn',
  tagline: 'Slow chords, and now and then two black holes merge',
  mood: 'sleep',
  hue: 268, // black hole violet
  lesson: 'When two black holes spiral together they shake spacetime itself; LIGO felt these ripples stretch its 4 km arms by less than a proton’s width.',
  movements: [
    { bars: 40, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'harmony', 0.8), v('black-hole-chirps', 'events'), v('collapsing-stars', 'harmony', 0.6), v('atomic-echoes', 'texture', 0.6)] },
    { bars: 60, voices: [v('black-hole-chirps', 'foundation'), v('singing-stars', 'harmony', 0.8), v('solar-wind', 'texture', 0.6), v('collapsing-stars', 'events', 0.8), v('planetary-radio', 'melody', 0.6)] },
    { bars: 40, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'melody', 0.6), v('black-hole-chirps', 'events'), v('afterglow', 'harmony', 0.7), v('atomic-echoes', 'texture', 0.6)] },
  ],
};

export const FIRST_LIGHT: StationConfig = {
  id: 'first-light',
  name: 'First Light',
  tagline: 'The oldest light, exploding stars, and flashes from far galaxies',
  mood: 'sleep',
  hue: 14, // ember
  lesson: 'The microwave glow under everything here left the young universe 13.8 billion years ago, when it was 380,000 years old. Its peaks are the echoes of sound waves in that first plasma.',
  movements: [
    { bars: 40, voices: [v('afterglow', 'foundation'), v('collapsing-stars', 'harmony'), v('fast-radio-bursts', 'texture'), v('atomic-echoes', 'melody', 0.7)] },
    { bars: 48, voices: [v('afterglow', 'foundation'), v('singing-stars', 'harmony', 0.7), v('atomic-echoes', 'texture'), v('collapsing-stars', 'events'), v('fast-radio-bursts', 'melody', 0.7)] },
    { bars: 40, voices: [v('afterglow', 'foundation'), v('collapsing-stars', 'harmony'), v('atomic-echoes', 'melody', 0.8), v('fast-radio-bursts', 'texture'), v('solar-flares', 'texture', 0.6)] },
  ],
};

export const FULL_COSMOS: StationConfig = {
  id: 'full-cosmos',
  name: 'Full Cosmos',
  tagline: 'Every voice, in evolving movements',
  mood: 'drift',
  hue: 350, // stellar rose
  lesson: 'Everything here is real measurement turned into music — some sped-up waveforms (audification), some numbers mapped to notes (sonification).',
  movements: [
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'harmony'), v('pulsar-clocks', 'pulse', 0.6), v('solar-flares', 'texture', 0.7), v('planetary-radio', 'melody', 0.7)] },
    { bars: 64, voices: [v('black-hole-chirps', 'foundation'), v('solar-wind', 'texture', 0.6), v('singing-stars', 'melody', 0.8), v('pulsar-clocks', 'pulse', 0.5), v('afterglow', 'harmony', 0.6), v('atomic-echoes', 'texture', 0.5)] },
    { bars: 64, voices: [v('solar-wind', 'foundation'), v('singing-stars', 'harmony', 0.8), v('pulsar-clocks', 'texture', 0.6), v('black-hole-chirps', 'events'), v('fast-radio-bursts', 'melody', 0.7), v('collapsing-stars', 'harmony', 0.6)] },
    { bars: 48, voices: [v('solar-wind', 'foundation'), v('pulsar-clocks', 'melody', 0.7), v('singing-stars', 'harmony', 0.8), v('black-hole-chirps', 'events'), v('atomic-echoes', 'texture', 0.6), v('solar-flares', 'texture', 0.6)] },
    { bars: 56, voices: [v('afterglow', 'foundation'), v('resonant-worlds', 'pulse'), v('planetary-radio', 'texture', 0.8), v('singing-stars', 'harmony', 0.7), v('fast-radio-bursts', 'melody', 0.7)] },
    { bars: 56, voices: [v('solar-wind', 'foundation'), v('solar-flares', 'texture'), v('fast-radio-bursts', 'melody', 0.8), v('collapsing-stars', 'harmony', 0.8), v('atomic-echoes', 'texture', 0.6)] },
  ],
};

export const STATIONS: StationConfig[] = [SOLAR_DRIFT, AURORA, NEUTRON_FOCUS, PLANET_SONG, GRAVITY_HYMN, FIRST_LIGHT, FULL_COSMOS];
export const DEFAULT_STATION = SOLAR_DRIFT.id;
