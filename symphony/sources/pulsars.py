"""Pulsars: spinning neutron stars as nature's metronomes — and, when fast enough, as notes."""

from __future__ import annotations

import numpy as np

from .. import synth
from .base import Source, register

# Spin periods (s) and dispersion measures (pc cm^-3) from the ATNF Pulsar
# Catalogue (Manchester et al. 2005, AJ 129, 1993). ``duty`` is the pulse
# width as a fraction of the period (approximate W50/P). ``pan`` loosely
# follows each pulsar's sky position (galactic longitude) left-to-right.
PULSARS = {
    # name: (period_s, DM, duty, pan, description)
    "B0329+54": (0.7145, 26.76, 0.03, -0.6, "brightest northern pulsar, 3-component profile"),
    "B0833-45 (Vela)": (0.08933, 67.99, 0.04, 0.55, "Vela supernova remnant, ~11 kyr old"),
    "B0531+21 (Crab)": (0.0337, 56.77, 0.03, -0.25, "Crab Nebula, born in the supernova of 1054 AD"),
    "J0437-4715": (0.005757, 2.64, 0.10, 0.75, "nearest millisecond pulsar, 157 pc"),
    "B1937+21": (0.0015578, 71.02, 0.04, 0.0, "first millisecond pulsar found (1982)"),
}

# Above this spin rate a pulse train fuses into a pitch for human hearing
# (the lower limit of pitch perception is ~20-30 Hz; we put the switch a bit
# higher so the Crab's 29.7 Hz is still heard as a very fast buzz of clicks).
PITCH_THRESHOLD_HZ = 50.0

# Cold-plasma dispersion delay: dt = 4.149 ms × DM × (f/GHz)^-2
# (Lorimer & Kramer, Handbook of Pulsar Astronomy, eq. 4.7).
K_DM_MS = 4.149


def spin_frequency(period_s: float) -> float:
    """Rotation frequency in Hz. B1937+21: 1/1.5578 ms = 641.9 Hz — already audible."""
    return 1.0 / period_s


def dispersion_delay(dm: float, f_lo_ghz: float, f_hi_ghz: float) -> float:
    """Extra arrival delay (s) of f_lo relative to f_hi for dispersion measure ``dm``.

    E.g. Vela (DM 68) across 0.4–1.4 GHz: ~1.62 s — longer than its period!
    """
    return K_DM_MS * 1e-3 * dm * (f_lo_ghz ** -2 - f_hi_ghz ** -2)


def _event_pulse(body_hz: float, dm: float, sr: int, decay: float) -> np.ndarray:
    """One slow-pulsar pulse: a broadband click plus a resonant pitched body.

    The body starts high and sweeps down — a miniature of interstellar
    dispersion, where the high radio frequencies of each pulse reach us first
    and the low ones trail behind. The sweep time scales with the pulsar's
    DM (real delays are seconds; here they are compressed to a few ms).
    """
    sweep = 0.002 + 0.00012 * dm            # s: 5 ms (DM 27) … 10 ms (DM 68)
    length = sweep + 6 * decay
    n = int(length * sr)
    t = np.arange(n) / sr
    nyq = 0.45 * sr
    # Dispersion curve: arrival ∝ f^-2  →  f(t) ∝ 1/sqrt(t + t0)
    f_hi = min(body_hz * 4.0, nyq)
    t0 = sweep / ((f_hi / body_hz) ** 2 - 1 + 1e-9)
    f = np.where(t < sweep, body_hz * np.sqrt((sweep + t0) / (t + t0)), body_hz)
    f = np.minimum(f, nyq)
    body = np.sin(synth.phase_from_freq(f, n, sr)) * np.exp(-t / decay)
    body *= np.minimum(1.0, t * sr / 8)
    click = np.exp(-t / 0.0008) * np.cos(2 * np.pi * min(3000.0, nyq) * t)
    return 0.7 * body + 0.4 * click


def _profile_harmonics(name: str, duty: float) -> list[tuple[float, float, float]]:
    """Fourier components (harmonic k, amplitude, phase offset) of a pulse profile.

    A Gaussian pulse of rms width σ (in turns) has harmonic amplitudes
    exp(-(2πkσ)²/2) — narrow pulses → bright, buzzy tones. The Crab adds its
    famous interpulse ~0.4 turns after the main pulse.
    """
    sigma = duty / 2.355
    comps = [(1.0, 0.0)]  # (relative amplitude, centre in turns)
    if "Crab" in name:
        comps.append((0.6, 0.40))
    if "B0329" in name:
        comps = [(0.4, -0.012), (1.0, 0.0), (0.5, 0.012)]
    out = []
    for k in range(1, 41):
        g = np.exp(-0.5 * (2 * np.pi * k * sigma) ** 2)
        re = sum(a * np.cos(2 * np.pi * k * c) for a, c in comps)
        im = sum(a * np.sin(2 * np.pi * k * c) for a, c in comps)
        amp = g * np.hypot(re, im)
        if amp > 1e-3:
            out.append((k, amp, -np.arctan2(im, re)))
    return out


@register
class Pulsars(Source):
    name = "pulsars"
    title = "Pulsars — the lighthouse clocks of the Galaxy"
    science = (
        "A pulsar is a city-sized neutron star spinning up to hundreds of times "
        "a second, sweeping a radio beam past Earth once per turn. We hear each "
        "at its TRUE rotation rate — no transposition of tempo. Slow pulsars are "
        "rhythm: B0329+54 ticks every 714.5 ms, Vela every 89.33 ms (11.2 per "
        "second), the Crab every 33.7 ms (29.7 Hz, a buzz on the edge of pitch, "
        "with its interpulse). Each tick is a click plus a resonant body tuned "
        "to the spin rate shifted up by whole octaves, and that body sweeps "
        "downward: interstellar electrons delay low radio frequencies by "
        "4.149 ms × DM × f_GHz^-2, so every real pulse arrives as a falling "
        "chirp (scaled here to a few ms, longer for higher dispersion measure). "
        "Millisecond pulsars spin so fast that their pulse rate IS an audible "
        "pitch: J0437-4715 at 173.7 Hz and B1937+21 at 641.9 Hz, rendered as "
        "the Fourier series of their pulse profile (narrow pulses → bright "
        "harmonics). They enter one at a time, slowest first, panned by sky "
        "position, with slow interstellar-scintillation twinkle in loudness."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        names = self.options.get("pulsars", list(PULSARS))
        threshold = float(self.options.get("pitch_threshold", PITCH_THRESHOLD_HZ))
        stagger = bool(self.options.get("stagger", True))
        n = int(round(duration * sr))
        t = np.arange(n) / sr
        out = np.zeros((n, 2))
        rng = np.random.default_rng(self.seed)
        nyq = 0.45 * sr

        # Slowest first; each newcomer enters at an equal slice of the piece.
        names = sorted(names, key=lambda k: -PULSARS[k][0])
        slot = duration / len(names) if stagger else 0.0
        ramp = max(0.05, min(1.5, slot / 3)) if stagger else 0.05

        for i, name in enumerate(names):
            period, dm, duty, pan, _ = PULSARS[name]
            f_spin = spin_frequency(period)
            start = i * slot
            env = np.clip((t - start) / ramp, 0, 1)
            # Interstellar scintillation: slow random brightness fluctuations.
            k = max(4, int(duration * 0.5) + 4)
            knots = 1 + 0.35 * rng.standard_normal(k)
            env = env * np.clip(np.interp(t, np.linspace(0, duration, k), knots), 0.3, 1.6)

            if f_spin < threshold:
                # Rhythm: a pitched pulse at every true rotation.
                octaves = int(np.round(np.log2(220.0 * (1 + i) / f_spin)))
                body = f_spin * 2.0 ** octaves
                while body > nyq / 2:
                    body /= 2
                decay = float(np.clip(0.4 * period, 0.006, 0.12))
                ev = _event_pulse(body, dm, sr, decay)
                mono = np.zeros(n)
                at = start + rng.uniform(0, period)
                # Rotational phase jitter (pulse-to-pulse variability) ~ duty/4.
                while at < duration:
                    s = int((at + rng.normal(0, duty * period / 4)) * sr)
                    if 0 <= s < n:
                        m = min(len(ev), n - s)
                        amp = 0.6 + 0.4 * rng.random()  # pulse-to-pulse intensity
                        mono[s:s + m] += amp * ev[:m]
                    at += period
                gain = 0.8 if f_spin < 5 else 0.55
            else:
                # Pitch: the pulse train itself, band-limited Fourier series.
                f = np.full(n, f_spin) * (1 + 1e-4 * np.sin(2 * np.pi * 0.1 * t))  # tiny orbital Doppler
                ph = synth.phase_from_freq(f, n, sr)
                mono = np.zeros(n)
                for kh, amp, phi in _profile_harmonics(name, duty):
                    if kh * f_spin < nyq:
                        mono += amp * np.sin(kh * ph + phi)
                mono /= np.max(np.abs(mono)) + 1e-12
                gain = 0.22
            mono *= env * gain
            angle = (pan + 1) * np.pi / 4
            out[:, 0] += np.cos(angle) * mono
            out[:, 1] += np.sin(angle) * mono

        return synth.reverb(out.astype(np.float32), room=0.4, wet=0.18, sr=sr)
