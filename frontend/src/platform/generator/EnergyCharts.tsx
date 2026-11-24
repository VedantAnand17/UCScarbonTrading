import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCarbon, formatDateTime, formatNumber } from "../format";
import type { DeviceStatus, Forecast, Generation } from "../types";
import { Empty, StatusPill } from "../ui";

const hour = 3_600_000;
const axisDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const axisText = { fill: "#516860", fontSize: 11 };
const axisLine = { stroke: "#dce6e0" };
const actualColor = "#157654";
const forecastColor = "#4c68ad";

type Point = { time: number; actual?: number; forecast?: number };

function EnergyChart({ data, comparison = false }: { data: Point[]; comparison?: boolean }) {
  const tickStep = (comparison ? 24 : 48) * hour;
  const ticks: number[] = [];
  const end = data[data.length - 1].time;
  for (let time = data[0].time; time <= end; time += tickStep) ticks.push(time);

  return (
    <div className="energy-chart">
      <span className="energy-axis-unit">kWh</span>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 580, height: 252 }}>
        <AreaChart accessibilityLayer data={data} margin={{ top: 12, right: 16, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={comparison ? "forecast-actual-area" : "generation-area"} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={actualColor} stopOpacity={0.24} />
              <stop offset="100%" stopColor={actualColor} stopOpacity={0.025} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e5ede8" vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="time" type="number" domain={["dataMin", "dataMax"]} ticks={ticks}
            tickFormatter={(time) => axisDate.format(time)} tick={axisText}
            axisLine={axisLine} tickLine={false} tickMargin={10} minTickGap={14}
          />
          <YAxis width={39} tick={axisText} axisLine={false} tickLine={false} tickMargin={6} />
          <Tooltip
            labelFormatter={(time) => typeof time === "number" ? formatDateTime(new Date(time).toISOString()) : ""}
            formatter={(value, name) => [`${formatNumber(Number(value))} kWh`, name]}
            contentStyle={{ borderRadius: 10, borderColor: "#cdded5", color: "#172b24", fontSize: 12 }}
          />
          <Area
            type="linear" dataKey="actual" name="Actual generation" stroke={actualColor} strokeWidth={1.8}
            fill={`url(#${comparison ? "forecast-actual-area" : "generation-area"})`} dot={false} isAnimationActive={false}
          />
          {comparison && (
            <Area
              type="linear" dataKey="forecast" name="Forecast generation" stroke={forecastColor} strokeWidth={2}
              strokeDasharray="5 3" fill={forecastColor} fillOpacity={0.08} dot={false} isAnimationActive={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function actualPoints(readings: Generation[]) {
  return readings
    .map(({ hour: date, kwh }) => ({ time: Date.parse(date), actual: kwh }))
    .sort((a, b) => a.time - b.time);
}

export function GenerationChart({ readings }: { readings: Generation[] }) {
  if (!readings.length) return <Empty>Hourly generation will appear after the meters send readings.</Empty>;
  return <EnergyChart data={actualPoints(readings)} />;
}

const modelError = (value: Forecast["maeKwh"]) => value == null ? "Unavailable" : `${formatNumber(value)} kWh`;

export function ForecastChart({ forecasts, readings, devices }: {
  forecasts: Forecast[]; readings: Generation[]; devices: DeviceStatus[];
}) {
  const series = forecasts.filter((forecast) => forecast.energyKwh.length > 0);
  if (!series.length) return <Empty>No forecast has been published for your devices yet.</Empty>;

  const forecastsByHour = new Map<number, number>();
  for (const forecast of series) {
    const start = Date.parse(forecast.horizonStart);
    forecast.energyKwh.forEach((energy, index) => {
      const time = start + hour * index;
      forecastsByHour.set(time, (forecastsByHour.get(time) ?? 0) + energy);
    });
  }
  const first = Math.min(...forecastsByHour.keys());
  const last = Math.max(...forecastsByHour.keys());
  const points = new Map<number, Point>(
    actualPoints(readings).filter(({ time }) => time >= first - 72 * hour && time <= last)
      .map((point) => [point.time, point]),
  );
  for (const [time, forecast] of forecastsByHour) points.set(time, { ...points.get(time), time, forecast });
  const data = [...points.values()].sort((a, b) => a.time - b.time);
  const average = series.length === 1
    ? series[0].avgKwh
    : [...forecastsByHour.values()].reduce((total, value) => total + value, 0) / forecastsByHour.size;
  const co2 = series.reduce((total, forecast) => total + Number(forecast.co2AvoidedKg), 0);
  const units = series.reduce((total, forecast) => total + BigInt(forecast.unitsExpectedG), 0n);

  return (
    <div className="forecast">
      <dl className="forecast-stats">
        <div><dt>Average generation</dt><dd>{formatNumber(average)} kWh</dd></div>
        <div><dt>CO₂ avoided</dt><dd>{formatNumber(co2)} kgCO₂e</dd></div>
        <div><dt>Expected units</dt><dd>{formatCarbon(String(units))}</dd></div>
      </dl>
      <div className="chart-legend">
        <span><i className="legend-current" />Recent actuals</span>
        <span><i className="legend-forecast" />Forecast</span>
      </div>
      <EnergyChart data={data} comparison />
      <div className="forecast-models">
        {series.map((forecast) => (
          <div className="forecast-model" key={forecast.id}>
            <div>
              <strong>{forecast.modelName} <span className="quiet">· {forecast.modelVersion}</span></strong>
              <span className="record-meta">{devices.find((device) => device.deviceId === forecast.deviceId)?.label ?? forecast.deviceId} · {forecast.horizonHours} h forecast</span>
            </div>
            <div className="forecast-badges">
              <StatusPill>MAE {modelError(forecast.maeKwh)} vs {modelError(forecast.baselineMaeKwh)}</StatusPill>
              <StatusPill>RMSE {modelError(forecast.rmseKwh)} vs {modelError(forecast.baselineRmseKwh)}</StatusPill>
            </div>
          </div>
        ))}
        <p className="quiet">Model errors compared with the seasonal-naive baseline. Lower is better.</p>
      </div>
    </div>
  );
}
