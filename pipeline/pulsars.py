"""Pulsar Clocks archive: spin period, spin-down, DM, distance and sky position.

Upstream: the ATNF Pulsar Catalogue (Manchester, Hobbs, Teoh & Hobbs 2005,
AJ 129, 1993; https://www.atnf.csiro.au/research/pulsar/psrcat/), queried with
psrqpy (Pitkin 2018, JOSS 3, 538). Offline: the catalogue values below
(psrcat v2.x; distances are the catalogue's best estimate, ``DIST``).
"""

from __future__ import annotations

import sys
import warnings

from .common import cli, envelope

VOICE = "pulsar-clocks"

# P0 is quoted at each pulsar's catalogue reference epoch (PEPOCH); young pulsars
# slow down measurably (the Crab's P0 is for 1968: 33.39 ms, ~33.7 ms today).
# name, B name, J name, P0 (s), P1 (s/s), DM (pc cm^-3), DIST (kpc), RA (deg), Dec (deg), note
PUBLISHED = [
    ("Vela pulsar", "B0833-45", "J0835-4510", 0.089328385024, 1.25008e-13, 67.97, 0.28, 128.8361, -45.1764,
     "Born in a supernova about 11,000 years ago; glitches (spins up suddenly) every few years."),
    ("Crab pulsar", "B0531+21", "J0534+2200", 0.0333924123, 4.20972e-13, 56.77118, 2.0, 83.6332, 22.0145,
     "The remnant of the supernova Chinese astronomers saw in 1054 AD."),
    ("PSR B0329+54", "B0329+54", "J0332+5434", 0.714519699726, 2.04826e-15, 26.7641, 1.0, 53.2474, 54.5787,
     "The brightest pulsar in the northern sky."),
    ("PSR J0437−4715", "", "J0437-4715", 0.005757451936712637, 5.729e-20, 2.64476, 0.157, 69.3162, -47.2525,
     "The nearest millisecond pulsar, spun up by a white-dwarf companion; one of the steadiest clocks known."),
    ("PSR B1937+21", "B1937+21", "J1939+2134", 0.0015578064688, 1.051193e-19, 71.0227, 2.9, 294.9106, 21.5831,
     "The first millisecond pulsar ever found (1982): 642 turns a second."),
    ("CP 1919, the first pulsar", "B1919+21", "J1921+2153", 1.3373021601895, 1.34809e-15, 12.4437, 0.3, 290.4366, 21.8838,
     "The first pulsar ever discovered, by Jocelyn Bell Burnell in 1967."),
]

SOURCE_OFFLINE = "ATNF Pulsar Catalogue (Manchester et al. 2005), published values embedded in pipeline/pulsars.py"
SOURCE_ONLINE = "ATNF Pulsar Catalogue (Manchester et al. 2005), queried with psrqpy"


def _row(name, bname, jname, p0, p1, dm, dist, ra, dec, note) -> dict:
    return {
        "name": name,
        "bname": bname,
        "jname": jname,
        "p0": p0,
        "p1": p1,
        "dm": dm,
        "dist_kpc": dist,
        "ra_deg": ra,
        "dec_deg": dec,
        "note": note,
    }


def offline_rows() -> list[dict]:
    return [_row(*r) for r in PUBLISHED]


def fetch_rows() -> list[dict]:
    """Query ATNF for the same pulsars. Requires network and ``psrqpy``."""
    import psrqpy  # type: ignore

    names = [r[2] for r in PUBLISHED]
    q = psrqpy.QueryATNF(params=["JNAME", "P0", "P1", "DM", "DIST", "RAJD", "DECJD"], psrs=names)
    table = q.table
    rows = []
    for name, bname, jname, *_rest, note in PUBLISHED:
        match = table[table["JNAME"] == jname]
        if len(match) != 1:
            raise RuntimeError(f"ATNF: {jname} not found")
        m = match[0]
        rows.append(_row(name, bname, jname, float(m["P0"]), float(m["P1"]), float(m["DM"]), float(m["DIST"]),
                         float(m["RAJD"]), float(m["DECJD"]), note))
    return rows


def validate(rows: list[dict]) -> None:
    for r in rows:
        if not (0.001 < r["p0"] < 20):
            raise ValueError(f"{r['name']}: implausible period {r['p0']}")
        if not (0 < r["p1"] < 1e-10) or not (0 < r["dm"] < 2000) or not (0 < r["dist_kpc"] < 30):
            raise ValueError(f"{r['name']}: implausible parameters")


def build(offline: bool, strict: bool = False) -> dict:
    source = SOURCE_OFFLINE
    rows = offline_rows()
    if not offline:
        try:
            rows = fetch_rows()
            source = SOURCE_ONLINE
        except Exception as e:  # network, psrqpy missing, schema change …
            if strict:
                raise
            warnings.warn(f"pulsars: ATNF query failed ({e}); using embedded published values")
    validate(rows)
    return envelope(
        VOICE,
        source,
        citation="Manchester, R. N., Hobbs, G. B., Teoh, A. & Hobbs, M. 2005, AJ 129, 1993",
        url="https://www.atnf.csiro.au/research/pulsar/psrcat/",
        pulsars=rows,
    )


main = cli(__doc__.splitlines()[0], build, f"{VOICE}.json")

if __name__ == "__main__":
    sys.exit(main())
