import numpy as np
import pytest

from symphony import audio, mapping, synth
from symphony.audio import SAMPLE_RATE
from symphony.cli import main
from symphony.score import Movement, Track, default_symphony, solo
from symphony.sources import REGISTRY, get
from symphony.sources.orbits import PLANETS, frequencies

SR = 8000  # keep tests fast


def dominant_freq(x, sr):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return np.fft.rfftfreq(len(x), 1 / sr)[np.argmax(spec)]


def test_wav_roundtrip(tmp_path):
    sig = audio.to_stereo(0.5 * synth.sine(440, 0.25, SR))
    path = audio.write_wav(tmp_path / "t.wav", sig, SR)
    back, sr = audio.read_wav(path)
    assert sr == SR and back.shape == sig.shape
    assert np.allclose(back, sig, atol=1e-3)


def test_fade_and_fit():
    sig = np.ones((1000, 2), dtype=np.float32)
    f = audio.fade(sig, 0.01, 0.01, sr=10_000)
    assert f[0, 0] == 0 and f[-1, 0] == 0 and f[500, 0] == 1
    assert audio.fit_length(sig, 10).shape == (10, 2)
    assert audio.fit_length(sig, 1200).shape == (1200, 2)


def test_sine_frequency_and_chirp():
    assert dominant_freq(synth.sine(440, 1.0, SR), SR) == pytest.approx(440, abs=2)
    sweep = synth.sine(np.linspace(200, 2000, SR), 1.0, SR)
    early, late = sweep[: SR // 4], sweep[-SR // 4:]
    assert dominant_freq(late, SR) > dominant_freq(early, SR) * 3


def test_bandpass_attenuates_outside_band():
    x = synth.sine(100, 1, SR) + synth.sine(2000, 1, SR)
    y = synth.bandpass(x, 1000, 3000, SR)
    spec = np.abs(np.fft.rfft(y))
    f = np.fft.rfftfreq(len(y), 1 / SR)
    assert spec[np.argmin(abs(f - 2000))] > 50 * spec[np.argmin(abs(f - 100))]


def test_noise_deterministic():
    assert np.array_equal(synth.noise(0.1, SR, seed=3, color="pink"),
                          synth.noise(0.1, SR, seed=3, color="pink"))


def test_shared_transposition_preserves_ratios():
    f = np.array([1 / 87.969, 1 / 365.256])
    shifted, n = mapping.shared_transposition(f)
    assert shifted[0] / shifted[1] == pytest.approx(f[0] / f[1])
    assert mapping.MUSICAL[0] / 4 < np.exp(np.mean(np.log(shifted))) < mapping.MUSICAL[1] * 4


def test_audify_shifts_frequency():
    data_rate = 10.0  # e.g. a magnetometer sampled at 10 Hz
    t = np.arange(2000) / data_rate
    data = np.sin(2 * np.pi * 0.5 * t)  # 0.5 Hz wave
    speedup = mapping.speedup_for(0.5, 440)
    out = mapping.audify(data, data_rate, speedup, SR)
    assert dominant_freq(out, SR) == pytest.approx(440, rel=0.02)


def test_quantize_to_scale():
    q = mapping.quantize_to_scale(np.array([450.0]), "major", root_midi=57)
    assert q[0] == pytest.approx(440.0)


def test_orbit_intervals_are_physical():
    f = frequencies()
    assert f["Mercury"] / f["Earth"] == pytest.approx(PLANETS["Earth"] / PLANETS["Mercury"])


def test_unknown_source():
    with pytest.raises(KeyError):
        get("no-such-thing")


def test_movement_and_symphony_render():
    m = Movement("t", 1.0, [Track("orbits"), Track("orbits", start=0.5, pan=0.5)], reverb=0.1)
    out = m.render(SR)
    assert out.shape == (SR, 2) and np.max(np.abs(out)) <= 1.0
    sym = default_symphony(scale=0.05)
    assert len(sym.movements) >= 1
    assert sym.render(SR).shape[0] == pytest.approx(sym.duration * SR, abs=len(sym.movements) * 2)


def test_solo():
    assert solo("orbits", 0.5, SR).shape == (SR // 2, 2)


def test_cli(tmp_path, capsys):
    assert main(["list"]) == 0
    assert "orbits" in capsys.readouterr().out
    assert main(["info", "orbits"]) == 0
    out = tmp_path / "o.wav"
    assert main(["render", "-s", "orbits", "-d", "0.5", "--rate", str(SR), "-o", str(out)]) == 0
    assert out.exists()


# --- contract tests run against EVERY registered source ---------------------

@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_source_contract(name):
    src = get(name)
    assert src.title and len(src.science) > 80, "explain the physics and the mapping"
    a = src.render(1.5, SR)
    assert a.shape == (int(round(1.5 * SR)), 2)
    assert a.dtype == np.float32
    assert np.isfinite(a).all()
    assert np.max(np.abs(a)) <= 1.0
    assert np.max(np.abs(a)) > 0.1, "should not be silent"
    assert np.array_equal(a, get(name).render(1.5, SR)), "must be deterministic"


def test_fold_into_keeps_pitch_class():
    f = np.array([5.0, 300.0, 9000.0])
    g = mapping.fold_into(f, (55, 1760))
    assert ((g >= 55) & (g <= 1760)).all()
    assert np.allclose(np.log2(g / f) % 1, 0)
