/** Voice registry. Add a voice by importing its definition here. */

import type { VoiceDefinition } from '../engine/types';
import { afterglow } from './afterglow';
import { atomicEchoes } from './atomicEchoes';
import { blackHoleChirps } from './blackHoleChirps';
import { collapsingStars } from './collapsingStars';
import { fastRadioBursts } from './fastRadioBursts';
import { planetaryRadio } from './planetaryRadio';
import { pulsarClocks } from './pulsarClocks';
import { resonantWorlds } from './resonantWorlds';
import { singingStars } from './singingStars';
import { solarFlares } from './solarFlares';
import { solarWind } from './solarWind';

export const VOICES: VoiceDefinition[] = [
  solarWind,
  pulsarClocks,
  singingStars,
  blackHoleChirps,
  solarFlares,
  planetaryRadio,
  resonantWorlds,
  afterglow,
  collapsingStars,
  fastRadioBursts,
  atomicEchoes,
];

/** Every voice the stations reference (used by config validation). */
export const LAUNCH_VOICE_IDS = VOICES.map((v) => v.id);
