const express = require("express");
const prisma = require("../lib/prisma");
const { canonicalPayload, decryptSecret, verifyHmac } = require("../lib/crypto");
const { computeCreditsAmount } = require("../lib/credits");
const { mintCredits } = require("../lib/chain");
const { route, HttpError } = require("../lib/http");
const { factorAt } = require("../lib/ledger");
const { mintGrams, MAX_BIGINT } = require("../lib/quantities");

const router = express.Router();
const SAFETY_MARGIN = Number(process.env.INGEST_SAFETY_MARGIN || 1.5);
const DEFAULT_INTERVAL_HOURS = Number(process.env.INGEST_DEFAULT_INTERVAL_HOURS || 5 / 60);
const isPositiveInt32 = (value) => Number.isInteger(value) && value > 0 && value <= 2147483647;

function validPayload(body) {
  return body && typeof body.device_id === "string" && body.device_id.length > 0 &&
    isPositiveInt32(body.seq) && isPositiveInt32(body.timestamp) &&
    Number.isFinite(body.kwh_cumulative) && Number.isFinite(body.kwh_interval);
}

async function plausibilityError(tx, device, body) {
  if (body.kwh_interval < 0) return "negative kwh_interval";
  if (body.kwh_cumulative < 0) return "negative kwh_cumulative";
  const last = await tx.reading.findUnique({
    where: { deviceId_seq: { deviceId: device.deviceId, seq: device.lastSeq } },
  });
  const trusted = last?.validated ? last : await tx.reading.findFirst({
    where: { deviceId: device.deviceId, validated: true }, orderBy: { seq: "desc" },
  });
  if (trusted && body.kwh_cumulative < trusted.kwhCumulative) return "cumulative meter value decreased";

  const hours = last
    ? Math.max((body.timestamp - last.deviceTimestamp) / 3600, 1 / 3600)
    : DEFAULT_INTERVAL_HOURS;
  const maxKwh = device.ratedCapacityKw * hours * SAFETY_MARGIN;
  if (body.kwh_interval > maxKwh) return `kwh_interval exceeds plausible maximum of ${maxKwh.toFixed(6)} kWh`;
  return null;
}

router.post("/reading", route(async (req, res) => {
  const body = req.body;
  if (!/^[a-f0-9]{64}$/i.test(typeof body?.signature === "string" ? body.signature : "")) {
    throw new HttpError(401, "unauthorized");
  }
  if (!validPayload(body)) throw new HttpError(400, "malformed payload");

  const device = await prisma.device.findUnique({ where: { deviceId: body.device_id } });
  if (!device || device.status !== "active" || !verifyHmac(
    canonicalPayload(body), decryptSecret(device.encryptedSecret, device.secretIv), body.signature,
  )) throw new HttpError(401, "unauthorized");

  // The firmware signs the six-decimal values. Use that same precision for validation and ledger accounting.
  body.kwh_cumulative = Number(body.kwh_cumulative.toFixed(6));
  body.kwh_interval = Number(body.kwh_interval.toFixed(6));
  const legacyMint = process.env.LEGACY_MINT_ENABLED === "true";
  const reading = await prisma.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw`SELECT * FROM "Device" WHERE "deviceId" = ${body.device_id} FOR UPDATE`;
    if (!current || current.status !== "active" || current.encryptedSecret !== device.encryptedSecret || current.secretIv !== device.secretIv) {
      throw new HttpError(401, "unauthorized");
    }
    if (body.seq <= current.lastSeq) throw new HttpError(409, "duplicate or replayed seq");

    let flagReason = await plausibilityError(tx, current, body);
    let factor;
    let amountG;
    if (!flagReason && body.kwh_interval > 0) {
      factor = await factorAt(tx, new Date(body.timestamp * 1000));
      if (!factor) {
        flagReason = "no emission factor applies at capture time";
      } else {
        amountG = mintGrams(body.kwh_interval, factor.kgPerKwh);
        if (amountG > MAX_BIGINT) flagReason = "carbon amount exceeds supported range";
      }
    }

    const saved = await tx.reading.create({ data: {
      deviceId: current.deviceId,
      seq: body.seq,
      deviceTimestamp: body.timestamp,
      kwhCumulative: body.kwh_cumulative,
      kwhInterval: body.kwh_interval,
      validated: !flagReason,
      flagReason,
      signature: body.signature,
      creditsAmount: !flagReason && legacyMint ? computeCreditsAmount(body.kwh_interval) : null,
    } });
    if (!flagReason && factor) {
      await tx.ledgerEntry.create({ data: {
        organisationId: current.organisationId, kind: "MINT", bucket: "AVAILABLE",
        amountG, readingId: saved.id, factorVersion: factor.version,
      } });
    }
    await tx.device.update({ where: { deviceId: current.deviceId }, data: { lastSeq: body.seq } });
    return { saved, current };
  });

  if (!reading.saved.validated) throw new HttpError(422, reading.saved.flagReason);
  if (legacyMint && reading.saved.creditsAmount > 0) {
    mintLegacyCredit(reading.current, reading.saved).catch(() => console.error(`Failed to record mint outcome for reading ${reading.saved.id}`));
  }
  res.json({ status: "accepted", validated: true, creditsAmount: reading.saved.creditsAmount });
}));

async function mintLegacyCredit(device, reading) {
  let result;
  try {
    if (!device.projectId || !device.generatorAddress) throw new Error("device not bound to a project/generatorAddress");
    const { txHash } = await mintCredits({ projectId: device.projectId, to: device.generatorAddress, amount: reading.creditsAmount });
    result = { mintStatus: "success", mintTxHash: txHash };
  } catch (err) {
    result = { mintStatus: "failed", mintError: err.shortMessage || err.message };
  }
  await prisma.reading.update({ where: { id: reading.id }, data: result });
}

module.exports = router;
