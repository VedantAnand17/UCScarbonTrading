"""Load the Kaggle "Solar Power Generation Data" plants as hourly plant-level energy series."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "raw"

PLANTS = {
    "plant1": {"file": "Plant_1_Generation_Data.csv", "date_format": "%d-%m-%Y %H:%M"},
    "plant2": {"file": "Plant_2_Generation_Data.csv", "date_format": "%Y-%m-%d %H:%M:%S"},
}

# Inverter telemetry is reported every 15 minutes, so a power sample in kW
# represents 0.25 h of energy.
SAMPLE_HOURS = 0.25

# Isolated gaps of up to this many hours are linearly interpolated; longer
# gaps are left as NaN and dropped from training and scoring.
MAX_INTERPOLATED_GAP_H = 2


def to_hourly_energy(raw: pd.DataFrame, date_format: str) -> pd.Series:
    """Convert per-inverter 15-minute AC power rows into hourly plant energy in kWh."""
    df = raw.copy()
    df["ts"] = pd.to_datetime(df["DATE_TIME"], format=date_format)
    df = df.drop_duplicates(subset=["ts", "SOURCE_KEY"])
    plant_kw = df.groupby("ts")["AC_POWER"].sum()
    energy_15m = plant_kw * SAMPLE_HOURS
    full_index = pd.date_range(
        energy_15m.index.min().floor("h"), energy_15m.index.max(), freq="15min"
    )
    energy_15m = energy_15m.reindex(full_index)
    # An hour is only trusted when all four 15-minute samples are present.
    hourly = energy_15m.resample("h").sum(min_count=4)
    hourly = hourly.interpolate(method="linear", limit=MAX_INTERPOLATED_GAP_H, limit_area="inside")
    hourly.name = "kwh"
    return hourly


def load_plant(plant: str, raw_dir: Path = RAW_DIR) -> pd.Series:
    spec = PLANTS[plant]
    raw = pd.read_csv(raw_dir / spec["file"])
    return to_hourly_energy(raw, spec["date_format"])


def calendar_features(index: pd.DatetimeIndex) -> pd.DataFrame:
    hour = index.hour.to_numpy()
    return pd.DataFrame(
        {
            "hour": hour,
            "hour_sin": np.sin(2 * np.pi * hour / 24),
            "hour_cos": np.cos(2 * np.pi * hour / 24),
            "dayofyear": index.day_of_year.to_numpy(),
        },
        index=index,
    )
