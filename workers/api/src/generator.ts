import { Hono } from "hono";
import { authenticate, requireRole } from "./auth";
import { all, first, HttpError, type App } from "./http";
import { LEDGER_BASE } from "./quantities";

export const generator = new Hono<App>({ strict: false });
generator.use(authenticate, requireRole("GENERATOR"));

type BalanceParts = { high: string; low: string };
const total = ({ high, low }: BalanceParts) => BigInt(high) * LEDGER_BASE + BigInt(low);

generator.get("/summary", async (c) => {
  const db = c.env.DB;
  const org = c.get("user").organisationId;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const start = Math.floor(day.getTime() / 1000);
  const end = start + 86400;
  const [energy, carbon, balances, devices] = await Promise.all([
    first<{ kwh: number }>(db, `SELECT COALESCE(SUM(r.kwhInterval), 0) AS kwh FROM Reading r JOIN Device d USING (deviceId)
      WHERE d.organisationId = ? AND r.validated = 1 AND r.deviceTimestamp >= ? AND r.deviceTimestamp < ?`, org, start, end),
    first<BalanceParts>(db, `SELECT CAST(COALESCE(SUM(l.amountG / ${LEDGER_BASE}), 0) AS TEXT) AS high,
      CAST(COALESCE(SUM(l.amountG % ${LEDGER_BASE}), 0) AS TEXT) AS low
      FROM LedgerEntry l JOIN Reading r ON r.id = l.readingId
      WHERE l.organisationId = ? AND l.kind = 'MINT' AND r.deviceTimestamp >= ? AND r.deviceTimestamp < ?`, org, start, end),
    all<BalanceParts & { bucket: "AVAILABLE" | "RESERVED" }>(db, `
      SELECT bucket, CAST(high AS TEXT) AS high, CAST(low AS TEXT) AS low FROM LedgerBalance WHERE organisationId = ?`, org),
    all(db, `SELECT d.deviceId, d.label, d.status,
      (SELECT receivedAt FROM Reading WHERE deviceId = d.deviceId ORDER BY seq DESC LIMIT 1) AS lastSeenAt
      FROM Device d WHERE d.organisationId = ? ORDER BY d.deviceId`, org),
  ]);
  const grams = { AVAILABLE: "0", RESERVED: "0" };
  for (const balance of balances) grams[balance.bucket] = total(balance).toString();
  return c.json({
    todayKwh: energy?.kwh ?? 0,
    co2AvoidedTodayKg: carbon ? Number(total(carbon)) / 1000 : 0,
    availableG: grams.AVAILABLE, reservedG: grams.RESERVED, devices,
  });
});

generator.get("/generation", async (c) => {
  const values = c.req.queries("days") ?? ["14"];
  const [days] = values;
  if (values.length !== 1 || !/^\d{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 366) {
    throw new HttpError(400, "days must be an integer from 1 to 366");
  }
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(now / 3600) * 3600 - (Number(days) * 24 - 1) * 3600;
  const rows = await all<{ hour: number; kwh: number }>(c.env.DB, `
    SELECT (r.deviceTimestamp / 3600) * 3600 AS hour, SUM(r.kwhInterval) AS kwh
    FROM Reading r JOIN Device d USING (deviceId)
    WHERE d.organisationId = ? AND r.validated = 1 AND r.deviceTimestamp >= ? AND r.deviceTimestamp <= ?
    GROUP BY hour ORDER BY hour`, c.get("user").organisationId, start, now);
  return c.json(rows.map(({ hour, kwh }) => ({ hour: new Date(hour * 1000).toISOString(), kwh })));
});

generator.get("/forecast", async (c) => {
  const rows = await all<{ energyKwh: string } & Record<string, unknown>>(c.env.DB, `
    SELECT f.id, f.deviceId, f.generatedAt, f.horizonStart, f.horizonHours, f.modelName, f.modelVersion,
      f.energyKwh, f.avgKwh, f.co2AvoidedKg, CAST(f.unitsExpectedG AS TEXT) AS unitsExpectedG,
      f.maeKwh, f.rmseKwh, f.baselineMaeKwh, f.baselineRmseKwh, f.confidence
    FROM Device d JOIN Forecast f ON f.id = (
      SELECT id FROM Forecast WHERE deviceId = d.deviceId ORDER BY generatedAt DESC, id DESC LIMIT 1
    )
    WHERE d.organisationId = ? ORDER BY d.deviceId`, c.get("user").organisationId);
  return c.json(rows.map((row) => ({ ...row, energyKwh: JSON.parse(row.energyKwh) as number[] })));
});
