/**
 * Launch stations (PRD "Launch stations (ensembles)"). Each is pure config:
 * which voices play, in which roles, and for how many bars. Movements run
 * 3–8 minutes; voices enter, leave and swap roles on bar boundaries.
 *
 * Bar lengths: Drift 60 BPM → 4 s/bar; Focus 66 BPM → 3.64 s/bar;
 * Sleep 50 BPM → 4.8 s/bar.
 */

import type { StationConfig } from '../engine/types';

export const SOLAR_DRIFT: StationConfig = {
  id: 'solar-drift',
  name: 'Solar Drift',
  tagline: 'The Sun’s wind, breathing under singing stars',
  mood: 'drift',
  hue: 36, // solar amber
  lesson: 'The Sun blows a wind of charged particles past Earth at hundreds of kilometres per second — you are hearing today’s speed as the brightness of the drone.',
  movements: [
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony' },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.6 },
    ] },
    { bars: 64, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'melody' },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.5 },
    ] },
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony' },
      { voice: 'pulsar-clocks', role: 'texture', level: 0.6 },
    ] },
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
    { bars: 56, voices: [
      { voice: 'pulsar-clocks', role: 'pulse' },
      { voice: 'singing-stars', role: 'melody', level: 0.8 },
      { voice: 'solar-wind', role: 'texture', level: 0.7 },
    ] },
    { bars: 72, voices: [
      { voice: 'pulsar-clocks', role: 'pulse' },
      { voice: 'singing-stars', role: 'harmony', level: 0.8 },
      { voice: 'solar-wind', role: 'texture', level: 0.7 },
    ] },
    { bars: 56, voices: [
      { voice: 'pulsar-clocks', role: 'melody', level: 0.8 },
      { voice: 'singing-stars', role: 'harmony', level: 0.8 },
      { voice: 'solar-wind', role: 'foundation', level: 0.8 },
    ] },
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
    { bars: 40, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony', level: 0.8 },
      { voice: 'black-hole-chirps', role: 'events' },
    ] },
    { bars: 60, voices: [
      { voice: 'black-hole-chirps', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony', level: 0.8 },
      { voice: 'solar-wind', role: 'texture', level: 0.6 },
    ] },
    { bars: 40, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'melody', level: 0.6 },
      { voice: 'black-hole-chirps', role: 'events' },
    ] },
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
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony' },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.6 },
    ] },
    { bars: 64, voices: [
      { voice: 'black-hole-chirps', role: 'foundation' },
      { voice: 'solar-wind', role: 'texture', level: 0.6 },
      { voice: 'singing-stars', role: 'melody', level: 0.8 },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.5 },
    ] },
    { bars: 64, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony' },
      { voice: 'pulsar-clocks', role: 'texture', level: 0.6 },
      { voice: 'black-hole-chirps', role: 'events' },
    ] },
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'pulsar-clocks', role: 'melody', level: 0.7 },
      { voice: 'singing-stars', role: 'harmony', level: 0.8 },
      { voice: 'black-hole-chirps', role: 'events' },
    ] },
    { bars: 56, voices: [
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'resonant-worlds', role: 'pulse', level: 0.8 },
      { voice: 'planetary-radio', role: 'texture', level: 0.8 },
      { voice: 'singing-stars', role: 'harmony', level: 0.7 },
    ] },
    { bars: 56, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'solar-flares', role: 'texture' },
      { voice: 'fast-radio-bursts', role: 'melody', level: 0.8 },
      { voice: 'collapsing-stars', role: 'harmony', level: 0.8 },
      { voice: 'atomic-echoes', role: 'texture', level: 0.6 },
    ] },
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
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'solar-flares', role: 'texture' },
      { voice: 'planetary-radio', role: 'melody', level: 0.9 },
    ] },
    { bars: 64, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'planetary-radio', role: 'texture' },
      { voice: 'singing-stars', role: 'harmony', level: 0.7 },
      { voice: 'solar-flares', role: 'harmony', level: 0.7 },
    ] },
    { bars: 48, voices: [
      { voice: 'solar-wind', role: 'foundation' },
      { voice: 'planetary-radio', role: 'melody', level: 0.9 },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.5 },
      { voice: 'solar-flares', role: 'texture', level: 0.8 },
    ] },
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
    { bars: 56, voices: [
      { voice: 'resonant-worlds', role: 'pulse' },
      { voice: 'singing-stars', role: 'harmony', level: 0.7 },
      { voice: 'solar-wind', role: 'foundation', level: 0.8 },
    ] },
    { bars: 72, voices: [
      { voice: 'resonant-worlds', role: 'pulse' },
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'planetary-radio', role: 'texture', level: 0.8 },
      { voice: 'singing-stars', role: 'harmony', level: 0.6 },
    ] },
    { bars: 56, voices: [
      { voice: 'resonant-worlds', role: 'melody', level: 0.9 },
      { voice: 'pulsar-clocks', role: 'pulse', level: 0.5 },
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'planetary-radio', role: 'texture', level: 0.7 },
    ] },
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
    { bars: 40, voices: [
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'collapsing-stars', role: 'harmony' },
      { voice: 'fast-radio-bursts', role: 'texture' },
    ] },
    { bars: 48, voices: [
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'singing-stars', role: 'harmony', level: 0.7 },
      { voice: 'atomic-echoes', role: 'texture' },
      { voice: 'collapsing-stars', role: 'events' },
    ] },
    { bars: 40, voices: [
      { voice: 'afterglow', role: 'foundation' },
      { voice: 'collapsing-stars', role: 'harmony' },
      { voice: 'atomic-echoes', role: 'melody', level: 0.8 },
      { voice: 'fast-radio-bursts', role: 'texture' },
    ] },
  ],
};

export const STATIONS: StationConfig[] = [SOLAR_DRIFT, AURORA, NEUTRON_FOCUS, PLANET_SONG, GRAVITY_HYMN, FIRST_LIGHT, FULL_COSMOS];
export const DEFAULT_STATION = SOLAR_DRIFT.id;
