"""Rolling-origin day-ahead evaluation on the last TEST_DAYS days of each plant.

For every test day the models are trained only on data before midnight of that
day and forecast its 24 hours. Errors are pooled over all test hours.

Run: uv run python -m ucs_forecast.evaluate
"""

from __future__ import annotations

import json
import platform
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .data import load_plant
from .metrics import co2_avoided_kg, mae, rmse, skill, units_grams
from .models import HORIZON, MODELS

TEST_DAYS = 7
BASELINE = "seasonal_naive_24h"
RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"
LABELS = {
    "seasonal_naive_24h": "Seasonal naive (24 h)",
    "sarima": "SARIMA(1,0,1)(1,1,1)24",
    "gradient_boosting": "Gradient boosting",
}


def backtest(series: pd.Series) -> tuple[pd.DataFrame, dict]:
    fit_seconds = {name: 0.0 for name in MODELS}
    days = pd.Series(series.index.normalize().unique())
    test_days = days.iloc[-TEST_DAYS:]
    rows = []
    for day in test_days:
        history = series[series.index < day]
        target_index = pd.date_range(day, periods=HORIZON, freq="h")
        actual = series.reindex(target_index)
        frame = pd.DataFrame({"actual": actual.to_numpy()}, index=target_index)
        for name, fn in MODELS.items():
            started = time.perf_counter()
            frame[name] = fn(history)
            fit_seconds[name] += time.perf_counter() - started
        rows.append(frame)
    return pd.concat(rows), fit_seconds


def score(frame: pd.DataFrame) -> dict:
    scored = frame.dropna(subset=["actual"])
    daylight = scored[scored["actual"] > 0]
    out = {}
    base_mae = mae(scored["actual"], scored[BASELINE])
    base_rmse = rmse(scored["actual"], scored[BASELINE])
    mean_daylight = float(daylight["actual"].mean())
    for name in MODELS:
        m_mae = mae(scored["actual"], scored[name])
        m_rmse = rmse(scored["actual"], scored[name])
        daily_actual = scored["actual"].resample("D").sum()
        daily_pred = scored[name].resample("D").sum()
        out[name] = {
            "label": LABELS[name],
            "mae_kwh": round(m_mae, 1),
            "rmse_kwh": round(m_rmse, 1),
            "nmae_pct_of_mean_daylight": round(100 * m_mae / mean_daylight, 2),
            "nrmse_pct_of_mean_daylight": round(100 * m_rmse / mean_daylight, 2),
            "daylight_mae_kwh": round(mae(daylight["actual"], daylight[name]), 1),
            "daily_energy_mape_pct": round(
                float(np.mean(np.abs(daily_pred - daily_actual) / daily_actual) * 100), 2
            ),
            "mae_skill_vs_baseline_pct": round(100 * skill(m_mae, base_mae), 1),
            "rmse_skill_vs_baseline_pct": round(100 * skill(m_rmse, base_rmse), 1),
        }
    out["_meta"] = {
        "test_hours": len(scored),
        "daylight_hours": len(daylight),
        "mean_daylight_kwh": round(mean_daylight, 1),
        "test_start": str(scored.index.min()),
        "test_end": str(scored.index.max()),
    }
    return out


def plot(plant: str, series: pd.Series, frame: pd.DataFrame, path: Path) -> None:
    fig, ax = plt.subplots(figsize=(11, 4.2), dpi=160)
    context = series[series.index >= frame.index.min() - pd.Timedelta(days=2)]
    context = context[context.index < frame.index.min()]
    ax.plot(
        context.index, context / 1000, color="#9aa4b2", lw=1.2, label="Training data (last 2 days)"
    )
    ax.plot(frame.index, frame["actual"] / 1000, color="#111827", lw=1.6, label="Measured")
    ax.plot(
        frame.index,
        frame[BASELINE] / 1000,
        color="#f59e0b",
        lw=1.2,
        ls="--",
        label=LABELS[BASELINE],
    )
    ax.plot(frame.index, frame["sarima"] / 1000, color="#6366f1", lw=1.2, label=LABELS["sarima"])
    ax.plot(
        frame.index,
        frame["gradient_boosting"] / 1000,
        color="#059669",
        lw=1.6,
        label=LABELS["gradient_boosting"],
    )
    ax.set_ylabel("Hourly energy (MWh)")
    ax.set_title(
        f"Day-ahead generation forecast, {plant.replace('plant', 'Plant ')}, rolling 7-day hold-out"
    )
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left", ncols=3, fontsize=8, frameon=False)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def plot_errors(results: dict, path: Path) -> None:
    plants = [p for p in results if not p.startswith("_")]
    names = list(MODELS)
    colors = {"seasonal_naive_24h": "#f59e0b", "sarima": "#6366f1", "gradient_boosting": "#059669"}
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), dpi=160)
    width = 0.26
    x = np.arange(len(plants))
    for ax, metric, title in zip(axes, ("mae_kwh", "rmse_kwh"), ("MAE", "RMSE")):
        for i, name in enumerate(names):
            vals = [results[p]["metrics"][name][metric] / 1000 for p in plants]
            bars = ax.bar(x + (i - 1) * width, vals, width, label=LABELS[name], color=colors[name])
            ax.bar_label(bars, fmt="%.2f", fontsize=7, padding=2)
        ax.set_xticks(x, [p.replace("plant", "Plant ") for p in plants])
        ax.set_ylabel(f"{title} (MWh per hour)")
        ax.set_title(f"Day-ahead {title} on 7-day hold-out")
        ax.grid(axis="y", alpha=0.25)
    axes[0].legend(fontsize=7, frameon=False)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    RESULTS_DIR.mkdir(exist_ok=True)
    results: dict = {}
    for plant in ("plant1", "plant2"):
        series = load_plant(plant)
        frame, fit_seconds = backtest(series)
        results[plant] = {
            "metrics": score(frame),
            "fit_seconds": {k: round(v, 2) for k, v in fit_seconds.items()},
        }
        last_day = frame[frame.index >= frame.index.max().normalize()]
        gb_kwh = float(last_day["gradient_boosting"].sum())
        results[plant]["example_last_day"] = {
            "date": str(last_day.index.min().date()),
            "forecast_kwh": round(gb_kwh, 1),
            "measured_kwh": round(float(last_day["actual"].sum()), 1),
            "forecast_avg_hourly_kwh": round(gb_kwh / 24, 1),
            "forecast_co2_avoided_kg": round(co2_avoided_kg(gb_kwh), 1),
            "forecast_units_g": units_grams(gb_kwh),
        }
        frame.to_csv(RESULTS_DIR / f"{plant}_backtest.csv", index_label="hour")
        plot(plant, series, frame, RESULTS_DIR / f"{plant}_forecast.png")
    plot_errors(results, RESULTS_DIR / "error_comparison.png")
    results["_run"] = {
        "dataset": "Solar Power Generation Data (Kannal, Kaggle 2020), Plants 1 and 2, India",
        "resolution": "15-min inverter AC power aggregated to hourly plant energy",
        "protocol": f"rolling-origin day-ahead, last {TEST_DAYS} days held out, retrained daily",
        "python": platform.python_version(),
    }
    (RESULTS_DIR / "metrics.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
