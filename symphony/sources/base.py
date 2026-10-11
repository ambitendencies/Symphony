"""The plug-in contract every space-sound source implements."""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from ..audio import SAMPLE_RATE, fade, fit_length, n_samples, normalize

REGISTRY: dict[str, type["Source"]] = {}


class Source(ABC):
    """A physical phenomenon rendered as sound.

    Subclasses set ``name`` (registry key), ``title`` and ``science`` (a plain
    English explanation of the physics *and* of how it is mapped to sound),
    and implement ``_render``. ``render`` enforces the output contract:
    stereo float32, exactly round(duration*sr) samples, peak <= 0.95, faded
    edges, no NaNs.
    """

    name: str = ""
    title: str = ""
    science: str = ""

    def __init__(self, seed: int = 0, **options):
        self.seed = seed
        self.options = options

    @abstractmethod
    def _render(self, duration: float, sr: int) -> np.ndarray:
        """Return a mono (N,) or stereo (N, 2) array; length need not be exact."""

    def render(self, duration: float, sr: int = SAMPLE_RATE) -> np.ndarray:
        if duration <= 0:
            raise ValueError("duration must be positive")
        sig = np.asarray(self._render(duration, sr), dtype=np.float64)
        if sig.ndim == 1:
            sig = np.stack([sig, sig], axis=1)
        sig = fit_length(sig, n_samples(duration, sr))
        sig = np.nan_to_num(sig, nan=0.0, posinf=0.0, neginf=0.0)
        return fade(normalize(sig.astype(np.float32)), 0.02, 0.05, sr)


def register(cls: type[Source]) -> type[Source]:
    if not cls.name:
        raise ValueError(f"{cls.__name__} needs a name")
    REGISTRY[cls.name] = cls
    return cls


def get(name: str, **kwargs) -> Source:
    try:
        return REGISTRY[name](**kwargs)
    except KeyError:
        raise KeyError(f"unknown source {name!r}; available: {', '.join(sorted(REGISTRY))}") from None
