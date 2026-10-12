"""GW150914: the first gravitational waves ever detected — two black holes merging."""

from __future__ import annotations

import numpy as np

from .. import synth
from .base import Source, register

G = 6.674e-11          # m^3 kg^-1 s^-2
C = 2.998e8            # m/s
M_SUN = 1.989e30       # kg

# GW150914 (Abbott et al. 2016, PRL 116, 061102): component masses ~36 and
# ~29 M☉ (source frame), chirp mass 28.3 M☉ source frame; the detector sees
# it redshifted (z ≈ 0.09) to ~30 M☉, which is what sets the heard chirp.
M1, M2 = 36.0, 29.0
CHIRP_MASS_DETECTOR = 30.0
F_START = 35.0         # Hz — where the signal rose above LIGO's noise
F_MERGE = 250.0        # Hz — peak GW frequency near merger
F_RING = 250.0         # Hz — quasi-normal ringdown frequency of the ~62 M☉ remnant
TAU_RING = 0.004       # s  — ringdown e-folding time


def chirp_mass(m1: float, m2: float) -> float:
    """(m1 m2)^(3/5) / (m1 + m2)^(1/5); 36 & 29 M☉ → 28.1 M☉."""
    return (m1 * m2) ** 0.6 / (m1 + m2) ** 0.2


def _tm(mc_solar: float) -> float:
    """G M_c / c³ in seconds (~1.48e-4 s for 30 M☉)."""
    return G * mc_solar * M_SUN / C ** 3


def chirp_frequency(tau, mc_solar: float = CHIRP_MASS_DETECTOR):
    """Leading-order (quadrupole) GW frequency a time ``tau`` before coalescence.

    f(τ) = (1/π) (5 / (256 τ))^(3/8) (G M_c / c³)^(-5/8)
    """
    tau = np.maximum(np.asarray(tau, dtype=np.float64), 1e-9)
    return (1 / np.pi) * (5.0 / (256.0 * tau)) ** 0.375 * _tm(mc_solar) ** -0.625


def time_to_coalescence(f, mc_solar: float = CHIRP_MASS_DETECTOR):
    """Inverse of :func:`chirp_frequency`: τ = (5/256) (π f)^(-8/3) (G M_c/c³)^(-5/3).

    From 35 Hz this is ~0.17 s for 30 M☉ — the whole audible chirp is a blink.
    """
    return 5.0 / 256.0 * (np.pi * np.asarray(f, dtype=np.float64)) ** (-8 / 3) * _tm(mc_solar) ** (-5 / 3)


def chirp_waveform(sr: int, stretch: float = 1.0, pitch: float = 1.0,
                   mc_solar: float = CHIRP_MASS_DETECTOR, f_start: float = F_START,
                   f_merge: float = F_MERGE, f_ring: float = F_RING,
                   tau_ring: float = TAU_RING) -> tuple[np.ndarray, np.ndarray]:
    """Inspiral + ringdown strain (normalised) and its instantaneous frequency.

    ``stretch`` slows time down, ``pitch`` multiplies every frequency; with
    both 1 this is the event exactly as LIGO heard it (~0.2 s, 35 → 250 Hz).
    Amplitude grows as f^(2/3) (quadrupole strain h ∝ M_c^(5/3) f^(2/3) / D).
    """
    nyq = 0.45 * sr
    tau0 = float(time_to_coalescence(f_start, mc_solar))
    tau_end = float(time_to_coalescence(f_merge, mc_solar))
    n_insp = max(2, int((tau0 - tau_end) * stretch * sr))
    t_audio = np.arange(n_insp) / sr
    tau = tau0 - t_audio / stretch
    f_phys = chirp_frequency(tau, mc_solar)
    amp = (f_phys / f_merge) ** (2 / 3)

    n_ring = int(8 * tau_ring * stretch * sr)
    t_ring = np.arange(n_ring) / sr
    f_ring_curve = f_merge + (f_ring - f_merge) * (1 - np.exp(-t_ring / (tau_ring * stretch)))
    f_all = np.concatenate([f_phys, f_ring_curve]) * pitch
    a_all = np.concatenate([amp, np.exp(-t_ring / (tau_ring * stretch))])
    # Fade the inspiral in from its very first cycles (signal emerging from noise).
    a_all[: n_insp] *= np.clip(t_audio / (0.25 * n_insp / sr), 0, 1) ** 0.5
    a_all = np.where(f_all < nyq, a_all, 0.0)
    f_all = np.minimum(f_all, nyq)
    h = a_all * np.sin(synth.phase_from_freq(f_all, len(f_all), sr))
    return h, f_all


def _detector_noise(duration: float, sr: int, seed: int) -> np.ndarray:
    """LIGO-like coloured noise: a steep seismic wall at low frequency, a
    minimum around 100–300 Hz and rising (shot) noise above. Mostly heard as
    a deep rumble, the 'sound' of the instrument waiting."""
    n = int(round(duration * sr))
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sr)
    f[0] = 1.0
    asd = (f / 40.0) ** -2.0 + 0.15 + (f / 400.0) ** 1.0
    asd *= np.clip((f - 12.0) / 8.0, 0, 1)  # high-pass below ~15 Hz (inaudible)
    x = np.fft.irfft(spec * asd, n)
    return x / (np.max(np.abs(x)) + 1e-12)


@register
class Gravitational(Source):
    name = "gravitational"
    title = "GW150914 — two black holes collide"
    science = (
        "On 14 Sep 2015 LIGO caught ripples in spacetime from two black holes "
        "of ~36 and ~29 solar masses spiralling together 1.3 billion light-years "
        "away. As they orbit, the gravitational-wave frequency (twice the orbital "
        "frequency) rises following the quadrupole formula "
        "f(τ) = (1/π)(5/256τ)^(3/8)(GM_c/c³)^(-5/8), with chirp mass M_c ≈ 30 M☉ "
        "as seen by the detector; amplitude grows as f^(2/3). Remarkably the "
        "signal is ALREADY audible: it sweeps 35 → 250 Hz in about 0.2 s, then "
        "the merged black hole 'rings down' at ~250 Hz with a ~4 ms decay. We "
        "play it twice: first time-stretched (default ~35× slower) and shifted "
        "up two octaves so the 'whoop' is audible on small speakers, then once "
        "at true speed and true pitch — the strain is mapped directly to "
        "loudspeaker displacement. Before it, LIGO-coloured detector noise "
        "(seismic rumble, quiet bucket near 150 Hz) slowly builds."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        mode = self.options.get("mode", "both")  # "both" | "stretched" | "real"
        pitch = float(self.options.get("pitch", 4.0))
        mc = float(self.options.get("chirp_mass", CHIRP_MASS_DETECTOR))
        n = int(round(duration * sr))
        out = np.zeros((n, 2))

        real_len = float(time_to_coalescence(F_START, mc)) + 8 * TAU_RING
        stretch = self.options.get("stretch")
        if stretch is None:
            stretch = float(np.clip(0.35 * duration / real_len, 1.0, 60.0))
        stretch = float(stretch)

        # Rumbling build-up of detector noise.
        t = np.arange(n) / sr
        noise = _detector_noise(duration, sr, self.seed)
        noise_r = _detector_noise(duration, sr, self.seed + 1)
        build = 0.06 + 0.14 * np.clip(t / (0.7 * duration), 0, 1) ** 2
        out[:, 0] += build * noise
        out[:, 1] += build * noise_r

        def put(h: np.ndarray, end_frac: float, gain: float, width: float) -> None:
            start = int(end_frac * n) - len(h)
            start = max(0, start)
            m = min(len(h), n - start)
            # Slight L/R time offset: Hanford and Livingston saw it 7 ms apart.
            lag = int(min(0.007, 0.25 * len(h) / sr) * sr)
            out[start:start + m, 0] += gain * h[:m]
            hl = np.concatenate([np.zeros(lag), h])[:m]
            out[start:start + m, 1] += gain * (width * hl + (1 - width) * h[:m])

        if mode in ("both", "stretched"):
            h, _ = chirp_waveform(sr, stretch=stretch, pitch=pitch, mc_solar=mc)
            put(h, 0.72 if mode == "both" else 0.9, 0.8, 0.5)
        if mode in ("both", "real"):
            h, _ = chirp_waveform(sr, stretch=1.0, pitch=1.0, mc_solar=mc)
            put(h, 0.92 if mode == "both" else 0.85, 0.9, 1.0)

        return synth.reverb(out.astype(np.float32), room=0.5, wet=0.2, sr=sr)
