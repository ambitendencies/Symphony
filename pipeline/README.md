# Cosmic Radio data pipeline

Python jobs that rebuild the archival data files the app ships in
`app/public/data/`. Each file uses the same versioned envelope as
`solar-wind.json`:

```json
{ "version": 1, "voice": "<voice id>", "kind": "archive", "source": "…", "updated": "…", … }
```

| Script | Output | Upstream (online) | Offline fallback |
|---|---|---|---|
| `pipeline/pulsars.py` | `pulsar-clocks.json` | ATNF Pulsar Catalogue via `psrqpy` (P0, P1, DM, DIST, RA/Dec) | ATNF values embedded in the script (Manchester et al. 2005) |
| `pipeline/asteroseismology.py` | `singing-stars.json` | Kepler light curves from MAST via `lightkurve`, re-estimating νmax and Δν | Published νmax/Δν (Huber 2011, Metcalfe 2012, Davies 2015, Campante 2015, Lillo-Box 2014) and BiSON solar modes (Broomhall 2009) |
| `pipeline/gw_events.py` | `black-hole-chirps.json` | GWOSC Event Portal API (`/eventapi/json/allevents/`) | GWTC-1 (Abbott et al. 2019) and GW190521 (Abbott et al. 2020) |

The live solar wind is not built here: the Cloudflare Worker in `worker/`
polls NOAA SWPC every two minutes.

## Running

```sh
python -m pipeline.build_all --offline   # no network: rebuild from embedded published values
python -m pipeline.build_all             # fetch upstream; per-source fallback to embedded values on failure
python -m pipeline.build_all --strict    # fetch upstream; fail on any error (no fallback)
python -m pipeline.pulsars --offline --out /tmp/pulsars.json   # one source, custom path
```

Online mode needs `pip install numpy psrqpy lightkurve`. Files are only
rewritten when their content (ignoring `updated`) changes, so the weekly
GitHub Action (`.github/workflows/data.yml`) commits only real updates.

## Honesty notes

- Only the Sun's mode frequencies are measured values. For the other stars
  the pipeline computes l = 0, 1, 2 frequencies from the published global
  parameters with the asymptotic relation ν(n,l) ≈ Δν(n + l/2 + ε) − δν0l
  (Tassoul 1980; red giants: Mosser et al. 2011 universal pattern). Each star
  record has `measuredModes` saying which.
- Pulsar distances are the catalogue's best estimates (`DIST`) and many are
  uncertain by tens of per cent.
- Gravitational-wave "distance" in captions is the light-travel distance
  (lookback time), derived here from the luminosity distance with the
  Planck 2015 cosmology the LVK catalogues use; the luminosity distance is
  kept as `dl_mpc`.
- The embedded values were transcribed from the cited papers/catalogues
  without network access; the first online run (or `--strict`) should be
  used to confirm them.
