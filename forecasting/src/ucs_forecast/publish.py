"""Nightly forecasting job (Algorithm 4 in the report).

For every active device it reads validated readings from PostgreSQL, aggregates
them to hourly energy, backtests each model day-ahead on the most recent
BACKTEST_DAYS days, and keeps a model only if it beats the seasonal-naive
baseline on MAE. The chosen model is refitted on all data and its next-24-hour
forecast is stored in the "Forecast" table together with its errors.

Run: DATABASE_URL=postgresql://... uv run python -m ucs_forecast.publish
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import psycopg

from .metrics import EMISSION_FACTOR_KG_PER_KWH, mae, rmse, units_grams
from .models import HORIZON, MODELS

BACKTEST_DAYS = 3
BASELINE = "seasonal_naive_24h"
MODEL_VERSION = "1.0.0"


def hourly_from_readings(rows: list[tuple[int, float]]) -> pd.Series:
    """Rows are (capture timestamp in epoch seconds, kWh in the interval)."""
    frame = pd.DataFrame(rows, columns=["ts", "kwh"])
    frame["ts"] = pd.to_datetime(frame["ts"], unit="s", utc=True).dt.tz_convert(None)
    hourly = frame.set_index("ts")["kwh"].resample("h").sum()
    # Drop the trailing partial hour so the forecast starts on a complete hour.
    return hourly.iloc[:-1]


def select_and_forecast(series: pd.Series) -> dict:
    days = series.index.normalize().unique()
    test_days = days[-(BACKTEST_DAYS + 1) : -1] if len(days) > BACKTEST_DAYS + 1 else days[-2:-1]
    actual, preds = [], {name: [] for name in MODELS}
    for day in test_days:
        history = series[series.index < day]
        target = series.reindex(pd.date_range(day, periods=HORIZON, freq="h"))
        actual.append(target.to_numpy())
        for name, fn in MODELS.items():
            preds[name].append(fn(history))
    actual_arr = np.concatenate(actual)
    errors = {
        name: (mae(actual_arr, np.concatenate(p)), rmse(actual_arr, np.concatenate(p)))
        for name, p in preds.items()
    }
    base_mae, base_rmse = errors[BASELINE]
    candidates = [n for n in MODELS if n != BASELINE and errors[n][0] < base_mae]
    chosen = min(candidates, key=lambda n: errors[n][0]) if candidates else BASELINE
    forecast = MODELS[chosen](series)
    total = float(np.sum(forecast))
    return {
        "model": chosen,
        "mae": errors[chosen][0],
        "rmse": errors[chosen][1],
        "baseline_mae": base_mae,
        "baseline_rmse": base_rmse,
        "forecast": [round(float(v), 4) for v in forecast],
        "horizon_start": series.index[-1] + pd.Timedelta(hours=1),
        "total_kwh": total,
        "avg_kwh": total / HORIZON,
        "co2_kg": total * EMISSION_FACTOR_KG_PER_KWH,
        "units_g": units_grams(total),
        # Skill score against the baseline, clipped to [0, 1].
        "confidence": max(0.0, min(1.0, 1.0 - errors[chosen][0] / base_mae)) if base_mae else 0.0,
    }


MODEL_LABELS = {
    "seasonal_naive_24h": "Seasonal naive",
    "sarima": "SARIMA",
    "gradient_boosting": "Gradient Boosting",
}


def main() -> None:
    url = os.environ["DATABASE_URL"].split("?")[0]
    with psycopg.connect(url) as conn:
        devices = conn.execute(
            """SELECT "deviceId" FROM "Device" WHERE status = 'active' ORDER BY "deviceId" """
        ).fetchall()
        for (device_id,) in devices:
            rows = conn.execute(
                """SELECT "deviceTimestamp", "kwhInterval" FROM "Reading"
                   WHERE "deviceId" = %s AND validated ORDER BY "deviceTimestamp" """,
                (device_id,),
            ).fetchall()
            if len(rows) < 24 * 4:
                print(f"{device_id}: not enough history ({len(rows)} readings), skipped")
                continue
            result = select_and_forecast(hourly_from_readings(rows))
            conn.execute(
                """INSERT INTO "Forecast" (id, "deviceId", "generatedAt", "horizonStart",
                   "horizonHours", "modelName", "modelVersion", "energyKwh", "avgKwh",
                   "co2AvoidedKg", "unitsExpectedG", "maeKwh", "rmseKwh", "baselineMaeKwh",
                   "baselineRmseKwh", confidence)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    f"fc_{uuid.uuid4().hex[:20]}",
                    device_id,
                    datetime.now(UTC),
                    result["horizon_start"].to_pydatetime().replace(tzinfo=UTC),
                    HORIZON,
                    MODEL_LABELS[result["model"]],
                    MODEL_VERSION,
                    json.dumps(result["forecast"]),
                    result["avg_kwh"],
                    result["co2_kg"],
                    result["units_g"],
                    result["mae"],
                    result["rmse"],
                    result["baseline_mae"],
                    result["baseline_rmse"],
                    result["confidence"],
                ),
            )
            print(
                f"{device_id}: {MODEL_LABELS[result['model']]} "
                f"MAE {result['mae']:.3f} vs baseline {result['baseline_mae']:.3f} kWh, "
                f"next 24 h {result['total_kwh']:.2f} kWh"
            )
        conn.commit()


if __name__ == "__main__":
    main()
