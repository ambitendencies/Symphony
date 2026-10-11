"""TRAPPIST-1: seven Earth-sized planets locked in a resonant chain — a real chord."""

from __future__ import annotations

import numpy as np

from .. import synth
from ..mapping import SECONDS_PER_DAY, shared_transposition
from .base import Source, register

# Orbital periods in days (Agol et al. 2021, PSJ 2, 1 — TTV analysis of
# Spitzer/K2/ground photometry). The star is an M8 dwarf 12.4 pc away.
PLANETS = {
    "b": 1.51087,
    "c": 2.42182,
    "d": 4.04961,
    "e": 6.09965,
    "f": 9.20669,
    "g": 12.35294,
    "h": 18.76712,
}

# Near mean-motion resonances between neighbours (outer:inner period ratio),
# Luger et al. 2017 (Nature Astronomy 1, 0129). b:c 8:5, c:d 5:3, d:e 3:2,
# e:f 3:2, f:g 4:3, g:h 3:2 — heard as a minor sixth, major sixth, then fifths
# and a fourth.
RESONANCES = [(8, 5), (5, 3), (3, 2), (3, 2), (4, 3), (3, 2)]

# Audible band for the shared transposition; the chain spans ~3.6 octaves
# (18.77 / 1.51 = 12.4), which fits comfortably, so no folding is needed.
TARGET = (80.0, 1200.0)


def frequencies(planets: list[str] | None = None) -> tuple[dict[str, float], int]:
    """Audible pitch of each planet after ONE common octave shift.

    1/P for planet b is 7.66 µHz; the shared shift is 27 octaves (×1.34e8),
    putting b at ~1028 Hz and h at ~82.8 Hz.
    """
    planets = planets or list(PLANETS)
    f_orbit = 1.0 / (np.array([PLANETS[p] for p in planets]) * SECONDS_PER_DAY)
    shifted, octaves = shared_transposition(f_orbit, target=TARGET)
    return dict(zip(planets, shifted.tolist())), octaves


def period_ratios() -> list[float]:
    """Outer/inner period ratio for each adjacent pair (b:c, c:d, ...)."""
    p = list(PLANETS.values())
    return [p[i + 1] / p[i] for i in range(len(p) - 1)]


def _pluck(freq: float, length: float, sr: int, decay: float) -> np.ndarray:
    """A soft marimba/bell-like note: a few inharmonic-free partials, fast attack."""
    n = int(length * sr)
    t = np.arange(n) / sr
    nyq = 0.45 * sr
    out = np.zeros(n)
    for ratio, amp, dk in [(1, 1.0, 1.0), (2, 0.35, 0.6), (3, 0.15, 0.4), (4, 0.06, 0.3)]:
        f = freq * ratio
        if f < nyq:
            out += amp * np.sin(2 * np.pi * f * t) * np.exp(-t / (decay * dk))
    attack = np.minimum(1.0, t / 0.004)
    return out * attack


@register
class Trappist(Source):
    name = "trappist"
    title = "TRAPPIST-1 — a seven-planet resonant chord"
    science = (
        "TRAPPIST-1, an ultracool red dwarf 40 light-years away, hosts seven "
        "Earth-sized planets with periods from 1.51 days (b) to 18.77 days (h). "
        "Gravity has locked neighbours into a near-resonant chain: period ratios "
        "8:5, 5:3, 3:2, 3:2, 4:3, 3:2 (each within ~1.3%), and every three "
        "neighbours obey a Laplace-like relation, so the system repeats its "
        "pattern like a rhythm. Each orbital frequency 1/P is shifted up by the "
        "SAME 27 octaves (×134 million), so b sounds at ~1028 Hz and h at ~83 Hz "
        "and the intervals you hear ARE the resonances: a minor sixth, a major "
        "sixth, fifths and a fourth. Time is compressed so planet b completes an "
        "orbit (and plays a note) about four times a second; the others play "
        "whenever they finish an orbit, giving a polyrhythm in the same ratios "
        "as the harmony. Under the notes, a soft sustained chord holds all seven "
        "pitches; neighbouring planets alternate left and right. "
        "Inspired by the SYSTEM Sounds TRAPPIST-1 sonification."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        planets = self.options.get("planets", list(PLANETS))
        b_rate = float(self.options.get("b_rate", 4.0))  # orbits of b per audio second
        chord_level = float(self.options.get("chord", 0.35))
        freqs, _ = frequencies(planets)
        n = int(round(duration * sr))
        out = np.zeros((n, 2))
        time_scale = PLANETS["b"] * b_rate  # days of orbital time per audio second

        rng = np.random.default_rng(self.seed)
        # Starting orbital phases: deterministic per seed, otherwise every planet
        # would strike together at t=0.
        phases = rng.uniform(0, 1, len(planets))
        # Interleave neighbours left/right so adjacent (resonant) pairs are
        # heard as separate voices and the stereo image stays balanced.
        pans = np.array([0.7 * (1 if i % 2 else -1) * (0.4 + 0.6 * i / max(1, len(planets) - 1))
                         for i in range(len(planets))])

        t = np.arange(n) / sr
        swell_rate = 1.0 / max(4.0, duration / 2)
        for i, p in enumerate(planets):
            f = freqs[p]
            # Higher planets get shorter notes so the inner ones stay crisp.
            decay = float(np.clip(0.9 * (100.0 / f) ** 0.5, 0.08, 0.6))
            note = _pluck(f, min(duration, decay * 5), sr, decay)
            # Equal-loudness-ish balance: tame the high, frequent b and c.
            gain = (200.0 / f) ** 0.25 / np.sqrt(len(planets))
            orbit_rate = time_scale / PLANETS[p]  # orbits per audio second
            angle = (pans[i] + 1) * np.pi / 4
            lg, rg = np.cos(angle), np.sin(angle)
            k = 0
            while True:
                at = (k + 1 - phases[i]) / orbit_rate  # time this planet completes an orbit
                k += 1
                if at >= duration:
                    break
                s = int(at * sr)
                m = min(len(note), n - s)
                out[s:s + m, 0] += gain * lg * note[:m]
                out[s:s + m, 1] += gain * rg * note[:m]

            # Sustained chord voice: pure-ish tone with a slow, per-planet swell.
            env = 0.6 + 0.4 * np.sin(2 * np.pi * swell_rate * t + 2 * np.pi * phases[i])
            tone = synth.additive(f, duration, [(1, 1.0), (2, 0.2)], sr)[:n]
            cg = chord_level * gain * 0.5
            out[:, 0] += cg * lg * env * tone
            out[:, 1] += cg * rg * env * tone

        return synth.reverb(out.astype(np.float32), room=0.6, wet=0.25, sr=sr)
