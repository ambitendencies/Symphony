"""Core audio buffers: stereo float32 arrays of shape (N, 2) in [-1, 1]."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44_100


def n_samples(duration: float, sr: int = SAMPLE_RATE) -> int:
    return int(round(duration * sr))


def time_axis(duration: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return np.arange(n_samples(duration, sr), dtype=np.float64) / sr


def silence(duration: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return np.zeros((n_samples(duration, sr), 2), dtype=np.float32)


def to_stereo(mono: np.ndarray, pan: float = 0.0) -> np.ndarray:
    """Equal-power pan a mono signal. pan in [-1 (left), 1 (right)]."""
    mono = np.asarray(mono, dtype=np.float64)
    angle = (np.clip(pan, -1.0, 1.0) + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1).astype(np.float32)


def normalize(sig: np.ndarray, peak: float = 0.95) -> np.ndarray:
    sig = np.nan_to_num(np.asarray(sig, dtype=np.float32))
    m = float(np.max(np.abs(sig))) if sig.size else 0.0
    return sig if m < 1e-12 else (sig * (peak / m)).astype(np.float32)


def fade(sig: np.ndarray, fade_in: float = 0.05, fade_out: float = 0.05,
         sr: int = SAMPLE_RATE) -> np.ndarray:
    """Raised-cosine fades to avoid clicks."""
    out = np.array(sig, dtype=np.float32, copy=True)
    n = out.shape[0]

    def ramp(seconds: float) -> np.ndarray:
        k = min(n, int(seconds * sr))
        r = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, k)) if k > 1 else np.ones(0)
        return r[:, None] if out.ndim == 2 else r

    r_in, r_out = ramp(fade_in), ramp(fade_out)
    out[: len(r_in)] *= r_in
    if len(r_out):
        out[n - len(r_out):] *= r_out[::-1]
    return out


def fit_length(sig: np.ndarray, n: int) -> np.ndarray:
    """Trim or zero-pad along axis 0 to exactly n samples."""
    if sig.shape[0] >= n:
        return sig[:n]
    pad = [(0, n - sig.shape[0])] + [(0, 0)] * (sig.ndim - 1)
    return np.pad(sig, pad)


def mix(*signals: np.ndarray, gains: list[float] | None = None) -> np.ndarray:
    """Sum stereo signals (padding to the longest)."""
    if not signals:
        return np.zeros((0, 2), dtype=np.float32)
    gains = gains or [1.0] * len(signals)
    n = max(s.shape[0] for s in signals)
    out = np.zeros((n, 2), dtype=np.float64)
    for s, g in zip(signals, gains):
        out[: s.shape[0]] += g * s
    return out.astype(np.float32)


def soft_limit(sig: np.ndarray, drive: float = 1.0) -> np.ndarray:
    """Gentle tanh limiter for the master bus."""
    return (np.tanh(drive * sig) / np.tanh(drive)).astype(np.float32)


def write_wav(path: str | Path, sig: np.ndarray, sr: int = SAMPLE_RATE) -> Path:
    path = Path(path)
    sig = np.asarray(sig)
    if sig.ndim == 1:
        sig = to_stereo(sig)
    pcm = (np.clip(sig, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


def read_wav(path: str | Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype="<i2").reshape(-1, ch)
    return (data.astype(np.float32) / 32767.0), sr
