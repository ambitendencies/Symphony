"""Space-sound sources. Importing this package registers every available source."""

import importlib

from .base import REGISTRY, Source, get, register

# Each module registers itself on import; modules not yet built are skipped.
_MODULES = ["orbits", "trappist", "pulsars", "gravitational", "black_hole", "plasma", "solar_wind"]
for _m in _MODULES:
    try:
        importlib.import_module(f"{__name__}.{_m}")
    except ModuleNotFoundError as e:
        if e.name != f"{__name__}.{_m}":
            raise

__all__ = ["REGISTRY", "Source", "get", "register"]
