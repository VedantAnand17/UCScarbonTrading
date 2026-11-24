const express = require("express");
const prisma = require("../lib/prisma");
const { authenticate, requireRole } = require("../lib/auth");
const { route, HttpError } = require("../lib/http");
const { parseGrams } = require("../lib/quantities");
const { settlePurchase, tradeWithAnchor } = require("../lib/marketplace");
const { anchorChain, readAnchoredHash } = require("../lib/anchor-chain");

const router = express.Router();
router.use(authenticate);
const readTrade = requireRole("BUYER", "GENERATOR", "ADMIN");
const participant = (organisationId) => ({ OR: [{ buyerOrgId: organisationId }, { sellerOrgId: organisationId }] });

router.post("/", requireRole("BUYER"), route(async (req, res) => {
  const { listingId, amountG } = req.body || {};
  if (typeof listingId !== "string" || !listingId) throw new HttpError(400, "listingId is required");
  const grams = parseGrams(amountG);
  const trade = await prisma.$transaction((tx) => settlePurchase(tx, listingId, req.user.organisationId, grams));
  res.status(201).json(trade);
}));

router.get("/mine", requireRole("BUYER", "GENERATOR"), route(async (req, res) => {
  res.json(await prisma.trade.findMany({
    where: participant(req.user.organisationId), include: tradeWithAnchor, orderBy: { settledAt: "desc" },
  }));
}));

async function accessibleTrade(req) {
  const access = req.user.roles.includes("ADMIN") ? {} : participant(req.user.organisationId);
  const trade = await prisma.trade.findFirst({ where: { id: req.params.id, ...access }, include: tradeWithAnchor });
  if (!trade) throw new HttpError(404, "trade not found");
  return trade;
}

router.get("/:id", readTrade, route(async (req, res) => {
  const trade = await accessibleTrade(req);
  const explorerUrl = trade.anchor?.status === "CONFIRMED" && trade.anchor.txHash
    ? `https://sepolia.etherscan.io/tx/${trade.anchor.txHash}` : null;
  res.json({ ...trade, explorerUrl });
}));

router.get("/:id/verify", readTrade, route(async (req, res) => {
  const { id, tradeHash: storedHash } = await accessibleTrade(req);
  const chain = anchorChain();
  const onChainHash = chain ? await readAnchoredHash(chain, id) : null;
  res.json({ storedHash, onChainHash, match: storedHash === onChainHash });
}));

module.exports = router;
