const express = require("express");
const prisma = require("../lib/prisma");
const { authenticate, requireRole } = require("../lib/auth");
const { route } = require("../lib/http");
const { parseGrams, parseDecimal } = require("../lib/quantities");
const { createListing, cancelListing } = require("../lib/marketplace");

const router = express.Router();
router.use(authenticate);

router.get("/mine", requireRole("GENERATOR"), route(async (req, res) => {
  res.json(await prisma.listing.findMany({ where: { sellerOrgId: req.user.organisationId }, orderBy: { createdAt: "desc" } }));
}));

router.get("/", requireRole("BUYER"), route(async (_req, res) => {
  const listings = await prisma.listing.findMany({
    where: { status: "LISTED" }, orderBy: { createdAt: "desc" },
    select: { id: true, sellerOrg: { select: { name: true } }, remainingG: true, priceInrPerKg: true, createdAt: true },
  });
  res.json(listings.map(({ sellerOrg, ...listing }) => ({ ...listing, sellerOrgName: sellerOrg.name })));
}));

router.post("/", requireRole("GENERATOR"), route(async (req, res) => {
  const amountG = parseGrams(req.body?.amountG);
  const priceInrPerKg = parseDecimal(req.body?.priceInrPerKg, "priceInrPerKg", 12, 6);
  const listing = await prisma.$transaction((tx) => createListing(tx, req.user.organisationId, amountG, priceInrPerKg));
  res.status(201).json(listing);
}));

router.post("/:id/cancel", requireRole("GENERATOR"), route(async (req, res) => {
  const listing = await prisma.$transaction((tx) => cancelListing(tx, req.params.id, req.user.organisationId));
  res.json(listing);
}));

module.exports = router;
