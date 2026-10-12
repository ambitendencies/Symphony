"""Plasma waves: the dawn chorus, lightning whistlers, hiss and the interstellar hum."""

from __future__ import annotations

import numpy as np

from .. import synth
from .base import Source, register

# Electron cyclotron frequency: f_ce = e B / (2π m_e) = 28.0 GHz per tesla
# (= 28 Hz per nT).
F_CE_PER_NT = 27.99
# Earth's equatorial surface field (dipole moment) ~31,100 nT; along the
# equator a dipole falls as L^-3 (L = distance in Earth radii).
B_EQ_SURFACE_NT = 31_100.0
# Electron plasma frequency: f_pe = (1/2π) sqrt(n_e e² / (ε0 m_e)) = 8980 Hz × sqrt(n_e / cm^-3).
F_PE_COEFF = 8980.0
# Voyager 1 Plasma Wave System measured n_e ≈ 0.08 cm^-3 just beyond the
# heliopause (Gurnett et al. 2013, Science 341, 1489; Ocker et al. 2021,
# Nature Astronomy 5, 761 — the persistent faint narrowband emission).
VOYAGER_NE = 0.08
# Typical whistler dispersion constant D (s·Hz^½) for mid-latitude paths
# (Helliwell 1965, "Whistlers and Related Ionospheric Phenomena": 20–100).
WHISTLER_D = (35.0, 75.0)


def cyclotron_frequency(L: float) -> float:
    """Equatorial electron cyclotron frequency (Hz) at McIlwain L-shell ``L``.

    L = 5 → B = 249 nT → f_ce ≈ 6.96 kHz, so lower-band chorus (0.1–0.5 f_ce)
    lands at ~0.7–3.5 kHz: genuinely audible, heard at true pitch.
    """
    return F_CE_PER_NT * B_EQ_SURFACE_NT / L ** 3


def plasma_frequency(n_e: float) -> float:
    """Electron plasma frequency (Hz) for density ``n_e`` in cm^-3.

    Voyager 1 in interstellar space, n_e = 0.08 → 2.54 kHz.
    """
    return F_PE_COEFF * np.sqrt(n_e)


def whistler_frequency(t, D: float):
    """Eckersley's law: arrival delay t = D / sqrt(f)  ⇒  f(t) = (D / t)².

    High frequencies outrun low ones through the magnetospheric plasma, so a
    lightning click is smeared into a falling tone.
    """
    t = np.maximum(np.asarray(t, dtype=np.float64), 1e-6)
    return (D / t) ** 2


def _pan(x: np.ndarray, pan: float) -> tuple[np.ndarray, np.ndarray]:
    a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.cos(a) * x, np.sin(a) * x


def _add(out: np.ndarray, start: float, mono: np.ndarray, pan: float, sr: int) -> None:
    s = int(start * sr)
    n = out.shape[0]
    if s >= n or s + len(mono) <= 0:
        return
    if s < 0:
        mono, s = mono[-s:], 0
    m = min(len(mono), n - s)
    l, r = _pan(mono[:m], pan)
    out[s:s + m, 0] += l
    out[s:s + m, 1] += r


def _chorus_element(f_ce: float, rng: np.random.Generator, sr: int) -> np.ndarray:
    """One rising chorus 'chirp': ~0.1–0.5 s, sweeping upward through part of
    0.1–0.5 f_ce with a slightly concave (accelerating-then-easing) curve,
    like a bird's 'whee-oo'."""
    nyq = 0.45 * sr
    length = rng.uniform(0.12, 0.45)
    n = int(length * sr)
    u = np.linspace(0, 1, n)
    f_lo = f_ce * rng.uniform(0.12, 0.3)
    f_hi = min(f_ce * rng.uniform(0.32, 0.5), nyq)
    f_lo = min(f_lo, 0.9 * f_hi)
    shape = u ** rng.uniform(0.7, 1.4)
    f = f_lo + (f_hi - f_lo) * shape
    # Occasionally a hook: the tone dips before rising (observed 'hooks').
    if rng.random() < 0.15:
        f = f * (1 - 0.15 * np.sin(np.pi * np.clip(u * 3, 0, 1)))
    env = np.sin(np.pi * u) ** 1.5
    tone = np.sin(synth.phase_from_freq(f, n, sr))
    # A touch of second harmonic gives a slightly reedy 'bird' timbre.
    tone += 0.15 * np.sin(2 * synth.phase_from_freq(f, n, sr)) * (2 * f < nyq)
    return env * tone


def _whistler(D: float, sr: int, f_lo: float = 400.0) -> tuple[np.ndarray, float]:
    """Sferic click + falling whistler. Returns (signal, its length in s)."""
    nyq = 0.45 * sr
    f_top = min(8000.0, nyq)
    t_start = D / np.sqrt(f_top)          # delay of the highest frequency heard
    t_end = D / np.sqrt(f_lo)             # e.g. D=50: 0.56 s → 2.5 s
    n = int(t_end * sr)
    t = np.arange(n) / sr
    f = np.where(t < t_start, f_top, whistler_frequency(t, D))
    f = np.minimum(f, nyq)
    # Energy is strongest near 2–5 kHz (ionospheric transmission), fading at
    # the low end as the tone dies away.
    env = np.where(t < t_start, 0.0, 1.0)
    env *= np.exp(-((np.log(np.maximum(f, 1) / 2500.0)) ** 2) / 1.2)
    env *= np.clip((t - t_start) * sr / 200, 0, 1)
    sig = env * np.sin(synth.phase_from_freq(f, n, sr))
    # Sferic: the broadband click of the lightning stroke itself, at t = 0.
    k = min(n, int(0.01 * sr))
    rng = np.random.default_rng(int(D * 1000))
    sig[:k] += 0.8 * rng.standard_normal(k) * np.exp(-np.arange(k) / (0.0015 * sr))
    return sig, t_end


@register
class Plasma(Source):
    name = "plasma"
    title = "Plasma waves — the dawn chorus and the voice of interstellar space"
    science = (
        "Space is full of plasma, and plasma rings. Instruments like Van Allen "
        "Probes EMFISIS, Juno Waves and Voyager PWS record its electric and "
        "magnetic vibrations, many of which fall in the audio band, so here "
        "they play at TRUE pitch, as if the receiver were wired to a speaker. "
        "(a) Chorus: electrons gyrating in Earth's field (f_ce = 28 Hz/nT × "
        "31,100 nT / L³ ≈ 7 kHz at L = 5) amplify rising 'whistler-mode' tones "
        "between 0.1 and 0.5 f_ce, ~0.7–3.5 kHz, which chirp like birds at "
        "dawn. (b) Whistlers: a lightning click travels along field lines; the "
        "plasma is dispersive, so arrival time t = D/√f (Eckersley's law, D ≈ "
        "35–75 s·Hz^½) and high notes arrive first, giving a falling whistle "
        "after the crack. (c) Plasmaspheric hiss: incoherent band-limited noise "
        "~100 Hz–2 kHz. (d) Beyond the heliopause Voyager 1 hears a faint, "
        "steady tone at the electron plasma frequency f_pe = 8980·√n_e Hz; "
        "n_e ≈ 0.08 cm⁻³ gives ~2.5 kHz, drifting slightly upward as the "
        "density rises with distance."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        L = float(self.options.get("L", 5.0))
        n_e = float(self.options.get("n_e", VOYAGER_NE))
        chorus_rate = float(self.options.get("chorus_rate", 6.0))   # elements / s at peak
        whistler_rate = float(self.options.get("whistler_rate", 0.25))  # per second
        n = int(round(duration * sr))
        t = np.arange(n) / sr
        out = np.zeros((n, 2))
        rng = np.random.default_rng(self.seed)
        nyq = 0.45 * sr
        f_ce = cyclotron_frequency(L)

        # (c) Hiss: decorrelated band-limited noise, gently fluctuating.
        lo, hi = 100.0, min(2000.0, nyq)
        hl = synth.bandpass(synth.noise(duration, sr, self.seed + 1)[:n], lo, hi, sr)
        hr = synth.bandpass(synth.noise(duration, sr, self.seed + 2)[:n], lo, hi, sr)
        norm = np.max(np.abs(np.concatenate([hl, hr]))) + 1e-12
        k = max(4, int(duration) + 4)
        wobble = np.interp(t, np.linspace(0, duration, k), 0.7 + 0.3 * rng.random(k))
        out[:, 0] += 0.12 * wobble * hl / norm
        out[:, 1] += 0.12 * wobble * hr / norm

        # (a) Chorus: Poisson bursts whose density swells like a dawn chorus
        # (rising in the first half, peaking, then thinning).
        density = np.sin(np.pi * np.clip(t / duration, 0, 1)) ** 0.7
        ts = 0.0
        while True:
            local = np.interp(ts, t, density) if n else 0
            rate = max(0.5, chorus_rate * local)
            ts += rng.exponential(1.0 / rate)
            if ts >= duration:
                break
            el = _chorus_element(f_ce, rng, sr)
            _add(out, ts, 0.28 * (0.5 + 0.5 * rng.random()) * el, rng.uniform(-0.8, 0.8), sr)

        # (b) Whistlers: occasional lightning strokes (the first one early so
        # even short renders contain one).
        tw = min(0.15 * duration, 1.0)
        while tw < duration:
            D = rng.uniform(*WHISTLER_D)
            sig, _ = _whistler(D, sr)
            _add(out, tw, 0.45 * sig, rng.uniform(-0.4, 0.4), sr)
            # Echo: whistlers bounce between hemispheres; each hop doubles D.
            if rng.random() < 0.5:
                echo, _ = _whistler(2 * D, sr)
                _add(out, tw, 0.18 * echo, rng.uniform(-0.4, 0.4), sr)
            tw += rng.exponential(1.0 / whistler_rate) + 1.0

        # (d) Voyager's interstellar plasma line: faint, steady, narrowband,
        # with the density creeping up ~10% across the piece.
        ne_curve = n_e * (1 + 0.1 * t / max(duration, 1e-9))
        f_pe = np.minimum(plasma_frequency(ne_curve), nyq)
        line = np.sin(synth.phase_from_freq(f_pe, n, sr))
        env = np.clip((t - 0.25 * duration) / (0.15 * duration + 1e-9), 0, 1)
        out[:, 0] += 0.05 * env * line
        out[:, 1] += 0.05 * env * np.sin(synth.phase_from_freq(f_pe * 1.0003, n, sr))

        return synth.reverb(out.astype(np.float32), room=0.5, wet=0.2, sr=sr)
