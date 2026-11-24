"""Day-ahead forecasters. Each takes the history up to a forecast origin and returns 24 hourly values."""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from statsmodels.tsa.statespace.sarimax import SARIMAX

from .data import calendar_features

HORIZON = 24


def seasonal_naive(history: pd.Series, horizon: int = HORIZON, period: int = 24) -> np.ndarray:
    """Repeat the last observed season: y(t + h) = y(t + h - period)."""
    last_season = history.iloc[-period:].to_numpy()
    reps = int(np.ceil(horizon / period))
    return np.tile(last_season, reps)[:horizon]


def sarima(history: pd.Series, horizon: int = HORIZON) -> np.ndarray:
    """SARIMA(1,0,1)(1,1,1)_24 fitted on the history; negative outputs clipped to zero."""
    y = history.interpolate(limit_direction="both")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = SARIMAX(
            y.to_numpy(),
            order=(1, 0, 1),
            seasonal_order=(1, 1, 1, 24),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        fit = model.fit(disp=False, maxiter=200)
        pred = fit.forecast(horizon)
    return np.clip(pred, 0, None)


def _lag_features(series: pd.Series, index: pd.DatetimeIndex) -> pd.DataFrame:
    """Features for target hours in `index`, using only values at least 24 h older."""
    feats = calendar_features(index)
    for lag in (24, 48, 72, 168):
        feats[f"lag{lag}"] = series.reindex(index - pd.Timedelta(hours=lag)).to_numpy()
    feats["same_hour_mean_3d"] = feats[["lag24", "lag48", "lag72"]].mean(axis=1)
    daily_total = series.resample("D").sum(min_count=20)
    prev_day = index.normalize() - pd.Timedelta(days=1)
    feats["prev_day_total"] = daily_total.reindex(prev_day).to_numpy()
    return feats


def gradient_boosting(history: pd.Series, horizon: int = HORIZON, seed: int = 0) -> np.ndarray:
    """Direct day-ahead gradient boosting on calendar and >=24 h lag features."""
    train_index = pd.DatetimeIndex(history.index[history.notna()])
    X_train = _lag_features(history, train_index)
    y_train = history.loc[train_index]
    keep = X_train[["lag24", "lag48"]].notna().all(axis=1)
    X_train, y_train = X_train[keep].dropna(axis=1, how="all"), y_train[keep]

    model = HistGradientBoostingRegressor(
        max_iter=400,
        learning_rate=0.05,
        max_leaf_nodes=15,
        l2_regularization=1.0,
        random_state=seed,
    )
    model.fit(X_train, y_train)

    target_index = pd.date_range(
        history.index[-1] + pd.Timedelta(hours=1), periods=horizon, freq="h"
    )
    X_test = _lag_features(history, target_index)
    pred = model.predict(X_test[X_train.columns])
    # Night hours: the plant cannot generate when it produced nothing at that
    # hour on each of the previous three days.
    night = (X_test[["lag24", "lag48", "lag72"]].fillna(0) == 0).all(axis=1).to_numpy()
    pred[night] = 0.0
    return np.clip(pred, 0, None)


MODELS = {
    "seasonal_naive_24h": seasonal_naive,
    "sarima": sarima,
    "gradient_boosting": gradient_boosting,
}
