import { Hono } from "hono";
import { formatEther, isAddress } from "viem";
import { authenticate, requireRole } from "./auth";
import { anchorChain, anchorWallet } from "./anchor-chain";
import { all, body, first, HttpError, parseDate, sql, type App } from "./http";
import { encryptSecret, randomHex } from "./device-crypto";
import { anchorColumns, findTrades } from "./market";
import { parseDecimal, parseGrams } from "./quantities";

export const admin = new Hono<App>({ strict: false });
admin.use(authenticate, requireRole("ADMIN"));

const deviceColumns = "deviceId, label, projectId, generatorAddress, ratedCapacityKw, lastSeq, status, createdAt, organisationId";

async function walletBalance(env: Env) {
  try {
    const chain = anchorChain(env);
    if (!chain || !env.ANCHOR_PRIVATE_KEY) return null;
    const wallet = anchorWallet(chain, env.ANCHOR_PRIVATE_KEY);
    return formatEther(await chain.publicClient.getBalance({ address: wallet.account.address }));
  } catch {
    return null;
  }
}

admin.get("/overview", async (c) => {
  const [record, walletBalanceEth] = await Promise.all([
    first<{ devices: number; flaggedReadings: number; trades: number; pending: number; inflight: number; confirmed: number; failed: number }>(
      c.env.DB, `SELECT (SELECT count(*) FROM Device) AS devices,
        (SELECT count(*) FROM Reading WHERE validated = 0) AS flaggedReadings, (SELECT count(*) FROM Trade) AS trades,
        count(*) FILTER (WHERE status = 'PENDING') AS pending, count(*) FILTER (WHERE status = 'INFLIGHT') AS inflight,
        count(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed, count(*) FILTER (WHERE status = 'FAILED') AS failed
      FROM Anchor`,
    ),
    walletBalance(c.env),
  ]);
  const { devices, flaggedReadings, trades, pending, inflight, confirmed, failed } = record!;
  return c.json({ devices, flaggedReadings, trades, anchorHealth: { pending, inflight, confirmed, failed, walletBalanceEth } });
});

admin.get("/devices", async (c) => c.json(await all(c.env.DB, `SELECT ${deviceColumns} FROM Device ORDER BY createdAt DESC`)));

admin.post("/devices", async (c) => {
  const { label, projectId, generatorAddress, ratedCapacityKw, organisationId = c.get("user").organisationId } = body(c);
  if (typeof ratedCapacityKw !== "number" || !Number.isFinite(ratedCapacityKw) || ratedCapacityKw <= 0) {
    throw new HttpError(400, "ratedCapacityKw must be a positive number");
  }
  if (label != null && (typeof label !== "string" || label.length > 100)) throw new HttpError(400, "label must be at most 100 characters");
  if (typeof organisationId !== "string" || !organisationId) throw new HttpError(400, "organisationId is invalid");
  if (projectId != null && (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0 || projectId > 2147483647)) {
    throw new HttpError(400, "projectId must be a positive integer");
  }
  if (generatorAddress != null && (typeof generatorAddress !== "string" || !isAddress(generatorAddress))) {
    throw new HttpError(400, "generatorAddress must be a valid address");
  }
  const deviceId = `dev_${randomHex(4)}`;
  const secret = randomHex(32);
  const { encryptedSecret, secretIv } = await encryptSecret(secret, c.env.DEVICE_SECRET_ENCRYPTION_KEY);
  await sql(c.env.DB, `INSERT INTO Device (deviceId, encryptedSecret, secretIv, label, projectId, generatorAddress, ratedCapacityKw, organisationId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, deviceId, encryptedSecret, secretIv, label ?? null, projectId ?? null, generatorAddress ?? null,
  ratedCapacityKw, organisationId).run();
  return c.json({
    device_id: deviceId, device_secret: secret,
    warning: "This secret is shown once and never stored in plaintext. Save it now.",
  }, 201);
});

admin.post("/devices/:id/revoke", async (c) => {
  const result = await first<{ device_id: string; status: string }>(
    c.env.DB, "UPDATE Device SET status = 'revoked' WHERE deviceId = ? RETURNING deviceId AS device_id, status", c.req.param("id"),
  );
  if (!result) throw new HttpError(404, "record not found");
  return c.json(result);
});

admin.get("/readings/flagged", async (c) => {
  const rows = await all<Record<string, unknown> & { validated: number }>(c.env.DB, `
    SELECT id, deviceId, seq, deviceTimestamp, receivedAt, kwhCumulative, kwhInterval, validated, flagReason
    FROM Reading WHERE validated = 0 ORDER BY receivedAt DESC`);
  return c.json(rows.map((row) => ({ ...row, validated: Boolean(row.validated) })));
});

const PAGE_SIZE = 1000;

admin.get("/readings", async (c) => {
  const { deviceId, cursor } = c.req.query();
  if (!deviceId) throw new HttpError(400, "deviceId is required");
  const parsed = cursor === undefined ? [0, 0] : /^(\d{1,10}):(\d{1,10})$/.exec(cursor)?.slice(1).map(Number);
  if (!parsed || parsed.some((value) => value > 2147483647)) throw new HttpError(400, "cursor is invalid");
  const rows = await all<{ deviceTimestamp: number; kwhInterval: number; seq: number }>(c.env.DB, `
    SELECT deviceTimestamp, kwhInterval, seq FROM Reading WHERE deviceId = ? AND validated = 1
    AND (deviceTimestamp, seq) > (?, ?) ORDER BY deviceTimestamp, seq LIMIT ?`,
  deviceId, parsed[0], parsed[1], PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return c.json({
    readings: page.map(({ deviceTimestamp, kwhInterval }) => ({ deviceTimestamp, kwhInterval })),
    nextCursor: rows.length > PAGE_SIZE && last ? `${last.deviceTimestamp}:${last.seq}` : null,
  });
});

const forecastMetrics = ["avgKwh", "co2AvoidedKg", "maeKwh", "rmseKwh", "baselineMaeKwh", "baselineRmseKwh", "confidence"] as const;
const isNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nonemptyString = (value: unknown): value is string => typeof value === "string" && !!value.trim();

admin.post("/forecasts", async (c) => {
  const { rows } = body(c);
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new HttpError(400, "rows must contain 1 to 100 forecasts");
  const db = c.env.DB;
  const statements = rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new HttpError(400, "invalid forecast row");
    const forecast = row as Record<string, unknown>;
    const { id = crypto.randomUUID(), deviceId, generatedAt = new Date().toISOString(),
      horizonStart, horizonHours, modelName, modelVersion, energyKwh, unitsExpectedG } = forecast;
    if (!nonemptyString(id) || !nonemptyString(deviceId) || !nonemptyString(modelName) || !nonemptyString(modelVersion)) {
      throw new HttpError(400, "forecast id, deviceId, modelName and modelVersion must be nonempty strings");
    }
    if (!Array.isArray(energyKwh) || !energyKwh.length || energyKwh.length !== horizonHours || !energyKwh.every(isNonnegative)) {
      throw new HttpError(400, "energyKwh must contain horizonHours nonnegative numbers");
    }
    const metrics = forecastMetrics.map((field) => {
      const value = forecast[field];
      if (!isNonnegative(value) || (field === "confidence" && value > 1)) throw new HttpError(400, `${field} is outside the supported range`);
      return value;
    });
    const [avg, carbon, mae, rmse, baselineMae, baselineRmse, confidence] = metrics;
    return sql(db, `INSERT INTO Forecast (id, deviceId, generatedAt, horizonStart, horizonHours, modelName, modelVersion,
        energyKwh, avgKwh, co2AvoidedKg, unitsExpectedG, maeKwh, rmseKwh, baselineMaeKwh, baselineRmseKwh, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?, ?, ?)`,
    id, deviceId, parseDate(generatedAt, "generatedAt"), parseDate(horizonStart, "horizonStart"), energyKwh.length, modelName,
    modelVersion, JSON.stringify(energyKwh), avg, carbon, parseGrams(unitsExpectedG, true).toString(), mae, rmse, baselineMae, baselineRmse, confidence);
  });
  await db.batch(statements);
  return c.json({ stored: statements.length }, 201);
});

admin.get("/trades", async (c) => c.json(await findTrades(c.env.DB)));

admin.get("/emission-factors", async (c) => c.json(await all(
  c.env.DB, "SELECT * FROM EmissionFactor ORDER BY validFrom DESC, version DESC",
)));

admin.post("/emission-factors", async (c) => {
  const { version, kgPerKwh, source, validFrom, validTo } = body(c);
  if (!nonemptyString(version) || version.length > 100 || !nonemptyString(source) || source.length > 1000) {
    throw new HttpError(400, "version and source are required");
  }
  const start = parseDate(validFrom, "validFrom");
  const end = validTo == null ? null : parseDate(validTo, "validTo");
  if (end && end <= start) throw new HttpError(400, "validTo must follow validFrom");
  const factor = await first(c.env.DB, `INSERT INTO EmissionFactor (id, version, kgPerKwh, source, validFrom, validTo)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  crypto.randomUUID(), version.trim(), parseDecimal(kgPerKwh, "kgPerKwh", 3, 9), source.trim(), start, end);
  return c.json(factor, 201);
});

admin.post("/anchors/:tradeId/retry", async (c) => {
  const id = c.req.param("tradeId");
  const db = c.env.DB;
  const now = new Date().toISOString();
  const [, , result] = await db.batch<{ status: string }>([
    sql(db, `UPDATE Anchor SET status = 'PENDING', attempts = 0, lastError = NULL, nextAttemptAt = ?1,
      updatedAt = ?1, leaseId = NULL WHERE tradeId = ?2 AND status = 'FAILED'`, now, id),
    sql(db, "UPDATE Trade SET status = 'ANCHOR_PENDING' WHERE id = ? AND changes() = 1", id),
    sql(db, `SELECT ${anchorColumns} FROM Anchor WHERE tradeId = ?`, id),
  ]);
  const anchor = result.results[0];
  if (!anchor) throw new HttpError(404, "anchor not found");
  if (anchor.status !== "PENDING") throw new HttpError(409, "anchor cannot be retried in its current state");
  return c.json(anchor);
});
