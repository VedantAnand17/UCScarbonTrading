import numpy as np
import pandas as pd
import pytest

from ucs_forecast.data import to_hourly_energy
from ucs_forecast.metrics import co2_avoided_kg, mae, rmse, skill, units_grams
from ucs_forecast.models import gradient_boosting, seasonal_naive


def test_mae_and_rmse():
    actual = np.array([0.0, 2.0, 4.0])
    pred = np.array([1.0, 2.0, 1.0])
    assert mae(actual, pred) == pytest.approx(4 / 3)
    assert rmse(actual, pred) == pytest.approx(np.sqrt(10 / 3))


def test_skill_is_relative_improvement():
    assert skill(75.0, 100.0) == pytest.approx(0.25)


def test_unit_conversion_matches_backend_rule():
    assert co2_avoided_kg(100) == pytest.approx(71.0)
    assert units_grams(1.2345) == 876  # floor(1.2345 * 0.710 * 1000)


def test_seasonal_naive_repeats_last_day():
    idx = pd.date_range("2020-05-15", periods=48, freq="h")
    history = pd.Series(np.arange(48, dtype=float), index=idx)
    np.testing.assert_array_equal(seasonal_naive(history), np.arange(24, 48))


def test_hourly_energy_sums_inverters_and_converts_15min_power():
    rows = []
    for minute in (0, 15, 30, 45):
        for inverter in ("a", "b"):
            rows.append(
                {
                    "DATE_TIME": f"15-05-2020 10:{minute:02d}",
                    "SOURCE_KEY": inverter,
                    "AC_POWER": 100.0,
                }
            )
    # Duplicate telemetry row must not be counted twice.
    rows.append({"DATE_TIME": "15-05-2020 10:00", "SOURCE_KEY": "a", "AC_POWER": 100.0})
    hourly = to_hourly_energy(pd.DataFrame(rows), "%d-%m-%Y %H:%M")
    # 2 inverters x 100 kW x 1 h = 200 kWh
    assert hourly.loc["2020-05-15 10:00"] == pytest.approx(200.0)


def test_gradient_boosting_learns_a_repeating_solar_day():
    idx = pd.date_range("2020-05-01", periods=24 * 14, freq="h")
    profile = np.clip(np.sin((idx.hour.to_numpy() - 6) / 12 * np.pi), 0, None) * 100
    history = pd.Series(profile, index=idx)
    pred = gradient_boosting(history)
    expected = profile[:24]
    assert mae(expected, pred) < 2.0
    assert pred[0] == 0.0  # midnight is forced to zero


def test_publish_selects_a_model_that_beats_the_baseline_on_noisy_solar_days():
    from ucs_forecast.publish import hourly_from_readings, select_and_forecast

    rng = np.random.default_rng(1)
    start = int(pd.Timestamp("2026-11-01").timestamp())
    rows = []
    for minute in range(0, 60 * 24 * 14, 15):
        hour = (minute // 60) % 24
        sun = max(0.0, np.sin((hour - 6) / 12 * np.pi))
        rows.append((start + minute * 60, 10 * sun * rng.uniform(0.6, 1.0) / 4))
    series = hourly_from_readings(rows)
    assert series.index[-1] == pd.Timestamp("2026-11-14 22:00")  # trailing partial hour dropped
    result = select_and_forecast(series)
    assert len(result["forecast"]) == 24
    assert result["mae"] <= result["baseline_mae"]
    assert result["units_g"] == int(np.floor(result["total_kwh"] * 0.710 * 1000))
    assert 0.0 <= result["confidence"] <= 1.0
