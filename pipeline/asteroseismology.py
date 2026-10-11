"""Singing Stars archive: solar-like oscillation parameters and mode frequencies.

Upstream: Kepler short-cadence light curves from MAST via lightkurve
(Lightkurve Collaboration 2018), from which νmax and Δν are re-estimated with
``lightkurve.seismology``. The asymptotic-pattern parameters (ε, δν02) and
the Sun's measured BiSON frequencies are published values embedded below.
Offline: everything comes from the published values below.

Mode frequencies for stars other than the Sun are *computed* from the global
parameters with the asymptotic relation for low-degree p modes
(Tassoul 1980, ApJS 43, 469):

    ν(n, l) ≈ Δν (n + l/2 + ε) − δν0l

so the pattern (spacings and ratios) is right, though individual measured
frequencies differ from it by a few µHz. The JSON says which are measured.
"""

from __future__ import annotations

import math
import sys
import warnings

from .common import cli, envelope

VOICE = "singing-stars"

# Sun-as-a-star low-degree p modes near νmax, µHz (BiSON; Broomhall et al. 2009,
# MNRAS 396, L100), rounded to 0.1 µHz. (l, n, ν)
SUN_MODES = [
    (0, 20, 2899.1), (1, 20, 2963.3), (2, 20, 3024.7),
    (0, 21, 3033.8), (1, 21, 3098.2), (2, 21, 3159.0),
    (0, 22, 3168.6),
]

# name, kic, νmax (µHz), Δν (µHz), ε, δν02 (µHz), δν01 (µHz), kind, reference, note
STARS = [
    ("the Sun", None, 3090.0, 135.1, 1.46, 9.0, 3.0, "main sequence",
     "Huber et al. 2011, ApJ 743, 143 (solar νmax, Δν); Broomhall et al. 2009, MNRAS 396, L100 (BiSON modes)",
     "Our own star, heard as a star: its whole surface rises and falls by a few metres per second."),
    ("16 Cygni A", 12069424, 2188.0, 103.78, 1.47, 5.8, 1.9, "main sequence",
     "Metcalfe et al. 2012, ApJ 748, L10; Davies et al. 2015, MNRAS 446, 2959",
     "A Sun-like star 69 light-years away, one of the brightest stars Kepler watched."),
    ("16 Cygni B", 12069449, 2561.0, 117.36, 1.43, 6.6, 2.2, "main sequence",
     "Metcalfe et al. 2012, ApJ 748, L10; Davies et al. 2015, MNRAS 446, 2959",
     "16 Cyg A's twin, with a giant planet on an eccentric orbit."),
    ("Kepler-444", 6278762, 4538.0, 179.64, 1.42, 11.0, 3.6, "main sequence",
     "Campante et al. 2015, ApJ 799, 170",
     "An 11-billion-year-old star with five small planets — the oldest planetary system known when found."),
    ("Kepler-91", 8219268, 109.4, 9.48, None, None, None, "red giant",
     "Lillo-Box et al. 2014, A&A 562, A109 (νmax, Δν); Mosser et al. 2011, A&A 525, L9 (universal pattern)",
     "A swollen red giant that is slowly swallowing its close-in planet; it rings once every 2.5 hours."),
]

SOURCE_OFFLINE = "Published asteroseismic parameters (Kepler; BiSON for the Sun), embedded in pipeline/asteroseismology.py"
SOURCE_ONLINE = "Kepler short-cadence light curves (MAST) via lightkurve; asymptotic parameters from the literature"


def red_giant_pattern(dnu: float) -> tuple[float, float, float]:
    """ε, δν02 and δν01 from the red-giant universal pattern (Mosser et al. 2011)."""
    lg = math.log10(dnu)
    eps = 0.601 + 0.632 * lg
    d02 = (0.131 - 0.033 * lg) * dnu
    d01 = (-0.056 - 0.002 * lg) * dnu  # negative: l=1 sits slightly above the midpoint
    return eps, d02, d01


def asymptotic_modes(numax: float, dnu: float, eps: float, d02: float, d01: float, orders: int = 3) -> list[dict]:
    """Low-degree (l = 0, 1, 2) modes for the radial orders around νmax."""
    n_max = round(numax / dnu - eps)
    out = []
    for n in range(n_max - orders // 2 - 1, n_max + orders // 2 + 2):
        for l, shift in ((0, 0.0), (1, d01), (2, d02)):
            nu = dnu * (n + l / 2 + eps) - shift
            if abs(nu - numax) <= 1.6 * dnu:
                out.append({"l": l, "n": n, "freq": round(nu, 2)})
    return sorted(out, key=lambda m: m["freq"])


def star_record(name, kic, numax, dnu, eps, d02, d01, kind, ref, note) -> dict:
    if eps is None:
        eps, d02, d01 = red_giant_pattern(dnu)
    if kic is None:  # the Sun: measured frequencies
        modes = [{"l": l, "n": n, "freq": f} for l, n, f in SUN_MODES]
        measured = True
    else:
        modes = asymptotic_modes(numax, dnu, eps, d02, d01)
        measured = False
    return {
        "name": name,
        "kic": kic,
        "kind": kind,
        "numax": numax,
        "dnu": dnu,
        "eps": round(eps, 3),
        "d02": round(d02, 3),
        "measuredModes": measured,
        "modes": modes,
        "reference": ref,
        "note": note,
    }


def offline_stars() -> list[dict]:
    return [star_record(*s) for s in STARS]


def fetch_stars() -> list[dict]:
    """Re-estimate νmax and Δν from Kepler light curves (needs network + lightkurve)."""
    import lightkurve as lk  # type: ignore

    out = []
    for name, kic, numax, dnu, eps, d02, d01, kind, ref, note in STARS:
        if kic is not None:
            cadence = "long" if kind == "red giant" else "short"
            lcs = lk.search_lightcurve(f"KIC {kic}", mission="Kepler", cadence=cadence).download_all()
            lc = lcs.stitch().remove_nans().remove_outliers()
            pg = lc.normalize(unit="ppm").to_periodogram(normalization="psd", minimum_frequency=max(1, numax / 3),
                                                         maximum_frequency=numax * 2)
            seis = pg.flatten().to_seismology()
            est_numax = float(seis.estimate_numax().value)
            est_dnu = float(seis.estimate_deltanu().value)
            # Keep the estimate only if it agrees with the literature (guards against a bad fit).
            if abs(est_numax / numax - 1) < 0.1 and abs(est_dnu / dnu - 1) < 0.05:
                numax, dnu = round(est_numax, 1), round(est_dnu, 2)
            else:
                warnings.warn(f"{name}: estimate νmax={est_numax:.0f} Δν={est_dnu:.2f} disagrees; keeping published")
        out.append(star_record(name, kic, numax, dnu, eps, d02, d01, kind, ref, note))
    return out


def validate(stars: list[dict]) -> None:
    for s in stars:
        if not (1 < s["numax"] < 10000) or not (0.1 < s["dnu"] < 500) or len(s["modes"]) < 3:
            raise ValueError(f"{s['name']}: implausible seismic parameters")
        for m in s["modes"]:
            if m["l"] not in (0, 1, 2) or abs(m["freq"] - s["numax"]) > 3 * s["dnu"]:
                raise ValueError(f"{s['name']}: bad mode {m}")


def build(offline: bool, strict: bool = False) -> dict:
    source = SOURCE_OFFLINE
    stars = offline_stars()
    if not offline:
        try:
            stars = fetch_stars()
            source = SOURCE_ONLINE
        except Exception as e:
            if strict:
                raise
            warnings.warn(f"asteroseismology: fetch failed ({e}); using embedded published values")
    validate(stars)
    return envelope(
        VOICE,
        source,
        method="Sun: measured BiSON frequencies. Others: asymptotic relation ν(n,l) ≈ Δν(n + l/2 + ε) − δν0l from published νmax, Δν (Tassoul 1980).",
        url="https://archive.stsci.edu/missions-and-data/kepler",
        stars=stars,
    )


main = cli(__doc__.splitlines()[0], build, f"{VOICE}.json")

if __name__ == "__main__":
    sys.exit(main())
