# Forecasting module

Day-ahead forecasting of hourly solar generation, from which the platform derives average generation, CO2 avoided (CEA factor 0.710 kgCO2/kWh) and expected prototype units.

## Dataset

Solar Power Generation Data (Ani Kannal, Kaggle, 2020): 34 days (15 May to 17 June 2020) of 15-minute inverter telemetry from two grid-connected solar plants in India.
Inverter AC power is summed per plant and converted to hourly energy in kWh.

## Protocol

- Rolling-origin day-ahead evaluation over the last 7 days (168 hours per plant).
- Each test day, every model is refitted only on data before midnight of that day and forecasts the next 24 hours.
- Baseline: seasonal naive with a 24-hour season (tomorrow equals today).
- Models: SARIMA(1,0,1)(1,1,1)24 and gradient boosting on calendar and lag features (lags of at least 24 hours only).
- Metrics: MAE and RMSE in kWh per hour, pooled over all test hours.

## Run

```bash
./download_data.sh
uv run pytest
uv run python -m ucs_forecast.evaluate   # writes results/metrics.json, CSVs and plots
```
