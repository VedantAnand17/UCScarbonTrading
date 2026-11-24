"""Nightly forecasting job (Algorithm 4 in the report).

For every active device it reads validated readings from PostgreSQL or the Worker, aggregates
them to hourly energy, backtests each model day-ahead on the most recent
BACKTEST_DAYS days, and keeps a model only if it beats the seasonal-naive
baseline on MAE. The chosen model is refitted on all data and its next-24-hour
forecast is stored in the "Forecast" table together with its errors.

Run with DATABASE_URL for PostgreSQL, or pass --api URL for the Worker.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from datetime import UTC, datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

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
    days = pd.DatetimeIndex(series.index).normalize().unique()
    # The gradient booster needs a training row with both 24 h and 48 h lags.
    earliest = series.index[0] + pd.Timedelta(hours=49)
    test_days = days[:-1][days[:-1] >= earliest][-BACKTEST_DAYS:]
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


def build_forecast(device_id: str, rows: list[tuple[int, float]]) -> dict | None:
    if len(rows) < 24 * 4:
        print(f"{device_id}: not enough history ({len(rows)} readings), skipped")
        return None
    hourly = hourly_from_readings(rows)
    if len(hourly) < 24 * 4:
        print(f"{device_id}: not enough hourly history ({len(hourly)} hours), skipped")
        return None
    result = select_and_forecast(hourly)
    return {
        "id": f"fc_{uuid.uuid4().hex[:20]}",
        "deviceId": device_id,
        "generatedAt": datetime.now(UTC),
        "horizonStart": result["horizon_start"].to_pydatetime().replace(tzinfo=UTC),
        "horizonHours": HORIZON,
        "modelName": MODEL_LABELS[result["model"]],
        "modelVersion": MODEL_VERSION,
        "energyKwh": result["forecast"],
        "avgKwh": result["avg_kwh"],
        "co2AvoidedKg": result["co2_kg"],
        "unitsExpectedG": result["units_g"],
        "maeKwh": result["mae"],
        "rmseKwh": result["rmse"],
        "baselineMaeKwh": result["baseline_mae"],
        "baselineRmseKwh": result["baseline_rmse"],
        "confidence": result["confidence"],
    }


def report(forecast: dict) -> None:
    print(
        f"{forecast['deviceId']}: {forecast['modelName']} "
        f"MAE {forecast['maeKwh']:.3f} vs baseline {forecast['baselineMaeKwh']:.3f} kWh, "
        f"next {HORIZON} h {forecast['avgKwh'] * HORIZON:.2f} kWh"
    )


def publish_postgres() -> None:
    import psycopg

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
            forecast = build_forecast(device_id, rows)
            if forecast is None:
                continue
            conn.execute(
                """INSERT INTO "Forecast" (id, "deviceId", "generatedAt", "horizonStart",
                   "horizonHours", "modelName", "modelVersion", "energyKwh", "avgKwh",
                   "co2AvoidedKg", "unitsExpectedG", "maeKwh", "rmseKwh", "baselineMaeKwh",
                   "baselineRmseKwh", confidence)
                   VALUES (%(id)s, %(deviceId)s, %(generatedAt)s, %(horizonStart)s, %(horizonHours)s,
                   %(modelName)s, %(modelVersion)s, %(energyKwh)s, %(avgKwh)s, %(co2AvoidedKg)s,
                   %(unitsExpectedG)s, %(maeKwh)s, %(rmseKwh)s, %(baselineMaeKwh)s,
                   %(baselineRmseKwh)s, %(confidence)s)""",
                {**forecast, "energyKwh": json.dumps(forecast["energyKwh"])},
            )
            report(forecast)
        conn.commit()


def api_request(url: str, token: str | None = None, payload: dict | None = None):
    # Cloudflare rejects the default urllib user agent, so identify the job explicitly.
    headers = {"Accept": "application/json", "User-Agent": "ucs-forecast-job/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, allow_nan=False).encode()
    with urlopen(Request(url, data=data, headers=headers), timeout=30) as response:
        return json.load(response)


def publish_api(url: str) -> None:
    base = url.rstrip("/")
    if not base.endswith("/api/v1"):
        base += "/api/v1"
    token = os.environ.get("FORECAST_API_TOKEN")
    if not token:
        token = api_request(
            f"{base}/auth/login",
            payload={
                "email": os.environ["FORECAST_API_EMAIL"],
                "password": os.environ["FORECAST_API_PASSWORD"],
            },
        )["token"]

    devices = api_request(f"{base}/admin/devices", token)
    for device in devices:
        if device["status"] != "active":
            continue
        device_id = device["deviceId"]
        rows = []
        params = {"deviceId": device_id}
        while True:
            page = api_request(f"{base}/admin/readings?{urlencode(params)}", token)
            rows.extend((row["deviceTimestamp"], row["kwhInterval"]) for row in page["readings"])
            if page["nextCursor"] is None:
                break
            params["cursor"] = page["nextCursor"]
        forecast = build_forecast(device_id, rows)
        if forecast is None:
            continue
        wire_row = {
            **forecast,
            "generatedAt": forecast["generatedAt"].isoformat(),
            "horizonStart": forecast["horizonStart"].isoformat(),
            "unitsExpectedG": str(forecast["unitsExpectedG"]),
        }
        api_request(f"{base}/admin/forecasts", token, {"rows": [wire_row]})
        report(forecast)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", metavar="URL", help="Worker origin or /api/v1 base URL")
    args = parser.parse_args(argv)
    if args.api:
        publish_api(args.api)
    else:
        publish_postgres()


if __name__ == "__main__":
    main()
