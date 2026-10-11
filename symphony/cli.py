"""Command line: list sources, read the science, render solos or the symphony."""

from __future__ import annotations

import argparse
import sys
import textwrap

from .audio import SAMPLE_RATE, write_wav
from .score import default_symphony, solo
from .sources import REGISTRY


def cmd_list(_args) -> int:
    for name in sorted(REGISTRY):
        print(f"{name:<15} {REGISTRY[name].title}")
    return 0


def cmd_info(args) -> int:
    cls = REGISTRY.get(args.source)
    if cls is None:
        print(f"unknown source {args.source!r}", file=sys.stderr)
        return 2
    print(cls.title)
    print("=" * len(cls.title))
    print(textwrap.fill(cls.science, 78))
    return 0


def cmd_render(args) -> int:
    sr = args.rate
    if args.source:
        if args.source not in REGISTRY:
            print(f"unknown source {args.source!r}", file=sys.stderr)
            return 2
        sig = solo(args.source, args.duration, sr)
        out = args.out or f"{args.source}.wav"
    else:
        sym = default_symphony(args.scale)
        print(f"Rendering {sym.title}: {len(sym.movements)} movements, {sym.duration:.0f}s")
        sig = sym.render(sr, progress=lambda i, m: print(f"  {m.title}"))
        out = args.out or "symphony.wav"
    write_wav(out, sig, sr)
    print(f"wrote {out} ({sig.shape[0] / sr:.1f}s)")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="symphony", description="Hear the symphony of space.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="list available space sources").set_defaults(fn=cmd_list)
    pi = sub.add_parser("info", help="explain the physics behind a source")
    pi.add_argument("source")
    pi.set_defaults(fn=cmd_info)
    pr = sub.add_parser("render", help="render the full symphony, or one source with --source")
    pr.add_argument("--source", "-s")
    pr.add_argument("--duration", "-d", type=float, default=20.0, help="solo length in seconds")
    pr.add_argument("--scale", type=float, default=1.0, help="stretch symphony movements")
    pr.add_argument("--rate", type=int, default=SAMPLE_RATE)
    pr.add_argument("--out", "-o")
    pr.set_defaults(fn=cmd_render)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
