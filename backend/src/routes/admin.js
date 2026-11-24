const express = require("express");
const { formatEther, isAddress } = require("viem");
const prisma = require("../lib/prisma");
const { authenticate, requireRole } = require("../lib/auth");
const { generateDeviceId, generateDeviceSecret, encryptSecret } = require("../lib/crypto");
const { route, HttpError } = require("../lib/http");
const { tradeWithAnchor, anchorSelect } = require("../lib/marketplace");
const { parseDecimal } = require("../lib/quantities");
const { anchorChain, anchorWallet } = require("../lib/anchor-chain");

const router = express.Router();
router.use(authenticate, requireRole("ADMIN"));

async function walletBalance() {
  try {
    const chain = anchorChain();
    if (!chain || !process.env.ANCHOR_PRIVATE_KEY) return null;
    const wallet = anchorWallet(chain);
    return formatEther(await chain.publicClient.getBalance({ address: wallet.account.address }));
  } catch {
    return null;
  }
}

router.get("/overview", route(async (_req, res) => {
  const [devices, flaggedReadings, trades, grouped, walletBalanceEth] = await Promise.all([
    prisma.device.count(), prisma.reading.count({ where: { validated: false } }), prisma.trade.count(),
    prisma.anchor.groupBy({ by: ["status"], _count: { _all: true } }), walletBalance(),
  ]);
  const anchorHealth = { pending: 0, inflight: 0, confirmed: 0, failed: 0, walletBalanceEth };
  for (const { status, _count } of grouped) anchorHealth[status.toLowerCase()] = _count._all;
  res.json({ devices, flaggedReadings, trades, anchorHealth });
}));

router.get("/devices", route(async (_req, res) => {
  res.json(await prisma.device.findMany({
    select: {
      deviceId: true, label: true, projectId: true, generatorAddress: true, ratedCapacityKw: true,
      lastSeq: true, status: true, createdAt: true, organisationId: true,
    }, orderBy: { createdAt: "desc" },
  }));
}));

router.post("/devices", route(async (req, res) => {
  const { label, projectId, generatorAddress, ratedCapacityKw, organisationId = req.user.organisationId } = req.body || {};
  if (!Number.isFinite(ratedCapacityKw) || ratedCapacityKw <= 0) throw new HttpError(400, "ratedCapacityKw must be a positive number");
  if (label != null && (typeof label !== "string" || label.length > 100)) throw new HttpError(400, "label must be at most 100 characters");
  if (typeof organisationId !== "string" || !organisationId) throw new HttpError(400, "organisationId is invalid");
  if (projectId != null && (!Number.isInteger(projectId) || projectId <= 0 || projectId > 2147483647)) {
    throw new HttpError(400, "projectId must be a positive integer");
  }
  if (generatorAddress != null && (typeof generatorAddress !== "string" || !isAddress(generatorAddress))) {
    throw new HttpError(400, "generatorAddress must be a valid address");
  }

  const deviceId = generateDeviceId();
  const secret = generateDeviceSecret();
  await prisma.device.create({ data: {
    deviceId, ...encryptSecret(secret), label, projectId, generatorAddress, ratedCapacityKw, organisationId,
  } });
  res.status(201).json({
    device_id: deviceId, device_secret: secret,
    warning: "This secret is shown once and never stored in plaintext. Save it now.",
  });
}));

router.post("/devices/:id/revoke", route(async (req, res) => {
  const { deviceId, status } = await prisma.device.update({ where: { deviceId: req.params.id }, data: { status: "revoked" } });
  res.json({ device_id: deviceId, status });
}));

router.get("/readings/flagged", route(async (_req, res) => {
  res.json(await prisma.reading.findMany({
    where: { validated: false }, orderBy: { receivedAt: "desc" },
    select: {
      id: true, deviceId: true, seq: true, deviceTimestamp: true, receivedAt: true,
      kwhCumulative: true, kwhInterval: true, validated: true, flagReason: true,
    },
  }));
}));

router.get("/trades", route(async (_req, res) => {
  res.json(await prisma.trade.findMany({ include: tradeWithAnchor, orderBy: { settledAt: "desc" } }));
}));

router.get("/emission-factors", route(async (_req, res) => {
  res.json(await prisma.emissionFactor.findMany({ orderBy: [{ validFrom: "desc" }, { version: "desc" }] }));
}));

function parseDate(value, field) {
  const date = new Date(typeof value === "string" ? value : "");
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, `${field} must be a valid date`);
  return date;
}

router.post("/emission-factors", route(async (req, res) => {
  const { version, kgPerKwh, source, validFrom, validTo } = req.body || {};
  if (typeof version !== "string" || !version.trim() || version.length > 100 ||
      typeof source !== "string" || !source.trim() || source.length > 1000) {
    throw new HttpError(400, "version and source are required");
  }
  const start = parseDate(validFrom, "validFrom");
  const end = validTo == null ? null : parseDate(validTo, "validTo");
  if (end && end <= start) throw new HttpError(400, "validTo must follow validFrom");
  const factor = await prisma.emissionFactor.create({ data: {
    version: version.trim(), kgPerKwh: parseDecimal(kgPerKwh, "kgPerKwh", 3, 9),
    source: source.trim(), validFrom: start, validTo: end,
  } });
  res.status(201).json(factor);
}));

router.post("/anchors/:tradeId/retry", route(async (req, res) => {
  const { tradeId } = req.params;
  const anchor = await prisma.$transaction(async (tx) => {
    const [record] = await tx.$queryRaw`SELECT status FROM "Anchor" WHERE "tradeId" = ${tradeId} FOR UPDATE`;
    if (!record) throw new HttpError(404, "anchor not found");
    if (record.status === "PENDING") return tx.anchor.findUnique({ where: { tradeId }, select: anchorSelect });
    if (record.status !== "FAILED") throw new HttpError(409, "anchor cannot be retried in its current state");
    const pending = await tx.anchor.update({
      where: { tradeId }, data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() }, select: anchorSelect,
    });
    await tx.trade.update({ where: { id: tradeId }, data: { status: "ANCHOR_PENDING" } });
    return pending;
  });
  res.json(anchor);
}));

module.exports = router;
