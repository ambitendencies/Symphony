"""Offline pipeline: rebuilds every archive from embedded published values."""

from __future__ import annotations

import json

import pytest

from pipeline import asteroseismology, build_all, gw_events, pulsars
from pipeline.common import DATA_DIR, lookback_gyr, write_json


@pytest.fixture()
def built(tmp_path):
    out = {}
    for mod in (pulsars, asteroseismology, gw_events):
        path = tmp_path / f"{mod.VOICE}.json"
        assert mod.main(["--offline", "--out", str(path)]) == 0
        out[mod.VOICE] = json.loads(path.read_text())
    return out


def test_envelopes(built):
    for voice, doc in built.items():
        assert doc["version"] == 1
        assert doc["voice"] == voice
        assert doc["kind"] == "archive"
        assert doc["source"] and doc["updated"].endswith("Z")


def test_pulsar_values(built):
    by = {p["bname"] or p["jname"]: p for p in built["pulsar-clocks"]["pulsars"]}
    assert by["B0833-45"]["p0"] == pytest.approx(0.08933, abs=1e-5)
    # ATNF quotes the Crab at its 1968 reference epoch (33.39 ms); it has since slowed to ~33.7 ms.
    assert by["B0531+21"]["p0"] == pytest.approx(0.03339, abs=1e-5)
    assert by["B0329+54"]["p0"] == pytest.approx(0.7145, abs=1e-4)
    assert by["J0437-4715"]["p0"] == pytest.approx(0.005757, abs=1e-6)
    assert by["B1937+21"]["p0"] == pytest.approx(0.0015578, abs=1e-7)
    assert by["B1919+21"]["p0"] == pytest.approx(1.3373, abs=1e-4)
    # Crab characteristic age P/2Ṗ ≈ 1,260 yr.
    crab = by["B0531+21"]
    assert crab["p0"] / (2 * crab["p1"]) / 3.156e7 == pytest.approx(1257, rel=0.02)


def test_star_modes(built):
    stars = {s["name"]: s for s in built["singing-stars"]["stars"]}
    assert stars["the Sun"]["numax"] == 3090 and stars["the Sun"]["measuredModes"] is True
    cyg = stars["16 Cygni A"]
    assert cyg["measuredModes"] is False
    radial = [m["freq"] for m in cyg["modes"] if m["l"] == 0]
    assert all(abs((b - a) - cyg["dnu"]) < 0.01 for a, b in zip(radial, radial[1:]))
    for s in stars.values():
        assert all(abs(m["freq"] - s["numax"]) <= 1.6 * s["dnu"] + 1e-6 for m in s["modes"])
    # Red giant universal pattern: ε ≈ 1.2 for Δν ≈ 9.5 µHz.
    assert stars["Kepler-91"]["eps"] == pytest.approx(1.218, abs=0.01)


def test_gw_events(built):
    events = {e["name"]: e for e in built["black-hole-chirps"]["events"]}
    gw = events["GW150914"]
    assert gw["mchirp"] == pytest.approx(28.7, abs=0.2)
    assert gw["lookback_gyr"] == pytest.approx(1.25, abs=0.1)  # "1.3 billion light-years"
    assert events["GW170817"]["kind"] == "BNS"
    assert events["GW170817"]["lookback_gyr"] == pytest.approx(0.13, abs=0.01)
    assert events["GW190521"]["lookback_gyr"] == pytest.approx(7.1, abs=0.3)
    for e in events.values():
        if e["kind"] == "BBH":
            assert e["mfinal"] < e["m1"] + e["m2"]


def test_cosmology_round_trip():
    assert gw_events.redshift_from_distance(gw_events.luminosity_distance_mpc(0.3)) == pytest.approx(0.3, abs=1e-6)
    assert lookback_gyr(0) == 0
    assert lookback_gyr(1.0) == pytest.approx(7.9, abs=0.2)


def test_validation_rejects_bad_values():
    rows = pulsars.offline_rows()
    rows[0]["p0"] = -1
    with pytest.raises(ValueError):
        pulsars.validate(rows)
    events = gw_events.offline_events()
    events[0]["mfinal"] = 1000
    with pytest.raises(ValueError):
        gw_events.validate(events)


def test_offline_is_deterministic_and_matches_shipped_archives(tmp_path):
    """The archives in the repo are exactly what --offline produces (apart from `updated`)."""
    for mod in (pulsars, asteroseismology, gw_events):
        doc = mod.build(True)
        shipped = json.loads((DATA_DIR / f"{mod.VOICE}.json").read_text())
        strip = lambda d: {k: v for k, v in d.items() if k != "updated"}  # noqa: E731
        assert strip(json.loads(json.dumps(doc))) == strip(shipped)
        path = tmp_path / "x.json"
        assert write_json(doc, path) is True
        assert write_json(mod.build(True), path) is False  # unchanged content is not rewritten


def test_online_failure_falls_back(monkeypatch):
    def boom():
        raise OSError("no network")

    monkeypatch.setattr(gw_events, "fetch_events", boom)
    with pytest.warns(UserWarning):
        doc = gw_events.build(False)
    assert doc["source"] == gw_events.SOURCE_OFFLINE
    with pytest.raises(OSError):
        gw_events.build(False, strict=True)


def test_build_all_offline(tmp_path):
    assert build_all.main(["--offline", "--out-dir", str(tmp_path)]) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "black-hole-chirps.json", "pulsar-clocks.json", "singing-stars.json"]
