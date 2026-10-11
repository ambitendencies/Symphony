"""Science → sound mappings.

These are the honest bridges between physical signals and human hearing.
Every mapping preserves *ratios* where possible, so physical relationships
(resonances, harmonics, chirps) survive as musical intervals.
"""

from __future__ import annotations

import math

import numpy as np

from .audio import SAMPLE_RATE

AUDIBLE = (20.0, 20_000.0)
MUSICAL = (55.0, 1760.0)  # A1..A6 — where pitch perception is strongest

SECONDS_PER_DAY = 86_400.0
SECONDS_PER_YEAR = 365.25 * SECONDS_PER_DAY

SCALES = {
    "chromatic": list(range(12)),
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic": [0, 2, 4, 7, 9],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "whole_tone": [0, 2, 4, 6, 8, 10],
}


def period_to_freq(period_seconds: float) -> float:
    return 1.0 / period_seconds


def octaves_to_audible(freq: float, target: tuple[float, float] = MUSICAL) -> int:
    """Number of octaves n such that freq * 2**n lands inside ``target``.

    Picks the n placing the result closest to the geometric centre of the band.
    """
    if freq <= 0:
        raise ValueError("frequency must be positive")
    centre = math.sqrt(target[0] * target[1])
    return round(math.log2(centre / freq))


def transpose_octaves(freq, octaves: int):
    """Shift by whole octaves — pitch class and all ratios are preserved."""
    return np.multiply(freq, 2.0 ** octaves)


def fold_into(freqs, band: tuple[float, float] = MUSICAL) -> np.ndarray:
    """Fold frequencies into ``band`` by whole octaves (keeps pitch class).

    ``band`` must span at least one octave.
    """
    f = np.asarray(freqs, dtype=np.float64)
    up = np.ceil(np.log2(band[0] / f)).clip(min=0)
    down = np.ceil(np.log2(f / band[1])).clip(min=0)
    return f * 2.0 ** (up - down)


def shared_transposition(freqs, target: tuple[float, float] = MUSICAL) -> tuple[np.ndarray, int]:
    """Transpose a *set* of frequencies by one common octave shift.

    Using a single shift for every body keeps the intervals between them
    exactly physical. Returns (shifted frequencies, octaves).
    """
    freqs = np.asarray(freqs, dtype=np.float64)
    geo = float(np.exp(np.mean(np.log(freqs))))
    n = octaves_to_audible(geo, target)
    return freqs * 2.0 ** n, n


def log_map(values, src: tuple[float, float], dst: tuple[float, float]) -> np.ndarray:
    """Map values logarithmically from src range to dst range (for pitch)."""
    v = np.clip(np.asarray(values, dtype=np.float64), src[0], src[1])
    u = (np.log(v) - math.log(src[0])) / (math.log(src[1]) - math.log(src[0]))
    return np.exp(math.log(dst[0]) + u * (math.log(dst[1]) - math.log(dst[0])))


def lin_map(values, src: tuple[float, float], dst: tuple[float, float], clip: bool = True) -> np.ndarray:
    v = np.asarray(values, dtype=np.float64)
    u = (v - src[0]) / (src[1] - src[0])
    if clip:
        u = np.clip(u, 0, 1)
    return dst[0] + u * (dst[1] - dst[0])


def freq_to_midi(freq) -> np.ndarray:
    return 69 + 12 * np.log2(np.asarray(freq, dtype=np.float64) / 440.0)


def midi_to_freq(midi) -> np.ndarray:
    return 440.0 * 2 ** ((np.asarray(midi, dtype=np.float64) - 69) / 12)


def quantize_to_scale(freq, scale: str = "pentatonic", root_midi: int = 57) -> np.ndarray:
    """Snap frequencies to the nearest note of a scale (parameter-mapping only;
    never use on data whose ratios carry meaning)."""
    degrees = np.array(SCALES[scale])
    m = freq_to_midi(freq) - root_midi
    octave = np.floor(m / 12)
    within = m - 12 * octave
    candidates = np.concatenate([degrees, [12]])
    idx = np.argmin(np.abs(within[..., None] - candidates), axis=-1)
    return midi_to_freq(root_midi + 12 * octave + candidates[idx])


def audify(data: np.ndarray, data_rate: float, speedup: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Audification: play a sampled physical signal as a waveform.

    ``data_rate`` is the instrument's sampling rate (Hz); ``speedup`` is how much
    faster than real time to play it. Every frequency f in the data is heard
    at f * speedup. The data is resampled to ``sr`` by linear interpolation
    and normalised, with DC removed.
    """
    data = np.asarray(data, dtype=np.float64)
    data = data - np.mean(data)
    effective_rate = data_rate * speedup
    n_out = int(round(len(data) * sr / effective_rate))
    src_t = np.arange(len(data)) / effective_rate
    out = np.interp(np.arange(n_out) / sr, src_t, data)
    peak = np.max(np.abs(out)) if len(out) else 0.0
    return out / peak if peak > 0 else out


def speedup_for(source_freq: float, target_freq: float) -> float:
    """Time-compression factor that moves ``source_freq`` to ``target_freq``."""
    return target_freq / source_freq


def resample_curve(values, n: int) -> np.ndarray:
    """Stretch a short control curve (e.g. hourly data) to n samples."""
    values = np.asarray(values, dtype=np.float64)
    if len(values) == 1:
        return np.full(n, values[0])
    return np.interp(np.linspace(0, len(values) - 1, n), np.arange(len(values)), values)
