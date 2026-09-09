const express = require("express");
const prisma = require("../lib/prisma");
const { canonicalPayload, decryptSecret, verifyHmac } = require("../lib/crypto");
const { computeCreditsAmount } = require("../lib/credits");
const { mintCredits } = require("../lib/chain");

const router = express.Router();

const SAFETY_MARGIN = Number(process.env.INGEST_SAFETY_MARGIN || 1.5);
// Used only for the very first reading from a device, where there is no
// prior reading to derive an actual interval from.
const DEFAULT_INTERVAL_HOURS = Number(process.env.INGEST_DEFAULT_INTERVAL_HOURS || 5 / 60);

function isValidPayloadShape(body) {
  return (
    body &&
    typeof body.device_id === "string" &&
    Number.isInteger(body.seq) &&
    body.seq > 0 &&
    Number.isInteger(body.timestamp) &&
    typeof body.kwh_cumulative === "number" &&
    typeof body.kwh_interval === "number" &&
    typeof body.signature === "string"
  );
}

// POST /api/v1/ingest/reading
// Processing order follows prd.md §4.2 — do not reorder, each step
// assumes the previous passed. Plausibility validation scope follows
// mvp-ingestion-decisions.md decision 6 ("minimum"): negative-delta
// reject + rated-capacity spike check only. Non-monotonic-cumulative
// detection and admin review queue are explicitly deferred to v2.
router.post("/reading", async (req, res) => {
  const body = req.body;

  // 1. Parse & schema-validate.
  if (!isValidPayloadShape(body)) {
    return res.status(400).json({ error: "malformed payload" });
  }

  // 2. Look up device. Unknown, revoked -> 401. Same status regardless
  // of which, so we don't leak which devices exist.
  const device = await prisma.device.findUnique({ where: { deviceId: body.device_id } });
  if (!device || device.status !== "active") {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 3. Verify HMAC, constant-time compare.
  const secret = decryptSecret(device.encryptedSecret, device.secretIv);
  const payload = canonicalPayload(body);
  if (!verifyHmac(payload, secret, body.signature)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // 4. Replay check.
  if (body.seq <= device.lastSeq) {
    return res.status(409).json({ error: "duplicate or replayed seq" });
  }

  // 5. Plausibility validation (minimum scope — see decisions doc).
  let validated = true;
  let flagReason = null;

  if (body.kwh_interval < 0) {
    validated = false;
    flagReason = "negative kwh_interval";
  } else {
    const lastReading = await prisma.reading.findFirst({
      where: { deviceId: device.deviceId },
      orderBy: { seq: "desc" },
    });

    const intervalHours = lastReading
      ? Math.max((body.timestamp - lastReading.deviceTimestamp) / 3600, 1 / 3600)
      : DEFAULT_INTERVAL_HOURS;

    const maxPlausibleKwh = device.ratedCapacityKw * intervalHours * SAFETY_MARGIN;

    if (body.kwh_interval > maxPlausibleKwh) {
      validated = false;
      flagReason = `kwh_interval ${body.kwh_interval} exceeds plausible max ${maxPlausibleKwh.toFixed(6)} (rated_capacity_kw=${device.ratedCapacityKw}, interval_hours=${intervalHours.toFixed(4)})`;
    }
  }

  const creditsAmount = validated ? computeCreditsAmount(body.kwh_interval) : null;

  // 6. Persist. Unique(deviceId, seq) is the idempotency backstop for
  // a retried POST that gets past the seq > lastSeq check above (e.g.
  // an exact retry of a reading that was flagged, not validated, so
  // lastSeq wasn't bumped for it) — treat that race as 409, not 500.
  let reading;
  try {
    reading = await prisma.reading.create({
      data: {
        deviceId: device.deviceId,
        seq: body.seq,
        deviceTimestamp: body.timestamp,
        kwhCumulative: body.kwh_cumulative,
        kwhInterval: body.kwh_interval,
        validated,
        flagReason,
        signature: body.signature,
        creditsAmount,
      },
    });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "duplicate or replayed seq" });
    }
    throw err;
  }

  // Replay protection is about seq strictly increasing, independent of
  // whether this particular reading was validated for minting — so
  // lastSeq advances either way.
  await prisma.device.update({
    where: { deviceId: device.deviceId },
    data: { lastSeq: body.seq },
  });

  // 7. Mint credits — validated readings only, per
  // mvp-ingestion-decisions.md decisions 1/4/8. Deliberately NOT awaited
  // before responding: Sepolia confirmation (~12s+ block time) is well
  // past the firmware's HTTP_TIMEOUT_MS (5s) — awaiting here would make
  // the ESP32 see a successful ingest as a client-side timeout and retry
  // a reading the backend already accepted. The reading itself is
  // already durably persisted above regardless of what happens to the
  // mint; mint outcome is recorded on the Reading row for later
  // reconciliation, not surfaced synchronously to the device.
  mintForReading(device, reading, validated, creditsAmount, flagReason).catch((err) => {
    console.error(`Unexpected error in mintForReading device=${device.deviceId} seq=${body.seq}`, err);
  });

  return res.status(200).json({ status: "accepted", validated, creditsAmount });
});

async function mintForReading(device, reading, validated, creditsAmount, flagReason) {
  if (!validated || !creditsAmount) {
    console.log(`Reading flagged, not minted: device=${device.deviceId} seq=${reading.seq} reason=${flagReason}`);
    return;
  }

  if (!device.projectId || !device.generatorAddress) {
    await prisma.reading.update({
      where: { id: reading.id },
      data: { mintStatus: "failed", mintError: "device not bound to a project/generatorAddress" },
    });
    console.log(`Mint skipped: device=${device.deviceId} seq=${reading.seq} not bound to project/generator`);
    return;
  }

  try {
    const { txHash } = await mintCredits({
      projectId: device.projectId,
      to: device.generatorAddress,
      amount: creditsAmount,
    });
    await prisma.reading.update({
      where: { id: reading.id },
      data: { mintStatus: "success", mintTxHash: txHash },
    });
    console.log(`Minted: device=${device.deviceId} seq=${reading.seq} amount=${creditsAmount} tx=${txHash}`);
  } catch (err) {
    await prisma.reading.update({
      where: { id: reading.id },
      data: { mintStatus: "failed", mintError: String(err.message || err) },
    });
    console.error(`Mint FAILED: device=${device.deviceId} seq=${reading.seq}`, err);
  }
}

module.exports = router;
