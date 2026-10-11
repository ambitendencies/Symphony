# Cosmic Radio (and Symphony)

**Cosmic Radio** (`app/`) is a browser-based cosmic receiver: real space-science data turned into calm, layered, in-tune music, organized as radio stations you tune between. See `BUILD_PLAN.md` for the plan against the PRD.

```bash
cd app && npm install
npm run dev            # http://localhost:5173
npm test               # unit tests (vitest)
npm run check          # type-check (svelte-check)
npm run e2e            # headless Chromium: audio-safety renders of every station × mood + page smoke test
npm run build          # static site in app/dist → Cloudflare Pages
```

- **Voices:** Solar Wind (live-capable, sonification), Pulsar Clocks (sonification), Singing Stars (audification of asteroseismic mode frequencies), Black Hole Chirps (audification of a modelled GW waveform).
- **Stations:** Solar Drift, Neutron Focus, Gravity Hymn, Full Cosmos (`app/src/lib/stations/`).
- **Data:** `pipeline/` regenerates the archival files in `app/public/data/` from ATNF, GWOSC and asteroseismology sources (weekly GitHub Action); `worker/` is a Cloudflare Worker that polls NOAA SWPC every 2 minutes. Set `VITE_LIVE_BASE` to the worker URL to enable live solar wind.
- **Honest status:** the dev sandbox could not reach NOAA, GWOSC, MAST or ATNF, so the live path is tested only against fixtures, and the archival values were entered from published papers and still need to be checked by an online pipeline run. The solar-wind archive is a modelled storm, not a recorded one.

The original **Symphony** Python renderer (below) is kept as reference physics and as the basis of the data pipeline.

---

# Symphony (Python renderer)

**Hear space.** Space is nearly silent to human ears (there is no air to carry sound), but it is full of oscillations: planets circling stars, pulsars spinning, black holes merging, plasma waves rippling past spacecraft. Almost all of them lie far outside 20 Hz - 20 kHz. Symphony takes real physical numbers, shifts them into the audible range with transparent, documented mappings, and mixes them into a multi-movement "symphony".

The design rule is that **ratios are preserved**. If two orbits are in a 3:2 resonance you hear a perfect fifth. The music is the physics.

## Three ways to hear space

| Technique | What it does | Used for |
|---|---|---|
| **Audification** | Play a measured (or modelled) waveform directly, time-compressed or stretched so its frequencies land in hearing range | Plasma waves, gravitational-wave chirps |
| **Octave transposition** | Multiply every frequency by the same 2^n, keeping pitch class and all ratios | Planet orbits, TRAPPIST-1, the Perseus black hole (57 octaves) |
| **Parameter mapping** | Map a data value (speed, density, period) onto a musical parameter (pitch, loudness, timbre, rhythm) | Solar wind, pulsar timing |

## Install

```bash
pip install -e .          # needs Python 3.10+ and numpy
pip install -e .[dev]     # adds pytest
python3 -m pytest -q
```

## Usage

```bash
symphony list                              # available sources
symphony info pulsars                      # the physics and the mapping, in words
symphony render -s pulsars -d 20           # one source, 20 s -> pulsars.wav
symphony render -s solar_wind -o wind.wav  # choose the output file
symphony render -o symphony.wav            # the full multi-movement piece
symphony render --rate 48000 --scale 0.5   # sample rate / shorter movements
```

### Live solar wind (experimental)

`symphony/live.py` can fetch the last 24 hours of real solar-wind plasma and IMF data from NOAA SWPC (DSCOVR/ACE at L1) and hand it to the `solar_wind` source:

```python
from symphony.live import fetch_solar_wind
from symphony.score import solo
audio = solo("solar_wind", 30, data=fetch_solar_wind())
```

Honest status: this needs internet access to `services.swpc.noaa.gov`. If the request fails, `fetch_solar_wind` emits a warning and returns the **built-in offline sample** (a hand-built CME arrival modelled on typical L1 observations, not a real recorded event). The parsing code is unit-tested against inline sample JSON; the NOAA endpoints themselves were not reachable from the development sandbox, so the live path has not been verified against the real service. Use `symphony render --live` (solo `-s solar_wind` or the full symphony) to try the live feed.

## Web player

A self-contained browser player (no build step, no dependencies) re-synthesises the same mappings in real time with the Web Audio API, with a live spectrogram, master volume, a "Play all" tour, and a file input for playing a rendered `symphony.wav`.

```bash
open web/index.html                  # or just double-click it
python3 -m http.server -d web 8000   # then visit http://localhost:8000
```

Audio starts only after you press a button (browser autoplay rules). The solar-wind card uses the built-in sample, not live data.

## Sources

| Name | Physics | Real numbers | Technique |
|---|---|---|---|
| `orbits` | The eight planets' orbital frequencies | Mercury 87.969 d ... Neptune 60,189 d; shifted by one shared octave count, folded into 55-1760 Hz | octave transposition |
| `trappist` | TRAPPIST-1's resonant chain of seven planets | 1.51087, 2.42182, 4.04961, 6.09965, 9.20669, 12.35294, 18.76712 d | octave transposition |
| `pulsars` | Rotating neutron-star beams as rhythm | Vela 89.33 ms, Crab 33.7 ms, B0329+54 714.5 ms as rhythm; J0437-4715 5.757 ms and B1937+21 1.5578 ms (642 Hz) heard directly as pitch | parameter mapping + true pitch |
| `gravitational` | GW150914 inspiral chirp (36 + 29 solar masses; detector-frame chirp mass about 30) | rises from 35 Hz to 250 Hz in about 0.2 s, then ringdown | audification |
| `black_hole` | Pressure waves in the Perseus cluster gas (Chandra) | period about 9.6 Myr (about 3.3e-15 Hz), raised 57 octaves to roughly 475 Hz | octave transposition |
| `plasma` | Chorus (rising), whistlers (falling) and hiss, as in Juno Waves and Voyager PWS data | audio-range electromagnetic waves, hundreds of Hz to several kHz | audification |
| `solar_wind` | Solar wind at L1 (DSCOVR/ACE) | speed 300-800 km/s, density 1-30 /cm3, temperature 1e4-1e6 K, Bz +-20 nT | parameter mapping |

Solar wind mapping: speed -> drone pitch (log scale onto 130-520 Hz, pentatonic), density -> crackle rate and loudness, temperature -> brightness, southward Bz -> a dissonant minor-second/tritone layer (geomagnetic storm).

## Project layout

```
symphony/
  audio.py        stereo buffers, normalise, fades, pan, WAV I/O
  synth.py        oscillators, ADSR, noise, filters, reverb
  mapping.py      octave transposition, audification, scale/range mapping
  score.py        Track / Movement / Symphony
  sources/        base.py (plug-in contract) + one module per phenomenon
  live.py         NOAA SWPC real-time solar wind (with offline fallback)
  cli.py          symphony list | info | render
web/index.html    browser player
tests/            core tests, contract tests for every source, solar wind + live
BUILD_PLAN.md     architecture and phases
```

## Adding a source

Create `symphony/sources/my_source.py`, subclass `Source`, decorate with `@register`, and add the module name to `_MODULES` in `symphony/sources/__init__.py`.

```python
import numpy as np
from .. import synth
from .base import Source, register

@register
class Quasar(Source):
    name = "quasar"                    # registry key used by the CLI
    title = "A flickering quasar"
    science = "Explain the physics AND how it is mapped to sound (at least a few sentences)."

    def _render(self, duration: float, sr: int) -> np.ndarray:
        # mono (N,) or stereo (N, 2); length need not be exact
        return 0.5 * synth.sine(220.0, duration, sr)
```

`Source.render` then enforces the contract: stereo float32, exactly `round(duration * sr)` samples, peak at most 0.95, faded edges, no NaNs. Be deterministic (use `np.random.default_rng(self.seed)`), keep frequencies below Nyquist (tests render at 8 kHz), and every registered source is automatically checked by the contract test in `tests/test_core.py`.

## Credits and inspiration

- NASA Chandra X-ray Observatory sonifications, including the Perseus cluster black-hole "sound"
- SYSTEM Sounds (Matt Russo and Andrew Santaguida) for sonifying TRAPPIST-1 and orbital resonances
- NASA Juno Waves and Voyager Plasma Wave Subsystem (PWS) recordings of plasma waves
- LIGO / Virgo / KAGRA and GWOSC (gwosc.org) for gravitational-wave open data and GW150914
- NOAA Space Weather Prediction Center (SWPC) for the real-time DSCOVR/ACE solar-wind products

These are inspirations and data sources; Symphony synthesises its own sound from published physical parameters and is not affiliated with any of these projects.
