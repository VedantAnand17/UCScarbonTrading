const express = require("express");
const prisma = require("../lib/prisma");
const { authenticate, requireRole } = require("../lib/auth");
const { route, HttpError } = require("../lib/http");
const { balances } = require("../lib/ledger");

const router = express.Router();
router.use(authenticate, requireRole("GENERATOR"));

router.get("/summary", route(async (req, res) => {
  const { organisationId } = req.user;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const start = Math.floor(day.getTime() / 1000);
  const end = start + 86400;
  const window = { gte: start, lt: end };
  const [energy, carbon, balance, records] = await Promise.all([
    prisma.reading.aggregate({ where: { validated: true, device: { organisationId }, deviceTimestamp: window }, _sum: { kwhInterval: true } }),
    prisma.$queryRaw`
      SELECT COALESCE(SUM(ledger."amountG"), 0)::text AS "amountG"
      FROM "LedgerEntry" ledger JOIN "Reading" r ON r.id = ledger."readingId"
      WHERE ledger."organisationId" = ${organisationId} AND ledger.kind = 'MINT'
      AND r."deviceTimestamp" >= ${start} AND r."deviceTimestamp" < ${end}`,
    balances(prisma, organisationId),
    prisma.device.findMany({
      where: { organisationId }, orderBy: { deviceId: "asc" },
      select: { deviceId: true, label: true, status: true,
        readings: { orderBy: { seq: "desc" }, take: 1, select: { receivedAt: true } } },
    }),
  ]);
  const devices = records.map(({ readings, ...device }) => ({ ...device, lastSeenAt: readings[0]?.receivedAt ?? null }));
  res.json({ todayKwh: energy._sum.kwhInterval ?? 0, co2AvoidedTodayKg: Number(carbon[0].amountG) / 1000, ...balance, devices });
}));

router.get("/generation", route(async (req, res) => {
  const days = req.query.days ?? "14";
  if (typeof days !== "string" || !/^\d{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 366) {
    throw new HttpError(400, "days must be an integer from 1 to 366");
  }
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(now / 3600) * 3600 - (Number(days) * 24 - 1) * 3600;
  const rows = await prisma.$queryRaw`
    SELECT to_timestamp((r."deviceTimestamp" / 3600) * 3600) AS hour, SUM(r."kwhInterval") AS kwh
    FROM "Reading" r JOIN "Device" d ON d."deviceId" = r."deviceId"
    WHERE d."organisationId" = ${req.user.organisationId} AND r.validated
    AND r."deviceTimestamp" >= ${start} AND r."deviceTimestamp" <= ${now}
    GROUP BY hour ORDER BY hour`;
  res.json(rows);
}));

router.get("/forecast", route(async (req, res) => {
  res.json(await prisma.$queryRaw`
    SELECT DISTINCT ON (f."deviceId") f.*
    FROM "Forecast" f JOIN "Device" d ON d."deviceId" = f."deviceId"
    WHERE d."organisationId" = ${req.user.organisationId}
    ORDER BY f."deviceId", f."generatedAt" DESC, f.id DESC`);
}));

module.exports = router;
