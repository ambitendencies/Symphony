"""Shared helpers: the versioned JSON envelope, output paths and CLI flags."""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
from pathlib import Path
from typing import Any, Callable

ENVELOPE_VERSION = 1
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "app" / "public" / "data"

# Flat ΛCDM, Planck 2015 (TT+lowP+lensing+ext; Planck Collaboration 2016, A&A 594, A13),
# the cosmology the LVK catalogues (GWTC-1/2) use to convert distance ↔ redshift.
H0_KM_S_MPC = 67.74
OMEGA_M = 0.3075
MPC_KM = 3.0857e19
GYR_S = 3.15576e16


def envelope(voice: str, source: str, *, updated: str | None = None, **payload: Any) -> dict:
    """The versioned archive envelope shared with app/public/data/solar-wind.json."""
    doc = {
        "version": ENVELOPE_VERSION,
        "voice": voice,
        "kind": "archive",
        "source": source,
        "updated": updated or _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    doc.update(payload)
    return doc


def write_json(doc: dict, path: Path) -> bool:
    """Write ``doc`` if its content (ignoring ``updated``) changed. Returns True when written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            old = json.loads(path.read_text())
            if {k: v for k, v in old.items() if k != "updated"} == {k: v for k, v in doc.items() if k != "updated"}:
                return False
        except (ValueError, OSError):
            pass
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    return True


def lookback_gyr(z: float, steps: int = 4000) -> float:
    """Light-travel (lookback) time to redshift z, in Gyr, for flat ΛCDM.

    t_L = (1/H0) ∫₀^z dz' / ((1+z') E(z')),  E(z) = sqrt(Ωm (1+z)³ + 1 − Ωm).
    GW150914 (z = 0.09) → ≈ 1.2 Gyr, i.e. "about 1.2 billion light-years".
    """
    if z <= 0:
        return 0.0
    h = z / steps
    total = 0.0
    for i in range(steps + 1):
        zz = i * h
        f = 1.0 / ((1 + zz) * math.sqrt(OMEGA_M * (1 + zz) ** 3 + 1 - OMEGA_M))
        total += f * (0.5 if i in (0, steps) else 1.0)
    hubble_time_gyr = MPC_KM / H0_KM_S_MPC / GYR_S
    return total * h * hubble_time_gyr


def cli(description: str, build: Callable[[bool, bool], dict], default_name: str) -> Callable[[list[str] | None], int]:
    """Standard command line: ``--offline``, ``--strict`` and ``--out``.

    ``build(offline, strict)`` returns the envelope. Online builds fall back to
    the embedded published values (and say so in ``source``) unless --strict.
    """

    def main(argv: list[str] | None = None) -> int:
        ap = argparse.ArgumentParser(description=description)
        ap.add_argument("--offline", action="store_true", help="rebuild from the embedded published values (no network)")
        ap.add_argument("--strict", action="store_true", help="fail instead of falling back when the network fetch fails")
        ap.add_argument("--out", type=Path, default=DATA_DIR / default_name, help="output JSON path")
        args = ap.parse_args(argv)
        doc = build(args.offline, args.strict)
        changed = write_json(doc, args.out)
        print(f"{args.out}: {'updated' if changed else 'unchanged'} ({doc['source']})")
        return 0

    return main
