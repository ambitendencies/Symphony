"""Symphony — hear the sounds of space through honest sonification."""

from . import audio, mapping, synth
from .audio import SAMPLE_RATE, write_wav
from .sources import REGISTRY, Source, get, register

__version__ = "0.1.0"
__all__ = ["audio", "mapping", "synth", "SAMPLE_RATE", "write_wav", "REGISTRY", "Source", "get", "register"]
