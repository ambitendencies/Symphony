"""Solar wind at L1: speed, density, temperature and IMF Bz as a living drone."""

from __future__ import annotations

import math

import numpy as np

from .. import synth
from ..mapping import log_map, lin_map, quantize_to_scale, resample_curve
from .base import Source, register


def _build_sample() -> list[dict]:
    """~60 hourly points of a CME-driven shock arrival, modelled on typical L1
    observations (DSCOVR/ACE): quiet slow wind (~380 km/s), an interplanetary
    shock jump to ~650+ km/s with a compressed density spike and heated sheath,
    then a magnetic cloud whose Bz swings strongly southward (about -18 nT),
    followed by slow recovery. Deterministic, no RNG."""
    rows = []
    shock = 20  # hour of the shock arrival
    for h in range(60):
        wob = math.sin(h * 1.7) * 0.5 + math.sin(h * 0.63 + 1.0) * 0.5  # small fluctuation in [-1, 1]
        if h < shock:
            speed = 380 + 12 * wob
            dens = 5.0 + 1.2 * wob
            temp = 70_000 + 8_000 * wob
            bz = 1.5 + 2.0 * wob
        else:
            k = h - shock
            sheath = math.exp(-k / 6.0)           # compressed, hot sheath decays
            speed = 430 + 240 * min(1.0, k / 1.5) * math.exp(-max(0, k - 14) / 40.0) + 25 * wob
            dens = 6.0 + 24.0 * sheath + 1.5 * wob
            temp = 90_000 + 450_000 * sheath * (1.0 if k < 20 else 0.5) + 60_000 * math.exp(-k / 25.0) + 15_000 * wob
            # magnetic cloud: Bz dips southward from ~3 h after the shock, recovers by ~24 h
            cloud = math.exp(-((k - 9.0) / 5.5) ** 2)
            bz = -19.0 * cloud + 3.0 * wob * (1 - 0.5 * cloud) + 2.0 * math.exp(-k / 30.0)
        rows.append({"time": h, "speed": round(speed, 1), "density": round(max(0.5, dens), 2),
                     "temperature": round(max(1e4, temp)), "bz": round(bz, 2)})
    return rows


SAMPLE_DATA: list[dict] = _build_sample()

KEYS = ("speed", "density", "temperature", "bz")
_DEFAULTS = {"speed": 400.0, "density": 5.0, "temperature": 1e5, "bz": 0.0}


def to_arrays(data) -> dict[str, np.ndarray]:
    """Normalise ``data`` into {speed, density, temperature, bz} float arrays.

    Accepts a list of dicts (keys ``speed``, ``density``, ``temperature``, ``bz``;
    extra keys such as ``time`` are ignored), or a dict of sequences. Missing or
    NaN values are filled by interpolation, or by quiet-wind defaults.
    """
    if isinstance(data, dict):
        cols = {k: np.asarray(data.get(k, []), dtype=np.float64) for k in KEYS}
    else:
        rows = list(data)
        cols = {k: np.array([np.nan if r.get(k) is None else float(r[k]) for r in rows]) for k in KEYS}
    n = max((len(v) for v in cols.values()), default=0)
    if n == 0:
        raise ValueError("solar wind data is empty")
    out = {}
    for k, v in cols.items():
        if len(v) == 0:
            v = np.full(n, np.nan)
        elif len(v) != n:
            v = resample_curve(v, n)
        good = np.isfinite(v)
        out[k] = np.interp(np.arange(n), np.flatnonzero(good), v[good]) if good.any() else np.full(n, _DEFAULTS[k])
    return out


@register
class SolarWind(Source):
    name = "solar_wind"
    title = "The Solar Wind — a CME hits Earth's field"
    science = (
        "The Sun blows a continuous stream of plasma past Earth; spacecraft at the "
        "L1 point (DSCOVR, ACE) measure it about an hour before it arrives. Typical "
        "values: speed 300-800 km/s, proton density 1-30 per cm3, temperature 1e4-1e6 K, "
        "and the interplanetary magnetic field's north-south component Bz of +-20 nT. "
        "When Bz turns strongly SOUTH it links up with Earth's field and drives "
        "geomagnetic storms and aurorae. This is parameter mapping (not audification): "
        "speed -> pitch of a drone (log scale 300-800 km/s onto 130-520 Hz, snapped to a "
        "pentatonic scale); density -> loudness and rate of a granular crackle (more "
        "particles, more grains); temperature -> brightness (harmonic richness and "
        "filter cutoff); southward Bz -> a dissonant, beating minor-second/tritone "
        "layer that grows as the storm builds, and a deep thump marks each shock. "
        "The built-in sample is a realistic, hand-built CME arrival (not live "
        "data); pass options data=[...] or use symphony.live for NOAA SWPC data."
    )

    def _render(self, duration: float, sr: int) -> np.ndarray:
        data = self.options.get("data")
        d = to_arrays(SAMPLE_DATA if data is None else data)
        n = int(round(duration * sr))
        t = np.arange(n) / sr
        rng = np.random.default_rng(self.seed)
        curve = {k: resample_curve(v, n) for k, v in d.items()}

        # speed -> drone pitch (log map, pentatonic quantised, glide-smoothed)
        f0 = log_map(curve["speed"], (300.0, 800.0), (130.0, 520.0))
        f0 = quantize_to_scale(f0, "pentatonic", root_midi=48)
        win = max(1, int(0.03 * sr))
        f0 = np.convolve(np.pad(f0, (win, win), mode="edge"), np.ones(win) / win, mode="same")[win:-win]
        f0 = np.minimum(f0, sr * 0.45)

        # temperature -> brightness 0..1 (log)
        bright = lin_map(np.log10(np.clip(curve["temperature"], 1e4, 1e6)), (4.0, 6.0), (0.0, 1.0))

        # drone: additive with brightness-dependent spectral tilt
        phase = synth.phase_from_freq(f0, n, sr)
        drone = np.zeros(n)
        weights = 0.0
        for k in range(1, 8):
            ok = (f0 * k < sr * 0.45)
            amp = (k ** -(2.4 - 1.9 * bright)) * ok
            drone += amp * np.sin(k * phase + 0.7 * k)
            weights += 1.0 / k
        drone /= weights
        drone *= 1.0 + 0.12 * np.sin(2 * np.pi * 0.15 * t)  # slow breathing

        # density -> granular crackle: Poisson grains, rate and loudness follow density
        dens = np.clip(curve["density"], 1.0, 30.0)
        rate = np.interp(np.log(dens), [0.0, math.log(30.0)], [4.0, 140.0])
        p = rate / sr
        hit = rng.random(n) < p
        amp = rng.random(n) ** 2 * hit
        loud = lin_map(np.log(dens), (0.0, math.log(30.0)), (0.35, 1.0))
        pans = rng.random(n)
        k_len = max(8, int(0.012 * sr))
        kt = np.arange(k_len) / sr
        kern = np.exp(-kt / 0.002) * np.sin(2 * np.pi * min(2600.0, sr * 0.3) * kt + 1.0)
        size = 1 << int(np.ceil(np.log2(n + k_len)))
        fk = np.fft.rfft(kern, size)
        grains = []
        for w in (np.cos(pans * np.pi / 2), np.sin(pans * np.pi / 2)):
            imp = amp * loud * w
            grains.append(np.fft.irfft(np.fft.rfft(imp, size) * fk, size)[:n])
        dark = synth.lowpass(grains[0] + grains[1], min(900.0, sr * 0.2), sr)
        # brightness crossfade: cold plasma is muffled, hot plasma is crisp
        crackle = [dark * (1 - bright) * 0.5 + g * (0.3 + 0.7 * bright) for g in grains]

        # southward Bz -> ominous cluster layer
        south = lin_map(-curve["bz"], (2.0, 18.0), (0.0, 1.0))
        base = 55.0
        cluster = np.zeros(n)
        for ratio, a in ((1.0, 1.0), (2 ** (1 / 12), 0.8), (2 ** (6 / 12), 0.7), (2 ** (13 / 12), 0.4)):
            f = base * ratio
            cluster += a * np.sin(2 * np.pi * f * t + 3 * ratio)
        cluster *= 0.7 + 0.3 * np.sin(2 * np.pi * (0.3 + 0.9 * south) * t)  # beating gets faster
        cluster *= south ** 1.3

        # shock thumps where speed jumps abruptly
        thump = np.zeros(n)
        sp = d["speed"]
        for i in np.flatnonzero(np.diff(sp) > 80.0):
            at = (i + 0.5) / (len(sp) - 1) * duration
            ev = synth.percussive(min(1.5, duration), 0.25, sr) * np.sin(2 * np.pi * 48.0 * np.arange(int(min(1.5, duration) * sr)) / sr)
            thump += synth.place(ev, at, n, sr)

        mono = 0.6 * drone + 0.55 * cluster + 0.9 * thump
        out = np.stack([mono + 0.5 * crackle[0], mono + 0.5 * crackle[1]], axis=1)
        return synth.reverb(out.astype(np.float32), room=0.5, wet=0.2, sr=sr)
