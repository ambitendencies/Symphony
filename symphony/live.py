"""Live solar wind from NOAA SWPC (real-time DSCOVR/ACE data at L1).

The network part is optional and best-effort: on any failure ``fetch_solar_wind``
warns and returns the built-in offline sample. The parsing helpers are pure
functions so they can be tested without a network.
"""

from __future__ import annotations

import json
import math
import urllib.request
import warnings
from datetime import datetime, timezone

PLASMA_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json"
MAG_URL = "https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json"


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _ts(s: str) -> float:
    s = s.replace("T", " ").split(".")[0]
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()


def parse_table(rows, fields: dict[str, str]) -> dict[float, dict]:
    """Parse a SWPC JSON table (first row = header) into {epoch: {key: value}}.

    ``fields`` maps output key -> column header. Rows with a bad time are skipped;
    null/non-numeric cells are left out of that row's dict.
    """
    if not rows:
        return {}
    header = list(rows[0])
    cols = {out: header.index(col) for out, col in fields.items() if col in header}
    if "time_tag" not in header:
        return {}
    ti = header.index("time_tag")
    result: dict[float, dict] = {}
    for r in rows[1:]:
        try:
            t = _ts(str(r[ti]))
        except (ValueError, IndexError):
            continue
        rec = {}
        for k, i in cols.items():
            v = _num(r[i]) if i < len(r) else None
            if v is not None:
                rec[k] = v
        if rec:
            result[t] = rec
    return result


def parse_plasma(rows) -> dict[float, dict]:
    return parse_table(rows, {"density": "density", "speed": "speed", "temperature": "temperature"})


def parse_mag(rows) -> dict[float, dict]:
    return parse_table(rows, {"bz": "bz_gsm"})


def merge_hourly(plasma: dict, mag: dict, step: float = 3600.0) -> list[dict]:
    """Average both series into ``step``-second bins, merge by bin, and drop bins
    that lack any of speed/density/temperature/bz. Returns a list of dicts
    (time as an ISO string) in the structure ``solar_wind`` accepts."""
    bins: dict[int, dict[str, list]] = {}
    for series in (plasma, mag):
        for t, rec in series.items():
            b = bins.setdefault(int(t // step), {})
            for k, v in rec.items():
                b.setdefault(k, []).append(v)
    out = []
    for b in sorted(bins):
        cell = bins[b]
        if not all(k in cell for k in ("speed", "density", "temperature", "bz")):
            continue
        row = {k: sum(v) / len(v) for k, v in cell.items()}
        row["time"] = datetime.fromtimestamp(b * step, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        out.append(row)
    return out


def _get_json(url: str, timeout: float):
    req = urllib.request.Request(url, headers={"User-Agent": "symphony/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_solar_wind(timeout: float = 10.0, step: float = 3600.0, min_points: int = 6) -> list[dict]:
    """Fetch the last ~24 h of real solar wind and return hourly-ish points.

    Falls back to the offline sample (with a warning) if the network fails or
    too little valid data comes back.
    """
    from .sources.solar_wind import SAMPLE_DATA

    try:
        plasma = parse_plasma(_get_json(PLASMA_URL, timeout))
        mag = parse_mag(_get_json(MAG_URL, timeout))
        rows = merge_hourly(plasma, mag, step)
        if len(rows) < min_points:
            raise ValueError(f"only {len(rows)} valid points")
        return rows
    except Exception as e:  # network, TLS, JSON, anything
        warnings.warn(f"live solar wind unavailable ({e}); using the built-in offline sample", RuntimeWarning)
        return [dict(r) for r in SAMPLE_DATA]
