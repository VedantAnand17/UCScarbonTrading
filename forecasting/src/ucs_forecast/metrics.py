"""Forecast accuracy metrics and the carbon unit conversion used by the platform."""

from __future__ import annotations

import numpy as np

# Central Electricity Authority grid emission factor used by the platform (version CEA-v20).
EMISSION_FACTOR_KG_PER_KWH = 0.710


def mae(actual: np.ndarray, pred: np.ndarray) -> float:
    actual, pred = np.asarray(actual, float), np.asarray(pred, float)
    return float(np.mean(np.abs(actual - pred)))


def rmse(actual: np.ndarray, pred: np.ndarray) -> float:
    actual, pred = np.asarray(actual, float), np.asarray(pred, float)
    return float(np.sqrt(np.mean((actual - pred) ** 2)))


def skill(model_error: float, baseline_error: float) -> float:
    """Relative improvement over the baseline: 1 - model / baseline."""
    return 1.0 - model_error / baseline_error


def co2_avoided_kg(kwh: float) -> float:
    return kwh * EMISSION_FACTOR_KG_PER_KWH


def units_grams(kwh: float) -> int:
    """Prototype units in integer grams of CO2e, matching the backend's ledger."""
    return int(np.floor(kwh * EMISSION_FACTOR_KG_PER_KWH * 1000))
