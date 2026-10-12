"""Rebuild every archival data file: ``python -m pipeline.build_all [--offline] [--strict] [--out-dir DIR]``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import asteroseismology, gw_events, pulsars
from .common import DATA_DIR

MODULES = (pulsars, asteroseismology, gw_events)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--out-dir", type=Path, default=DATA_DIR)
    args = ap.parse_args(argv)
    flags = [f for f, on in (("--offline", args.offline), ("--strict", args.strict)) if on]
    for mod in MODULES:
        mod.main([*flags, "--out", str(args.out_dir / f"{mod.VOICE}.json")])
    return 0


if __name__ == "__main__":
    sys.exit(main())
