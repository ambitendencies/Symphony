"""Music of the spheres: the planets' orbital frequencies, transposed together."""

from __future__ import annotations

import numpy as np

from .. import synth
from ..mapping import MUSICAL, SECONDS_PER_DAY, fold_into, shared_transposition
from .base import Source, register

# Sidereal orbital periods in days (NASA planetary fact sheet).
PLANETS = {
    "Mercury": 87.969,
    "Venus": 224.701,
    "Earth": 365.256,
    "Mars": 686.980,
    "Jupiter": 4332.59,
    "Saturn": 10759.22,
    "Uranus": 30685.4,
    "Neptune": 60189.0,
}


@register
class Orbits(Source):
    name = "orbits"
    title = "Music of the Spheres — the Solar System's orbits"
    science = (
        "Each planet's orbit is a periodic motion with frequency 1/period "
        "(Earth: 1/365.256 days ≈ 31.7 nHz). All eight frequencies are shifted "
        "up by the SAME number of octaves (≈ 33), so every interval between "
        "planets is exactly physical — e.g. Jupiter:Saturn's near 5:2 "
        "resonance is heard as a major tenth. The planets span ~9.5 octaves, so "
        "any that land outside 55–1760 Hz are folded back by whole octaves "
        "(pitch class kept, like voicing a chord). "
        "Each planet also 'pulses' once per orbit time-scaled so Mercury "
        "beats roughly once a second, and is panned by its position around the Sun."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        planets = self.options.get("planets", list(PLANETS))
        periods_s = np.array([PLANETS[p] for p in planets]) * SECONDS_PER_DAY
        freqs, _ = shared_transposition(1.0 / periods_s, target=(80.0, 1200.0))
        freqs = fold_into(freqs, MUSICAL)

        # Orbital "clock": Mercury completes one orbit per `beat` seconds.
        beat = self.options.get("mercury_beat", 1.2)
        time_scale = PLANETS["Mercury"] / beat  # days of real time per second of audio
        t = np.arange(int(duration * sr)) / sr
        out = np.zeros((len(t), 2))
        for i, (planet, f) in enumerate(zip(planets, freqs)):
            orbit_rate = time_scale / PLANETS[planet]  # orbits per audio second
            angle = 2 * np.pi * (orbit_rate * t + i / len(planets))
            # Soft swell once per orbit, plus a slight Doppler-like wobble.
            swell = 0.55 + 0.45 * np.cos(angle) ** 2
            wobble = f * (1 + 0.002 * np.sin(angle))
            tone = synth.additive(wobble, duration, [(1, 1), (2, 0.3), (3, 0.12)], sr)
            gain = 1.0 / np.sqrt(len(planets))
            # pan follows the planet round the sun (x = cos(angle))
            pan = np.cos(angle)
            left = np.cos((pan + 1) * np.pi / 4)
            right = np.sin((pan + 1) * np.pi / 4)
            out[:, 0] += gain * tone[: len(t)] * swell * left
            out[:, 1] += gain * tone[: len(t)] * swell * right
        return synth.reverb(out.astype(np.float32), room=0.7, wet=0.25, sr=sr)


def frequencies(planets: list[str] | None = None) -> dict[str, float]:
    """Audible frequency assigned to each planet (before low-end folding)."""
    planets = planets or list(PLANETS)
    periods_s = np.array([PLANETS[p] for p in planets]) * SECONDS_PER_DAY
    freqs, _ = shared_transposition(1.0 / periods_s, target=(80.0, 1200.0))
    return dict(zip(planets, freqs.tolist()))

