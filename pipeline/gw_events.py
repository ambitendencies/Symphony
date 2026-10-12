"""Black Hole Chirps archive: compact-binary mergers with published parameters.

Upstream: the GWOSC Event Portal API (https://gwosc.org/eventapi/), which
serves the LIGO–Virgo–KAGRA catalogue median source-frame masses, luminosity
distances and redshifts. Offline: the GWTC-1 values (Abbott et al. 2019,
PRX 9, 031040, Table III) and GW190521 (Abbott et al. 2020, PRL 125, 101102)
embedded below. Final spins come from the same papers (GWOSC does not list them).

Light-travel distance (lookback time) is derived from the luminosity distance
with the Planck 2015 cosmology the catalogues use — it is the "1.2 billion
light-years" people quote, not the (larger) luminosity distance.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
import warnings

from .common import H0_KM_S_MPC, OMEGA_M, cli, envelope, lookback_gyr

VOICE = "black-hole-chirps"
GWOSC_URL = "https://gwosc.org/eventapi/json/allevents/"

# name, kind, m1, m2, final mass, final spin, D_L (Mpc), z, UTC date, detectors, reference
PUBLISHED = [
    ("GW150914", "BBH", 35.6, 30.6, 63.1, 0.69, 440.0, 0.09, "2015-09-14T09:50:45Z", "H1 L1",
     "Abbott et al. 2019, PRX 9, 031040 (GWTC-1)"),
    ("GW151226", "BBH", 13.7, 7.7, 20.5, 0.74, 450.0, 0.09, "2015-12-26T03:38:53Z", "H1 L1",
     "Abbott et al. 2019, PRX 9, 031040 (GWTC-1)"),
    ("GW170104", "BBH", 30.8, 20.0, 48.9, 0.66, 990.0, 0.20, "2017-01-04T10:11:58Z", "H1 L1",
     "Abbott et al. 2019, PRX 9, 031040 (GWTC-1)"),
    ("GW170814", "BBH", 30.6, 25.2, 53.2, 0.72, 580.0, 0.12, "2017-08-14T10:30:43Z", "H1 L1 V1",
     "Abbott et al. 2019, PRX 9, 031040 (GWTC-1)"),
    ("GW170817", "BNS", 1.46, 1.27, 2.8, 0.0, 40.0, 0.01, "2017-08-17T12:41:04Z", "H1 L1 V1",
     "Abbott et al. 2019, PRX 9, 031040 (GWTC-1)"),
    ("GW190521", "BBH", 85.0, 66.0, 142.0, 0.72, 5300.0, 0.82, "2019-05-21T03:02:29Z", "H1 L1 V1",
     "Abbott et al. 2020, PRL 125, 101102"),
]

SOURCE_OFFLINE = "LIGO–Virgo catalogue values (GWTC-1; GW190521 discovery paper), embedded in pipeline/gw_events.py"
SOURCE_ONLINE = "GWOSC Event Portal API (gwosc.org), LIGO–Virgo–KAGRA catalogue medians"


def chirp_mass(m1: float, m2: float) -> float:
    return (m1 * m2) ** 0.6 / (m1 + m2) ** 0.2


def luminosity_distance_mpc(z: float, steps: int = 2000) -> float:
    """D_L = (1+z) (c/H0) ∫₀^z dz'/E(z') for flat ΛCDM."""
    h = z / steps
    total = 0.0
    for i in range(steps + 1):
        zz = i * h
        total += (0.5 if i in (0, steps) else 1.0) / math.sqrt(OMEGA_M * (1 + zz) ** 3 + 1 - OMEGA_M)
    return (1 + z) * 299792.458 / H0_KM_S_MPC * total * h


def redshift_from_distance(dl_mpc: float) -> float:
    """Invert D_L(z) by bisection."""
    lo, hi = 0.0, 5.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if luminosity_distance_mpc(mid) < dl_mpc:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def event_record(name, kind, m1, m2, mf, spin, dl, z, date, detectors, ref) -> dict:
    return {
        "name": name,
        "kind": kind,
        "m1": m1,
        "m2": m2,
        "mchirp": round(chirp_mass(m1, m2), 2),
        "mfinal": mf,
        "spin": spin,
        "dl_mpc": dl,
        "z": z,
        "lookback_gyr": round(lookback_gyr(redshift_from_distance(dl)), 3),
        "date": date,
        "detectors": detectors,
        "reference": ref,
    }


def offline_events() -> list[dict]:
    return [event_record(*e) for e in PUBLISHED]


def fetch_events(timeout: float = 30) -> list[dict]:
    """Refresh masses, distances and redshifts from GWOSC (latest version of each event)."""
    with urllib.request.urlopen(GWOSC_URL, timeout=timeout) as r:
        events = json.load(r)["events"]
    latest: dict[str, dict] = {}
    for key, ev in events.items():
        name = ev.get("commonName") or key.split("-v")[0]
        if ev.get("mass_1_source") is None or ev.get("luminosity_distance") is None:
            continue
        if name not in latest or int(ev.get("version", 0)) > int(latest[name].get("version", 0)):
            latest[name] = ev
    out = []
    for name, kind, m1, m2, mf, spin, dl, z, date, detectors, ref in PUBLISHED:
        ev = latest.get(name)
        if ev is None:
            raise RuntimeError(f"GWOSC: {name} missing")
        out.append(event_record(
            name, kind, float(ev["mass_1_source"]), float(ev["mass_2_source"]),
            float(ev.get("final_mass_source") or mf), spin, float(ev["luminosity_distance"]),
            float(ev.get("redshift") or z), date, detectors, f"GWOSC {ev.get('catalog.shortName', '')}; {ref}".strip()))
    return out


def validate(events: list[dict]) -> None:
    for e in events:
        if not (0.5 < e["m2"] <= e["m1"] < 300) or not (1 < e["dl_mpc"] < 20000) or not (0 <= e["spin"] < 1):
            raise ValueError(f"{e['name']}: implausible parameters")
        if e["kind"] == "BBH" and not (e["mfinal"] < e["m1"] + e["m2"]):
            raise ValueError(f"{e['name']}: final mass must be below the total (energy is radiated)")


def build(offline: bool, strict: bool = False) -> dict:
    source = SOURCE_OFFLINE
    events = offline_events()
    if not offline:
        try:
            events = fetch_events()
            source = SOURCE_ONLINE
        except Exception as e:
            if strict:
                raise
            warnings.warn(f"gw events: GWOSC fetch failed ({e}); using embedded published values")
    validate(events)
    return envelope(
        VOICE,
        source,
        cosmology="Flat ΛCDM, H0 = 67.74 km/s/Mpc, Ωm = 0.3075 (Planck 2015)",
        url="https://gwosc.org/eventapi/",
        events=events,
    )


main = cli(__doc__.splitlines()[0], build, f"{VOICE}.json")

if __name__ == "__main__":
    sys.exit(main())
