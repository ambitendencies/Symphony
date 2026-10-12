import warnings

import numpy as np
import pytest

from symphony import live
from symphony.sources import get
from symphony.sources.solar_wind import SAMPLE_DATA, to_arrays

SR = 8000


def const(speed=450, density=5, temp=1e5, bz=3, n=6):
    return [{"speed": speed, "density": density, "temperature": temp, "bz": bz}] * n


def spectrum(x):
    m = x.mean(axis=1)
    return np.fft.rfftfreq(len(m), 1 / SR), np.abs(np.fft.rfft(m * np.hanning(len(m))))


def test_sample_is_realistic():
    a = to_arrays(SAMPLE_DATA)
    assert 48 <= len(a["speed"]) <= 72
    assert a["speed"].min() < 420 and a["speed"].max() > 640
    assert a["bz"].min() < -15 and a["density"].max() > 20


def test_faster_wind_is_higher_pitch():
    def drone_pitch(speed):
        f, s = spectrum(get("solar_wind", data=const(speed=speed)).render(3.0, SR))
        band = (f > 100) & (f < 600)
        return f[band][np.argmax(s[band])]
    assert drone_pitch(700) > drone_pitch(350) * 1.5


def test_southward_bz_adds_ominous_energy():
    def low_fraction(bz):
        f, s = spectrum(get("solar_wind", data=const(bz=bz)).render(3.0, SR))
        p = s ** 2
        return p[(f > 50) & (f < 90)].sum() / p.sum()
    assert low_fraction(-18) > 5 * low_fraction(+4)


def test_accepts_dict_of_arrays_and_nans():
    d = {"speed": [400, float("nan"), 600], "density": [5, 6, 7], "temperature": [1e5] * 3, "bz": [0, -5, -10]}
    assert np.isfinite(to_arrays(d)["speed"]).all()
    assert get("solar_wind", data=d).render(0.5, SR).shape == (SR // 2, 2)


def test_empty_data_raises():
    with pytest.raises(ValueError):
        to_arrays([])


PLASMA = [["time_tag", "density", "speed", "temperature"],
          ["2024-05-10 17:00:00.000", "5.1", "400.0", "100000"],
          ["2024-05-10 17:30:00.000", "5.3", "410.0", "110000"],
          ["2024-05-10 18:00:00.000", None, "420.0", "120000"],
          ["2024-05-10 19:00:00.000", "6.0", "800.0", "130000"],
          ["garbage", "1", "1", "1"]]
MAG = [["time_tag", "bx_gsm", "by_gsm", "bz_gsm", "lon_gsm", "lat_gsm", "bt"],
       ["2024-05-10 17:00:00.000", "1", "2", "-3.0", "0", "0", "4"],
       ["2024-05-10 17:30:00.000", "1", "2", "-5.0", "0", "0", "4"],
       ["2024-05-10 19:00:00.000", "1", "2", "null", "0", "0", "4"]]


def test_parse_and_merge():
    p, m = live.parse_plasma(PLASMA), live.parse_mag(MAG)
    assert len(p) == 4 and len(m) == 2  # bad time and all-null rows dropped
    rows = live.merge_hourly(p, m)
    # 17:00 bin has everything; 18:00 lacks density+bz; 19:00 lacks bz (null) -> dropped
    assert len(rows) == 1
    r = rows[0]
    assert r["speed"] == pytest.approx(405) and r["bz"] == pytest.approx(-4) and r["time"].startswith("2024-05-10T17")
    assert get("solar_wind", data=rows * 3).render(0.5, SR).shape[0] == SR // 2


def test_fetch_falls_back(monkeypatch):
    def boom(*a, **k):
        raise OSError("no network")
    monkeypatch.setattr(live.urllib.request, "urlopen", boom)
    with pytest.warns(RuntimeWarning, match="offline sample"):
        rows = live.fetch_solar_wind(timeout=0.1)
    assert rows == SAMPLE_DATA


def test_fetch_success_with_fake_network(monkeypatch):
    import io, json

    class R(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake(req, timeout=None):
        return R(json.dumps(PLASMA_LONG if "plasma" in req.full_url else MAG_LONG).encode())

    PLASMA_LONG = [PLASMA[0]] + [[f"2024-05-10 {h:02d}:00:00.000", "5", "400", "1e5"] for h in range(10)]
    MAG_LONG = [MAG[0]] + [[f"2024-05-10 {h:02d}:00:00.000", "1", "1", "-2", "0", "0", "3"] for h in range(10)]
    monkeypatch.setattr(live.urllib.request, "urlopen", fake)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        rows = live.fetch_solar_wind()
    assert len(rows) == 10
