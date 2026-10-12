# Cosmic Radio — Build Plan (v2, from the Oct 11 2026 PRD)

The PRD changes the product from an offline renderer (Symphony v0.1, a Python
CLI) into **Cosmic Radio**: a public, browser-only "cosmic receiver" whose
stations layer several real space-science voices into one calm, in-tune,
evolving piece, with a teaching layer and live data.

The Python package stays. It becomes the **archival data pipeline** and the
reference physics (its mappings and tests carry over).

## Decisions and deviations from the PRD

| PRD says | Plan | Why |
|---|---|---|
| SvelteKit (or Next.js) | **Svelte 5 + Vite + TypeScript**, a single static page | One screen, no routing, so Kit adds weight and nothing else; deep links use the query string; deploys as static files to Cloudflare Pages exactly the same |
| Web Audio + Tone.js + AudioWorklets | **Plain Web Audio** with a small look-ahead scheduler, plus an AudioWorklet-free resampler (data is pre-resampled by the pipeline) | Keeps the bundle well under 300 KB gz; the engine needs only a clock, envelopes and buses; can adopt Tone.js later if needed |
| WebGL starfield (Three.js/regl) | **Canvas 2D** starfield first, with WebGL as a later upgrade | PRD allows a Canvas fallback; cheaper and safer for 60 fps on mid-range phones |
| Live NOAA via Cloudflare Worker cron | Worker written (`worker/`) and tested locally; the app also reads a bundled archival snapshot | NOAA/GWOSC/MAST/ATNF are unreachable from the dev sandbox, so live paths are written to spec and verified with recorded fixtures only |
| Kepler/TESS via lightkurve, GWOSC via gwpy | `pipeline/` scripts (for GitHub Actions) that fetch real data; the repo ships **published values** (mode frequencies, masses, periods) with citations | Same sandbox limitation. Every voice says which it is |

## Architecture

```
app/                       the web app (static build → Cloudflare Pages)
  src/lib/engine/
    types.ts               contracts: Role, Mood, VoiceDefinition, VoiceInstance, StationConfig, DataSnapshot
    theory.ts              harmony: scales (incl. just intonation), chord progression, role registers, pitch snapping
    smoothing.ts           data easing (2–10 s), outlier clamping
    clock.ts               master clock (50–70 BPM), bar/beat maths
    arrangement.ts         movements → which voices play which role, on bar boundaries
    master.ts              master bus: 30 Hz HPF, 8 kHz shelf, hall reverb, compressor, limiter, hard ceiling
    engine.ts              Engine: context, role buses, ducking, tuning + static + crossfade, mute/solo/level, sleep timer, state for the UI
    deeplink.ts            station / mood / blend / data time ⇄ URL
  src/lib/voices/          one file per cosmic voice (registry in index.ts)
  src/lib/stations/        station arrangement configs (Solar Drift, Neutron Focus, Gravity Hymn, Full Cosmos)
  src/lib/data/            feeds: live fetch + staleness + archival fallback
  src/lib/ui/              Svelte components: Arrival, Receiver dial, Hearing panel, Orchestra, Mood & timer, Starfield
  public/data/             archival station data (JSON) produced by the pipeline
  tests/                   vitest: theory, smoothing, arrangement, deep links, configs
  e2e/                     headless Chromium: page smoke test + OfflineAudioContext loudness/peak checks per station
worker/                    Cloudflare Worker: cron polls NOAA SWPC every 2 min → R2/KV JSON with schema checks
pipeline/                  Python jobs (GitHub Actions): build archival JSON for pulsars, singing stars, GW chirps
symphony/                  v0.1 Python engine (reference physics; reused by pipeline/)
```

## P0 coverage

| PRD | Where |
|---|---|
| F1 one-tap play | `ui/Arrival` → `engine.start()` |
| F2 dial, static, 2–4 s crossfade | `ui/Receiver`, `engine.tune()` |
| F3 ≥3 voices, one key & tempo | station configs + `theory` + `clock` |
| F4 evolving arrangements on musical boundaries | `arrangement.ts` |
| F5 orchestra view mute/solo/level | `ui/Orchestra`, `engine.setVoiceMix()` |
| F6 live refresh without glitches | `data/feeds` + `smoothing` (values glide) |
| F7 archival fallback with label | `data/feeds` (`fallback` flag → UI badge) |
| F8 "What am I hearing?" | `ui/HearingPanel` + `VoiceInstance.readout()` + info cards |
| F9 moods | `theory.MOODS` |
| F10 sleep timer, voices drop out over 5 min | `engine.setSleepTimer()` |
| F11 volume + hard ceiling | `master.ts` (user gain is pre-limiter, ceiling −1 dBFS) |
| F12 credit + technique label | `VoiceDefinition.credit/technique` |
| F13 deep links | `deeplink.ts` |

## Phases & ownership

| Phase | Work | Built by |
|---|---|---|
| A | This plan; app scaffold; engine core (types, theory, smoothing, clock, arrangement, master, engine, deeplink); Solar Wind reference voice; station configs; unit tests | Opus 5.5 (main) |
| B | Voices: Pulsar Clocks, Singing Stars, Black Hole Chirps; archival data files; `pipeline/`; `worker/` | Sub-agent — **Opus** |
| C | UI: arrival, receiver dial with tuning static, hearing panel, orchestra view, mood & sleep timer, starfield, ambient mode, accessibility, deep links wiring, PWA manifest | Sub-agent — **Sonnet** |
| D | Integration, audio-safety e2e (peak/loudness per station via OfflineAudioContext), bundle-size check, review | Opus 5.5 (main) |

## Gates (from the PRD: prove the sound first)
1. Every station renders 60 s offline with peak ≤ −1 dBFS, no NaNs, and station loudness within ±3 dB of each other.
2. Unit tests and type-check pass; the production bundle is < 300 KB gzipped.
3. The page loads with no console errors on desktop and mobile widths, and sound starts on the first tap.
4. **Not automatable here:** the PRD's 30-minute listening test with five outside listeners, real-device iOS/Android testing, live-feed verification against real NOAA data.
