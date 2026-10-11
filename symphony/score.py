"""Arrange sources into movements and a full symphony."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import synth
from .audio import SAMPLE_RATE, fade, n_samples, normalize, soft_limit, to_stereo
from .sources import get


@dataclass
class Track:
    """One source placed in time inside a movement."""
    source: str
    start: float = 0.0
    duration: float | None = None  # None → until the end of the movement
    gain: float = 1.0
    pan: float = 0.0               # applied as a stereo balance on top of the source
    options: dict = field(default_factory=dict)


@dataclass
class Movement:
    title: str
    duration: float
    tracks: list[Track]
    reverb: float = 0.2

    def render(self, sr: int = SAMPLE_RATE) -> np.ndarray:
        total = n_samples(self.duration, sr)
        out = np.zeros((total, 2), dtype=np.float64)
        for tr in self.tracks:
            length = tr.duration if tr.duration is not None else self.duration - tr.start
            length = min(length, self.duration - tr.start)
            if length <= 0:
                continue
            sig = get(tr.source, **tr.options).render(length, sr).astype(np.float64)
            sig *= balance(tr.pan)
            i = n_samples(tr.start, sr)
            k = min(sig.shape[0], total - i)
            out[i:i + k] += tr.gain * sig[:k]
        if self.reverb > 0:
            out = synth.reverb(out.astype(np.float32), room=0.8, wet=self.reverb, sr=sr)
        return fade(normalize(soft_limit(normalize(out, 0.98), 1.2), 0.9), 1.0, 2.0, sr)


def balance(pan: float) -> np.ndarray:
    """Stereo balance gains [L, R] that are unity at centre."""
    return np.array([min(1.0, 1 - pan), min(1.0, 1 + pan)])


@dataclass
class Symphony:
    title: str
    movements: list[Movement]
    gap: float = 1.5

    @property
    def duration(self) -> float:
        return sum(m.duration for m in self.movements) + self.gap * max(0, len(self.movements) - 1)

    def render(self, sr: int = SAMPLE_RATE, progress=None) -> np.ndarray:
        parts = []
        for i, m in enumerate(self.movements):
            if progress:
                progress(i, m)
            parts.append(m.render(sr))
            if i < len(self.movements) - 1:
                parts.append(np.zeros((n_samples(self.gap, sr), 2), dtype=np.float32))
        return np.concatenate(parts).astype(np.float32)


def solo(source: str, duration: float, sr: int = SAMPLE_RATE, **options) -> np.ndarray:
    """Render a single source on its own, with a touch of hall reverb."""
    m = Movement(source, duration, [Track(source, options=options)], reverb=0.15)
    return m.render(sr)


def default_symphony(scale: float = 1.0) -> Symphony:
    """The full 'Symphony of Space'. ``scale`` stretches every movement."""
    from .sources import REGISTRY

    def have(*names: str) -> bool:
        return all(n in REGISTRY for n in names)

    s = scale
    mv: list[Movement] = []
    if have("orbits"):
        mv.append(Movement("I. Music of the Spheres", 40 * s, [
            Track("orbits", gain=0.9),
            *([Track("trappist", start=20 * s, gain=0.6)] if have("trappist") else []),
        ], reverb=0.25))
    if have("solar_wind", "plasma"):
        mv.append(Movement("II. Solar Wind & Plasma Storms", 40 * s, [
            Track("solar_wind", gain=0.7),
            Track("plasma", start=8 * s, gain=0.8),
        ], reverb=0.2))
    if have("pulsars"):
        mv.append(Movement("III. Lighthouses — the Pulsars", 30 * s, [
            Track("pulsars", gain=1.0),
            *([Track("orbits", gain=0.25, options={"planets": ["Jupiter", "Saturn", "Uranus", "Neptune"]})]
              if have("orbits") else []),
        ], reverb=0.3))
    if have("black_hole", "gravitational"):
        mv.append(Movement("IV. Abyss — Black Holes Sing and Collide", 40 * s, [
            Track("black_hole", gain=0.9),
            Track("gravitational", start=25 * s, duration=12 * s, gain=1.0),
        ], reverb=0.35))
    return Symphony("Symphony of Space", mv)


__all__ = ["Track", "Movement", "Symphony", "solo", "default_symphony", "to_stereo"]
