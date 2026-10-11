/** Voice registry. Add a voice by importing its definition here. */

import type { VoiceDefinition } from '../engine/types';
import { solarWind } from './solarWind';

export const VOICES: VoiceDefinition[] = [solarWind];

/** Every voice the launch stations reference (used by config validation). */
export const LAUNCH_VOICE_IDS = ['solar-wind', 'pulsar-clocks', 'singing-stars', 'black-hole-chirps'];
