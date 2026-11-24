import { Hono } from "hono";
import { body, first, HttpError, sql, type App } from "./http";
import { decryptSecret, verifyReading, type SignedReading } from "./device-crypto";
import { MAX_GRAMS } from "./quantities";
import { mintGrams } from "./decimal";
import { legacyCredits, recordLegacyMint } from "./legacy-mint";

export const ingest = new Hono<App>({ strict: false });

const positiveInt32 = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;

function validPayload(payload: Record<string, unknown>): payload is SignedReading {
  return typeof payload.device_id === "string" && payload.device_id.length > 0 &&
    positiveInt32(payload.seq) && positiveInt32(payload.timestamp) &&
    Number.isFinite(payload.kwh_cumulative) && Number.isFinite(payload.kwh_interval);
}

type DeviceState = {
  status: string; encryptedSecret: string; secretIv: string; lastSeq: number; ratedCapacityKw: number;
  projectId: number | null; generatorAddress: string | null;
  lastTimestamp: number | null; trustedCumulative: number | null;
  factorVersion: string | null; kgPerKwh: string | null;
};

const effectiveFactor = `FROM EmissionFactor WHERE validFrom <= ?1 AND (validTo IS NULL OR validTo > ?1)
  ORDER BY validFrom DESC, version DESC LIMIT 1`;

function assess(reading: SignedReading, device: DeviceState, env: Env) {
  const { kwh_interval: interval, kwh_cumulative: cumulative } = reading;
  if (interval < 0) return "negative kwh_interval";
  if (cumulative < 0) return "negative kwh_cumulative";
  if (device.trustedCumulative !== null && cumulative < device.trustedCumulative) {
    return "cumulative meter value decreased";
  }
  const hours = device.lastTimestamp === null
    ? Number(env.INGEST_DEFAULT_INTERVAL_HOURS || 5 / 60)
    : Math.max((reading.timestamp - device.lastTimestamp) / 3600, 1 / 3600);
  const maxKwh = device.ratedCapacityKw * hours * Number(env.INGEST_SAFETY_MARGIN || 1.5);
  if (interval > maxKwh) return `kwh_interval exceeds plausible maximum of ${maxKwh.toFixed(6)} kWh`;
  return null;
}

ingest.post("/reading", async (c) => {
  const reading = body(c);
  if (typeof reading.signature !== "string" || !/^[a-f0-9]{64}$/i.test(reading.signature)) {
    throw new HttpError(401, "unauthorized");
  }
  if (!validPayload(reading)) throw new HttpError(400, "malformed payload");
  const db = c.env.DB;
  const capture = new Date(reading.timestamp * 1000).toISOString();
  let authenticated: Pick<DeviceState, "encryptedSecret" | "secretIv"> | undefined;

  for (;;) {
    const device = await first<DeviceState>(db, `
      SELECT d.status, d.encryptedSecret, d.secretIv, d.lastSeq, d.ratedCapacityKw, d.projectId, d.generatorAddress,
        (SELECT deviceTimestamp FROM Reading WHERE deviceId = d.deviceId AND seq = d.lastSeq) AS lastTimestamp,
        (SELECT kwhCumulative FROM Reading WHERE deviceId = d.deviceId AND validated = 1 ORDER BY seq DESC LIMIT 1) AS trustedCumulative,
        (SELECT version ${effectiveFactor}) AS factorVersion,
        (SELECT kgPerKwh ${effectiveFactor}) AS kgPerKwh
      FROM Device d WHERE d.deviceId = ?2`, capture, reading.device_id);
    if (!device || device.status !== "active") throw new HttpError(401, "unauthorized");
    if (!authenticated) {
      const secret = await decryptSecret(device.encryptedSecret, device.secretIv, c.env.DEVICE_SECRET_ENCRYPTION_KEY);
      if (!await verifyReading(reading, secret)) throw new HttpError(401, "unauthorized");
      authenticated = device;
      reading.kwh_cumulative = Number(reading.kwh_cumulative.toFixed(6));
      reading.kwh_interval = Number(reading.kwh_interval.toFixed(6));
    } else if (device.encryptedSecret !== authenticated.encryptedSecret || device.secretIv !== authenticated.secretIv) {
      throw new HttpError(401, "unauthorized");
    }
    if (reading.seq <= device.lastSeq) throw new HttpError(409, "duplicate or replayed seq");

    let flagReason = assess(reading, device, c.env);
    let amount: bigint | null = null;
    if (!flagReason && reading.kwh_interval > 0) {
      if (device.kgPerKwh === null) {
        flagReason = "no emission factor applies at capture time";
      } else {
        amount = mintGrams(reading.kwh_interval, device.kgPerKwh);
        if (amount > MAX_GRAMS) flagReason = "carbon amount exceeds supported range";
      }
    }

    const creditsAmount = !flagReason && c.env.LEGACY_MINT_ENABLED === "true" ? legacyCredits(reading.kwh_interval, c.env) : null;
    if (creditsAmount !== null && (!Number.isInteger(creditsAmount) || creditsAmount < -2147483648 || creditsAmount > 2147483647)) {
      throw new Error("legacy credits amount exceeds supported range");
    }
    const statements = [
      // If another reading, revocation, or factor update won the race, re-evaluate against the new snapshot.
      sql(db, `UPDATE Device SET lastSeq = ?2
        WHERE deviceId = ?3 AND status = 'active' AND lastSeq = ?4 AND encryptedSecret = ?5 AND secretIv = ?6
          AND (SELECT version ${effectiveFactor}) IS ?7`,
      capture, reading.seq, reading.device_id, device.lastSeq, device.encryptedSecret, device.secretIv, device.factorVersion),
      sql(db, `INSERT INTO Reading (deviceId, seq, deviceTimestamp, kwhCumulative, kwhInterval, validated, flagReason, signature, creditsAmount)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`, reading.device_id, reading.seq, reading.timestamp,
      reading.kwh_cumulative, reading.kwh_interval, flagReason ? 0 : 1, flagReason, reading.signature, creditsAmount),
    ];
    if (!flagReason && amount !== null) {
      statements.push(sql(db, `INSERT INTO LedgerEntry (id, organisationId, kind, amountG, bucket, readingId, factorVersion)
        SELECT ?, d.organisationId, 'MINT', CAST(? AS INTEGER), 'AVAILABLE', r.id, ?
        FROM Reading r JOIN Device d USING (deviceId) WHERE r.deviceId = ? AND r.seq = ? AND changes() = 1`,
      crypto.randomUUID(), amount.toString(), device.factorVersion, reading.device_id, reading.seq));
    }
    const [updated] = await db.batch(statements);
    if (updated.meta.changes === 0) continue;
    if (flagReason) throw new HttpError(422, flagReason);
    if (creditsAmount !== null && creditsAmount > 0) {
      c.executionCtx.waitUntil(recordLegacyMint(c.env, device, reading.device_id, reading.seq, creditsAmount).catch(() => {
        console.error("Failed to record mint outcome", { deviceId: reading.device_id, seq: reading.seq });
      }));
    }
    return c.json({ status: "accepted", validated: true, creditsAmount });
  }
});
