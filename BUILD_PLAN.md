# Symphony — Build Plan

**Goal:** a sonification engine that lets you *hear* space. Space is (almost)
silent to human ears — there's no air to carry pressure waves — but it is full
of oscillations: orbits, pulsar beams, plasma waves, magnetic fields, merging
black holes, pressure waves in galaxy-cluster gas. Almost all of them are far
outside 20 Hz–20 kHz. Symphony takes those real physical signals, shifts them
into the audible range with transparent, documented mappings, and mixes them
into a multi-movement "symphony".

## How you "hear" space — the three techniques

| Technique | What it does | Used for |
|---|---|---|
| **Audification** | Play a measured waveform directly, time-compressed/stretched so its frequencies land in hearing range | Plasma waves (Voyager/Juno), gravitational-wave chirps |
| **Octave transposition** | Multiply a frequency by 2ⁿ so it keeps its pitch class and ratios | Planet orbits, Perseus black-hole pressure wave (57 octaves below middle C) |
| **Parameter mapping** | Map a data value (speed, density, period) onto a musical parameter (pitch, loudness, timbre, rhythm) | Solar wind, pulsar timing, exoplanet resonances |

The key design rule: **ratios are preserved.** If two orbits are in a 3:2
resonance, you hear a perfect fifth. The music is the physics.

## Architecture

```
symphony/
  audio.py        core: sample rate, stereo buffers, normalise, fades, pan, mix, WAV I/O
  synth.py        instruments: oscillators, ADSR, additive/FM tones, noise, filters, reverb
  mapping.py      science→sound: octave transposition, audification, range/scale mapping
  score.py        Track / Movement / Symphony: arrange & render sources into a piece
  sources/
    base.py       Source interface + registry (the plug-in contract)
    orbits.py           Solar-system orbits, octave-shifted ("music of the spheres")
    trappist.py         TRAPPIST-1 resonant chain — a real exoplanet chord
    pulsars.py          Real pulsar periods as rhythm (Vela, Crab, B0329+54, J0437…)
    gravitational.py    GW150914 inspiral chirp (post-Newtonian model)
    black_hole.py       Perseus cluster pressure wave, transposed up 57–58 octaves
    plasma.py           Jupiter/Voyager-style plasma waves: chorus, whistlers, hiss
    solar_wind.py       Solar wind speed/density → drone (offline sample + NOAA live feed)
  live.py         optional live data fetch (NOAA SWPC real-time solar wind)
  cli.py          `symphony list | render | info`
web/
  index.html      browser player: Web Audio synthesis + visualiser, same mappings
tests/            unit tests for core + every source
```

### The plug-in contract (lets work proceed in parallel)

```python
class Source(ABC):
    name: str            # registry key, e.g. "pulsars"
    title: str           # human title
    science: str         # what the physics is and how it's mapped to sound
    def render(self, duration: float, sr: int = SAMPLE_RATE) -> np.ndarray  # (N, 2) float32 in [-1, 1]

@register
class Pulsars(Source): ...
```

Every source must: be deterministic (seeded RNG), return stereo float32 of
exactly `round(duration*sr)` samples, be peak-normalised ≤ 1, contain no NaNs,
and explain its mapping in `science`.

## Phases & ownership

| Phase | Work | Built by |
|---|---|---|
| 0 | This plan, repo scaffold, packaging | Opus 5.5 (main agent) |
| 1 | Core engine: `audio`, `synth`, `mapping`, `score`, `sources/base`, CLI, tests, plus one reference source (`orbits`) | Opus 5.5 (main agent) |
| 2 | Physics sources: `trappist`, `pulsars`, `gravitational`, `black_hole`, `plasma` | Sub-agent — **Opus** |
| 3 | `solar_wind` + `live` (NOAA feed w/ offline fallback), browser player `web/`, README | Sub-agent — **Sonnet** |
| 4 | Integration: full symphony score, render, test run, review of sub-agent code | Opus 5.5 (main agent) |

Phases 2 and 3 run in parallel; they only touch their own files and depend on
the Phase 1 contract.

## Verification
- `pytest` — shape, dtype, range, determinism, no-NaN for every registered source.
- Spectral checks — e.g. the orbits source's dominant frequency ratios match orbital period ratios; the GW chirp's frequency rises monotonically.
- `symphony render --out symphony.wav` produces the full piece end-to-end.

## Stretch ideas
Real data ingestion (NASA CDAWeb CDF files for Juno Waves / Voyager PWS, LIGO
open-data strain via GWOSC), spatial audio (HRTF) placing each body where it
sits in the sky, a real-time mode driven by live spacecraft telemetry.
