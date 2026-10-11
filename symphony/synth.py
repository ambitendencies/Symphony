"""Instruments: oscillators, envelopes, tones, noise, filters and reverb.

All functions return mono float64 arrays unless stated otherwise; use
``audio.to_stereo`` to place them in the stereo field.
"""

from __future__ import annotations

import numpy as np

from .audio import SAMPLE_RATE, n_samples


# --- oscillators -----------------------------------------------------------

def phase_from_freq(freq: np.ndarray | float, n: int, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Integrate an instantaneous-frequency curve (Hz) into phase (radians).

    Lets every oscillator glide smoothly (chirps, Doppler, vibrato).
    """
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return 2 * np.pi * np.cumsum(f) / sr


def sine(freq, duration: float, sr: int = SAMPLE_RATE, phase0: float = 0.0) -> np.ndarray:
    n = n_samples(duration, sr)
    return np.sin(phase_from_freq(freq, n, sr) + phase0)


def additive(freq, duration: float, partials: list[tuple[float, float]] | None = None,
             sr: int = SAMPLE_RATE) -> np.ndarray:
    """Sum of harmonics. ``partials`` is a list of (ratio, amplitude)."""
    partials = partials or [(1, 1.0), (2, 0.5), (3, 0.25), (4, 0.125)]
    n = n_samples(duration, sr)
    base = phase_from_freq(freq, n, sr)
    out = np.zeros(n)
    nyq = sr / 2
    fmax = float(np.max(freq))
    for ratio, amp in partials:
        if fmax * ratio < nyq:
            out += amp * np.sin(base * ratio)
    return out / max(1e-9, sum(a for _, a in partials))


def fm(carrier, duration: float, ratio: float = 2.0, index: float = 2.0,
       sr: int = SAMPLE_RATE) -> np.ndarray:
    """Two-operator FM: bell/metallic timbres. ``index`` may be an array."""
    n = n_samples(duration, sr)
    pc = phase_from_freq(carrier, n, sr)
    return np.sin(pc + np.asarray(index) * np.sin(pc * ratio))


def noise(duration: float, sr: int = SAMPLE_RATE, seed: int = 0, color: str = "white") -> np.ndarray:
    """White, pink (1/f) or brown (1/f²) noise, deterministic by seed."""
    n = n_samples(duration, sr)
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(n)
    if color == "white" or n == 0:
        return white / (np.max(np.abs(white)) + 1e-12)
    spec = np.fft.rfft(white)
    f = np.fft.rfftfreq(n, 1 / sr)
    f[0] = f[1] if n > 1 else 1.0
    spec /= np.sqrt(f) if color == "pink" else f
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-12)


# --- envelopes -------------------------------------------------------------

def adsr(duration: float, attack=0.01, decay=0.1, sustain=0.7, release=0.2,
         sr: int = SAMPLE_RATE) -> np.ndarray:
    n = n_samples(duration, sr)
    a, d, r = (int(x * sr) for x in (attack, decay, release))
    s = max(0, n - a - d - r)
    env = np.concatenate([
        np.linspace(0, 1, a, endpoint=False),
        np.linspace(1, sustain, d, endpoint=False),
        np.full(s, sustain),
        np.linspace(sustain, 0, r),
    ])
    return np.pad(env, (0, max(0, n - len(env))))[:n]


def percussive(duration: float, decay: float = 0.2, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Instant attack, exponential decay (time constant ``decay`` seconds)."""
    t = np.arange(n_samples(duration, sr)) / sr
    return np.exp(-t / max(decay, 1e-6)) * np.minimum(1.0, t * sr / 32)


def place(event: np.ndarray, at: float, total: int, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Return a buffer of length ``total`` with ``event`` added at time ``at``."""
    out = np.zeros(total)
    i = int(at * sr)
    if 0 <= i < total:
        k = min(len(event), total - i)
        out[i:i + k] = event[:k]
    return out


# --- filters & effects -----------------------------------------------------

def lowpass(x: np.ndarray, cutoff: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Brick-wall FFT low-pass (zero phase, fine for offline rendering)."""
    return bandpass(x, 0.0, cutoff, sr)


def highpass(x: np.ndarray, cutoff: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return bandpass(x, cutoff, sr / 2, sr)


def bandpass(x: np.ndarray, lo: float, hi: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    n = len(x)
    if n == 0:
        return x
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / sr)
    # soft (raised-cosine, 1/6 octave) edges to avoid ringing
    w = np.ones_like(f)
    if lo > 0:
        w *= np.clip((np.log2(np.maximum(f, 1e-9) / lo) + 1 / 6) * 3, 0, 1)
    if hi < sr / 2:
        w *= np.clip((np.log2(hi / np.maximum(f, 1e-9)) + 1 / 6) * 3, 0, 1)
    return np.fft.irfft(spec * w, n)


def reverb(stereo: np.ndarray, room: float = 0.6, wet: float = 0.3,
           sr: int = SAMPLE_RATE, seed: int = 7) -> np.ndarray:
    """Convolution reverb with a synthetic decaying-noise impulse — the 'hall'."""
    n = stereo.shape[0]
    if n == 0 or wet <= 0:
        return stereo
    tail = 0.5 + 3.5 * room
    rng = np.random.default_rng(seed)
    k = int(tail * sr)
    t = np.arange(k) / sr
    decay = np.exp(-6.9 * t / tail)  # -60 dB at `tail`
    out = np.empty_like(stereo, dtype=np.float64)
    size = 1 << int(np.ceil(np.log2(n + k)))
    for ch in range(stereo.shape[1]):
        ir = rng.standard_normal(k) * decay
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12
        y = np.fft.irfft(np.fft.rfft(stereo[:, ch], size) * np.fft.rfft(ir, size), size)[:n]
        out[:, ch] = (1 - wet) * stereo[:, ch] + wet * y
    return out.astype(np.float32)


def tremolo(x: np.ndarray, rate: float, depth: float = 0.5, sr: int = SAMPLE_RATE) -> np.ndarray:
    t = np.arange(len(x)) / sr
    return x * (1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t)))
