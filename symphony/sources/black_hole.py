"""The Perseus black hole's 'song': a pressure wave 57 octaves below hearing."""

from __future__ import annotations

import numpy as np

from .. import synth
from ..mapping import SECONDS_PER_YEAR, freq_to_midi
from .base import Source, register

# Fabian et al. 2003 (MNRAS 344, L43) found ripples in the X-ray gas of the
# Perseus cluster, ~250 million light-years away, driven by the central
# black hole's outbursts. Ripple spacing ~11 kpc ÷ sound speed ~1170 km/s
# gives a period of ~9.6 million years — the lowest note known in the
# Universe. NASA's 2022 sonification shifted it up 57 and 58 octaves.
PERIOD_YEARS = 9.6e6
OCTAVES = 57


def perseus_frequency(octaves: int = 0) -> float:
    """Frequency (Hz) of the Perseus pressure wave shifted up ``octaves``.

    Natively 1/(9.6 Myr) = 3.30e-15 Hz. ×2^57 (=1.44e17) gives 475.7 Hz, i.e.
    B-flat 4 (466.16 Hz) +35 cents — the B-flat just above middle C, so the
    native note is "a B-flat 57 octaves below" it. ×2^58 = 951 Hz (B-flat 5).
    """
    return 2.0 ** octaves / (PERIOD_YEARS * SECONDS_PER_YEAR)


def note_name(freq: float) -> tuple[str, float]:
    """Nearest equal-tempered note and deviation in cents."""
    names = ["C", "C#", "D", "E♭", "E", "F", "F#", "G", "A♭", "A", "B♭", "B"]
    midi = float(freq_to_midi(freq))
    k = int(round(midi))
    return f"{names[k % 12]}{k // 12 - 1}", 100 * (midi - k)


@register
class BlackHole(Source):
    name = "black_hole"
    title = "Perseus — the black hole that sings B-flat"
    science = (
        "In 2003 NASA's Chandra X-ray Observatory found concentric ripples in "
        "the hot gas filling the Perseus galaxy cluster: sound waves, pumped "
        "out by the supermassive black hole at its heart. Their spacing and "
        "the sound speed in the gas give a period of ~9.6 million years — a "
        "frequency of 3.3e-15 Hz, a B-flat 57 octaves below the one above "
        "middle C. Shifting it up exactly 57 octaves (×1.44e17) puts it at "
        "~476 Hz (B-flat 4, +35 cents); we build a dark drone on that pitch "
        "class: the 57- and 58-octave voices NASA used, plus 54–56-octave "
        "voices for weight, each with odd and even harmonics, slightly "
        "detuned left/right for width. Every few seconds a 'ripple' rolls "
        "outward: the drone swells and its filter opens, and the sound spreads "
        "from the centre to the edges of the stereo field, as the real waves "
        "spread from the black hole. An optional M87-style radar sweep scans "
        "around the image, its pan tracing the scan angle."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        octaves = self.options.get("octaves", [54, 55, 56, 57, 58])
        ripple_period = float(self.options.get("ripple_period", 6.0))  # audio s per ripple
        sweep = bool(self.options.get("sweep", True))
        n = int(round(duration * sr))
        t = np.arange(n) / sr
        nyq = 0.45 * sr
        rng = np.random.default_rng(self.seed)

        # Voices: darker (more weight) at lower octaves, the NASA voices quieter.
        weights = {54: 1.0, 55: 0.8, 56: 0.5, 57: 0.35, 58: 0.15}
        mid = np.zeros(n)
        side = np.zeros(n)
        for octv in octaves:
            f0 = perseus_frequency(octv)
            w = weights.get(octv, 0.3)
            partials = [(1, 1.0), (2, 0.5), (3, 0.35), (4, 0.18), (5, 0.12), (6, 0.06), (7, 0.05)]
            for det in (-1, 1):
                # ±0.12% detune → a slow beat of ~0.1–1 Hz between channels.
                f = f0 * (1 + det * 0.0012) * (1 + 0.0008 * np.sin(2 * np.pi * 0.05 * t + octv))
                if f0 >= nyq:
                    continue
                tone = synth.additive(f, duration, partials, sr)[:n]
                mid += 0.5 * w * tone
                side += 0.5 * det * w * tone

        # Dark (low-passed) and bright versions, crossfaded by the ripples.
        cutoff_dark = min(300.0, nyq)
        dark_m = synth.lowpass(mid, cutoff_dark, sr)
        dark_s = synth.lowpass(side, cutoff_dark, sr)

        # Ripples: fronts launched every `ripple_period`, each a swell that
        # rises fast and fades slowly as the wave expands and weakens (∝ 1/r).
        ripple = np.zeros(n)
        spread = np.zeros(n)
        k = 0
        while True:
            t0 = (k + 0.3) * ripple_period * min(1.0, duration / (2 * ripple_period))
            if t0 >= duration:
                break
            dt = t - t0
            front = np.where(dt > 0, (dt / 0.8) * np.exp(1 - dt / 0.8), 0.0)
            ripple += front * (0.8 + 0.4 * rng.random())
            spread += np.where(dt > 0, np.clip(dt / (2.0), 0, 1) * np.exp(-dt / 4.0), 0.0)
            k += 1
        ripple = np.clip(ripple, 0, 1.5)
        bright = ripple / 1.5
        gain = 0.65 + 0.35 * ripple
        m = gain * ((1 - bright) * dark_m + bright * mid)
        s = gain * ((1 - bright) * dark_s + bright * side) * (0.6 + 0.8 * np.clip(spread, 0, 1))

        # Sub-bass rumble: brown noise below 80 Hz, decorrelated per channel.
        rum_l = synth.lowpass(synth.noise(duration, sr, self.seed + 11, "brown")[:n], 80, sr)
        rum_r = synth.lowpass(synth.noise(duration, sr, self.seed + 12, "brown")[:n], 80, sr)
        rum_l /= np.max(np.abs(rum_l)) + 1e-12
        rum_r /= np.max(np.abs(rum_r)) + 1e-12

        peak = np.max(np.abs(m)) + 1e-12
        left = (m + s) / peak + 0.25 * rum_l
        right = (m - s) / peak + 0.25 * rum_r

        if sweep:
            # M87-style radar scan: a narrow band of noise, tuned to a harmonic
            # of the drone, whose stereo position traces the scan angle and
            # which flares as it crosses the jet (angle ≈ 0).
            rot = float(self.options.get("sweep_period", 10.0))
            angle = 2 * np.pi * t / rot
            fc = min(perseus_frequency(57) * 2, nyq * 0.8)
            band = synth.bandpass(synth.noise(duration, sr, self.seed + 21)[:n], fc * 0.94, fc * 1.06, sr)
            band /= np.max(np.abs(band)) + 1e-12
            flare = 0.25 + 0.75 * np.exp(-(np.angle(np.exp(1j * angle)) / 0.35) ** 2)
            pan = np.cos(angle)
            g = 0.18 * flare
            left += g * band * np.cos((pan + 1) * np.pi / 4)
            right += g * band * np.sin((pan + 1) * np.pi / 4)

        out = np.stack([left, right], axis=1)
        return synth.reverb(out.astype(np.float32), room=1.0, wet=0.4, sr=sr)
