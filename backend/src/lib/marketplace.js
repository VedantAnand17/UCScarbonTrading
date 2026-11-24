const { randomUUID } = require("node:crypto");
const { keccak256, stringToHex } = require("viem");
const { balances } = require("./ledger");
const { HttpError } = require("./http");
const { tradeTotal } = require("./quantities");

const anchorSelect = {
  id: true, tradeId: true, status: true, txHash: true, blockNumber: true,
  attempts: true, lastError: true, updatedAt: true,
};
const tradeWithAnchor = { anchor: { select: anchorSelect } };

function pairedEntries(organisationId, kind, amountG, listingId) {
  return [
    { organisationId, kind, amountG, listingId, bucket: "AVAILABLE" },
    { organisationId, kind, amountG: -amountG, listingId, bucket: "RESERVED" },
  ];
}

async function createListing(tx, sellerOrgId, amountG, priceInrPerKg) {
  // Serialize reservations across every listing owned by this organisation.
  await tx.$queryRaw`SELECT id FROM "Organisation" WHERE id = ${sellerOrgId} FOR UPDATE`;
  if ((await balances(tx, sellerOrgId)).availableG < amountG) throw new HttpError(409, "insufficient available units");
  const listing = await tx.listing.create({ data: { sellerOrgId, amountG, priceInrPerKg, remainingG: amountG } });
  await tx.ledgerEntry.createMany({ data: pairedEntries(sellerOrgId, "RESERVE", -amountG, listing.id) });
  return listing;
}

async function lockListing(tx, listingId) {
  const [listing] = await tx.$queryRaw`SELECT * FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
  if (!listing) throw new HttpError(404, "listing not found");
  return listing;
}

async function cancelListing(tx, listingId, sellerOrgId) {
  const listing = await lockListing(tx, listingId);
  if (listing.sellerOrgId !== sellerOrgId) throw new HttpError(404, "listing not found");
  if (listing.status === "CANCELLED") return listing;
  if (listing.status !== "LISTED") throw new HttpError(409, "listing cannot be cancelled");
  await tx.ledgerEntry.createMany({ data: pairedEntries(sellerOrgId, "RELEASE", listing.remainingG, listingId) });
  return tx.listing.update({ where: { id: listingId }, data: { status: "CANCELLED", remainingG: 0n } });
}

function settledHash(trade) {
  const ordered = Object.fromEntries(Object.keys(trade).sort().map((key) => [key, trade[key]]));
  const canonical = JSON.stringify(ordered, (_key, value) => typeof value === "bigint" ? value.toString() : value);
  return keccak256(stringToHex(canonical));
}

async function settlePurchase(tx, listingId, buyerOrgId, amountG) {
  const listing = await lockListing(tx, listingId);
  if (listing.status !== "LISTED" || listing.remainingG < amountG) throw new HttpError(409, "insufficient units remaining");

  const { sellerOrgId, priceInrPerKg } = listing;
  const settled = {
    id: randomUUID(), listingId, buyerOrgId, sellerOrgId, amountG,
    priceInrPerKg: priceInrPerKg.toFixed(), totalInr: tradeTotal(amountG, priceInrPerKg),
    status: "SETTLED", settledAt: new Date(),
  };
  const trade = await tx.trade.create({ data: { ...settled, tradeHash: settledHash(settled) } });
  const remainingG = listing.remainingG - amountG;
  await tx.listing.update({
    where: { id: listingId }, data: { remainingG, status: remainingG === 0n ? "FILLED" : "LISTED" },
  });
  await tx.ledgerEntry.createMany({ data: [
    { tradeId: trade.id, listingId, organisationId: sellerOrgId, kind: "TRANSFER_OUT", bucket: "RESERVED", amountG: -amountG },
    { tradeId: trade.id, listingId, organisationId: buyerOrgId, kind: "TRANSFER_IN", bucket: "AVAILABLE", amountG },
  ] });
  await tx.anchor.create({ data: { tradeId: trade.id } });
  return trade;
}

module.exports = { createListing, cancelListing, settlePurchase, tradeWithAnchor, anchorSelect };
