"""Physics checks for the Phase 2 sources: the numbers behind the sounds."""

import numpy as np
import pytest

from symphony.mapping import freq_to_midi
from symphony.sources import black_hole, get, gravitational, plasma, pulsars, trappist

SR = 8000


def dominant_freq(x, sr):
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    return np.fft.rfftfreq(len(x), 1 / sr)[np.argmax(spec)]


# --- TRAPPIST-1 -------------------------------------------------------------

def test_trappist_resonances_within_two_percent():
    for ratio, (p, q) in zip(trappist.period_ratios(), trappist.RESONANCES):
        assert ratio == pytest.approx(p / q, rel=0.02)


def test_trappist_intervals_are_physical():
    f, octaves = trappist.frequencies()
    assert octaves == 27
    P = trappist.PLANETS
    assert f["b"] / f["h"] == pytest.approx(P["h"] / P["b"])
    assert all(55 <= v <= 1760 for v in f.values())


# --- Pulsars ----------------------------------------------------------------

def test_millisecond_pulsar_is_audible_pitch():
    f = pulsars.spin_frequency(pulsars.PULSARS["B1937+21"][0])
    assert f == pytest.approx(641.9, abs=0.5)
    assert pulsars.spin_frequency(pulsars.PULSARS["J0437-4715"][0]) == pytest.approx(173.7, abs=0.2)
    assert pulsars.spin_frequency(pulsars.PULSARS["B0329+54"][0]) < pulsars.PITCH_THRESHOLD_HZ


def test_dispersion_delay_vela():
    # Vela DM 68: 0.4 GHz arrives ~1.6 s after 1.4 GHz.
    assert pulsars.dispersion_delay(67.99, 0.4, 1.4) == pytest.approx(1.62, abs=0.05)


def test_b1937_heard_at_true_pitch():
    # A narrow pulse train has near-equal harmonics; the fundamental (the
    # pulse rate) must be the strongest line below the 2nd harmonic.
    a = get("pulsars", pulsars=["B1937+21"]).render(1.0, SR)[:, 0]
    spec = np.abs(np.fft.rfft(a * np.hanning(len(a))))
    f = np.fft.rfftfreq(len(a), 1 / SR)
    low = f < 1000
    assert f[low][np.argmax(spec[low])] == pytest.approx(641.9, abs=3)
    assert spec[low].max() > 0.5 * spec.max()


# --- Gravitational waves ----------------------------------------------------

def test_chirp_mass_of_gw150914():
    assert gravitational.chirp_mass(36, 29) == pytest.approx(28.1, abs=0.3)


def test_chirp_frequency_rises_monotonically_in_ligo_band():
    tau0 = gravitational.time_to_coalescence(gravitational.F_START)
    assert 0.1 < tau0 < 0.3  # the audible chirp lasts ~0.2 s
    tau = np.linspace(tau0, gravitational.time_to_coalescence(gravitational.F_MERGE), 500)
    f = gravitational.chirp_frequency(tau)
    assert np.all(np.diff(f) > 0)
    assert f[0] == pytest.approx(35, rel=1e-6)
    assert 30 <= f.min() and f.max() <= 300


def test_chirp_waveform_true_speed():
    h, f = gravitational.chirp_waveform(SR)
    assert len(h) / SR == pytest.approx(0.2, abs=0.05)
    n_insp = int(np.argmax(f >= gravitational.F_MERGE * 0.999))
    assert np.all(np.diff(f[:n_insp]) >= 0)
    early, late = h[: n_insp // 3], h[n_insp // 2: n_insp]
    assert np.max(np.abs(late)) > np.max(np.abs(early))  # amplitude ∝ f^(2/3)


def test_stretched_chirp_is_shifted_up():
    _, f = gravitational.chirp_waveform(SR, stretch=10, pitch=4)
    assert f[0] == pytest.approx(140, rel=0.01)


# --- Perseus black hole -----------------------------------------------------

def test_perseus_is_b_flat_after_57_octaves():
    assert black_hole.perseus_frequency(0) == pytest.approx(3.3e-15, rel=0.01)
    f = black_hole.perseus_frequency(57)
    assert f == pytest.approx(476, abs=2)
    midi = float(freq_to_midi(f))
    assert round(midi) % 12 == 10  # B-flat
    assert abs(midi - round(midi)) < 0.5
    name, cents = black_hole.note_name(f)
    assert name == "B♭4" and abs(cents) < 50


# --- Plasma -----------------------------------------------------------------

def test_voyager_plasma_frequency():
    assert plasma.plasma_frequency(0.08) == pytest.approx(2540, rel=0.03)  # ~2.5–2.6 kHz


def test_chorus_is_audible_at_true_pitch():
    f_ce = plasma.cyclotron_frequency(5.0)
    assert f_ce == pytest.approx(6960, rel=0.02)
    assert 500 < 0.1 * f_ce and 0.5 * f_ce < 5000


def test_whistler_falls_per_eckersley():
    t = np.linspace(0.5, 2.5, 50)
    f = plasma.whistler_frequency(t, 50.0)
    assert np.all(np.diff(f) < 0)
    assert np.allclose(50.0 / np.sqrt(f), t)
