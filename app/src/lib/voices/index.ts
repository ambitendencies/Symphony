/** Voice registry. Add a voice by importing its definition here. */

import type { VoiceDefinition } from '../engine/types';
import { blackHoleChirps } from './blackHoleChirps';
import { pulsarClocks } from './pulsarClocks';
import { singingStars } from './singingStars';
import { solarWind } from './solarWind';

export const VOICES: VoiceDefinition[] = [solarWind, pulsarClocks, singingStars, blackHoleChirps];

/** Every voice the launch stations reference (used by config validation). */
export const LAUNCH_VOICE_IDS = ['solar-wind', 'pulsar-clocks', 'singing-stars', 'black-hole-chirps'];
