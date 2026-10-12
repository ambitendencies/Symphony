/** The app's single engine instance, wired to the launch stations and voices. */

import { STATIONS } from '../stations';
import { VOICES } from '../voices';
import { Engine } from './engine';

export const engine = new Engine({ stations: STATIONS, voices: VOICES });

// Exposed for the e2e smoke test and for curious developers.
if (typeof window !== 'undefined') (window as unknown as { __engine: Engine }).__engine = engine;
