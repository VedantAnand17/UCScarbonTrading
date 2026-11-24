import { Hono } from "hono";
import { authenticate, requireRole } from "./auth";
import { all, body, first, HttpError, sql, type App } from "./http";
import { LEDGER_BASE, parseDecimal, parseGrams } from "./quantities";
import { settledHash, tradeTotal, type SettledTrade } from "./trade-proof";
import { anchorChain, readAnchoredHash } from "./anchor-chain";

export const listings = new Hono<App>({ strict: false });
export const trades = new Hono<App>({ strict: false });

const listingColumns = `id, sellerOrgId, CAST(amountG AS TEXT) AS amountG, CAST(remainingG AS TEXT) AS remainingG,
  priceInrPerKg, status, createdAt`;
export const anchorColumns = "id, tradeId, status, txHash, CAST(blockNumber AS TEXT) AS blockNumber, attempts, lastError, updatedAt";
const tradeColumns = `t.id, t.listingId, t.buyerOrgId, t.sellerOrgId, CAST(t.amountG AS TEXT) AS amountG,
  t.priceInrPerKg, t.totalInr, t.status, t.tradeHash, t.settledAt`;
const tradeJoin = `FROM Trade t LEFT JOIN Anchor a ON a.tradeId = t.id`;
const tradeWithAnchor = `${tradeColumns}, CASE WHEN a.id IS NOT NULL THEN json_object(
    'id', a.id, 'tradeId', a.tradeId, 'status', a.status, 'txHash', a.txHash, 'blockNumber', CAST(a.blockNumber AS TEXT),
    'attempts', a.attempts, 'lastError', a.lastError, 'updatedAt', a.updatedAt
  ) END AS anchor`;

type Listing = { id: string; sellerOrgId: string; amountG: string; remainingG: string; priceInrPerKg: string; status: string; createdAt: string };
type AnchorView = {
  id: string; tradeId: string; status: string; txHash: string | null; blockNumber: string | null;
  attempts: number; lastError: string | null; updatedAt: string;
};
type StoredTrade = SettledTrade & { tradeHash: string; anchor: string | null };
const parsedTrade = ({ anchor, ...trade }: StoredTrade) => ({ ...trade, anchor: anchor === null ? null : JSON.parse(anchor) as AnchorView });

export async function findTrades(db: D1Database, organisationId?: string) {
  const filters = organisationId === undefined ? "" : "WHERE t.buyerOrgId = ?1 OR t.sellerOrgId = ?1";
  const params = organisationId === undefined ? [] : [organisationId];
  const records = await all<StoredTrade>(db, `SELECT ${tradeWithAnchor} ${tradeJoin} ${filters} ORDER BY t.settledAt DESC`, ...params);
  return records.map(parsedTrade);
}

function pairedLedgerEntries(db: D1Database, id: string, kind: "RESERVE" | "RELEASE", direction: number, amountColumn: "amountG" | "remainingG") {
  return sql(db, `INSERT INTO LedgerEntry (id, organisationId, kind, amountG, bucket, listingId)
    SELECT CASE side.bucket WHEN 'AVAILABLE' THEN ? ELSE ? END, l.sellerOrgId, ?, l.${amountColumn} * side.sign * CAST(? AS INTEGER), side.bucket, l.id
    FROM Listing l CROSS JOIN (SELECT 'AVAILABLE' AS bucket, 1 AS sign UNION ALL SELECT 'RESERVED', -1) side
    WHERE l.id = ? AND changes() = 1`, crypto.randomUUID(), crypto.randomUUID(), kind, direction, id);
}

listings.use(authenticate);

listings.get("/mine", requireRole("GENERATOR"), async (c) => c.json(await all<Listing>(
  c.env.DB, `SELECT ${listingColumns} FROM Listing WHERE sellerOrgId = ? ORDER BY createdAt DESC`, c.get("user").organisationId,
)));

listings.get("/", requireRole("BUYER"), async (c) => c.json(await all(c.env.DB, `
  SELECT l.id, CAST(l.remainingG AS TEXT) AS remainingG, l.priceInrPerKg, l.createdAt, o.name AS sellerOrgName
  FROM Listing l JOIN Organisation o ON o.id = l.sellerOrgId WHERE l.status = 'LISTED' ORDER BY l.createdAt DESC`,
)));

listings.post("/", requireRole("GENERATOR"), async (c) => {
  const input = body(c);
  const amount = parseGrams(input.amountG).toString();
  const price = parseDecimal(input.priceInrPerKg, "priceInrPerKg", 12, 6);
  const org = c.get("user").organisationId;
  const db = c.env.DB;
  const id = crypto.randomUUID();

  // Divide before summing to keep the ledger projection exact even past SQLite's 64-bit entry range.
  const [created] = await db.batch<Listing>([
    sql(db, `WITH difference AS (
      SELECT COALESCE(high, 0) - CAST(?2 AS INTEGER) / ${LEDGER_BASE} AS high,
             COALESCE(low, 0) - CAST(?2 AS INTEGER) % ${LEDGER_BASE} AS low
      FROM Organisation LEFT JOIN LedgerBalance
        ON organisationId = Organisation.id AND bucket = 'AVAILABLE'
      WHERE Organisation.id = ?3
    )
    INSERT INTO Listing (id, amountG, remainingG, sellerOrgId, priceInrPerKg)
    SELECT ?1, CAST(?2 AS INTEGER), CAST(?2 AS INTEGER), ?3, ?4
    FROM difference WHERE high + low / ${LEDGER_BASE} > 0
      OR (high + low / ${LEDGER_BASE} = 0 AND low % ${LEDGER_BASE} >= 0)
    RETURNING ${listingColumns}`, id, amount, org, price),
    pairedLedgerEntries(db, id, "RESERVE", -1, "amountG"),
  ]);
  if (!created.results[0]) throw new HttpError(409, "insufficient available units");
  return c.json(created.results[0], 201);
});

listings.post("/:id/cancel", requireRole("GENERATOR"), async (c) => {
  const db = c.env.DB;
  const org = c.get("user").organisationId;
  const id = c.req.param("id");
  const [, , , result] = await db.batch<Listing>([
    sql(db, "UPDATE Listing SET status = 'CANCELLED' WHERE id = ? AND sellerOrgId = ? AND status = 'LISTED'", id, org),
    pairedLedgerEntries(db, id, "RELEASE", 1, "remainingG"),
    sql(db, "UPDATE Listing SET remainingG = 0 WHERE id = ? AND changes() = 2", id),
    sql(db, `SELECT ${listingColumns} FROM Listing WHERE id = ? AND sellerOrgId = ?`, id, org),
  ]);
  const listing = result.results[0];
  if (!listing) throw new HttpError(404, "listing not found");
  if (listing.status !== "CANCELLED") throw new HttpError(409, "listing cannot be cancelled");
  return c.json(listing);
});

trades.use(authenticate);

trades.post("/", requireRole("BUYER"), async (c) => {
  const { listingId, amountG: requested } = body(c);
  if (typeof listingId !== "string" || !listingId) throw new HttpError(400, "listingId is required");
  const amountG = parseGrams(requested).toString();
  const db = c.env.DB;
  // Only immutable quote terms are read here. Availability is decided by the first write of the batch.
  const quote = await first<Pick<Listing, "sellerOrgId" | "priceInrPerKg">>(
    db, "SELECT sellerOrgId, priceInrPerKg FROM Listing WHERE id = ?", listingId,
  );
  if (!quote) throw new HttpError(404, "listing not found");

  const { sellerOrgId, priceInrPerKg } = quote;
  const id = crypto.randomUUID();
  const buyerOrgId = c.get("user").organisationId;
  const totalInr = tradeTotal(amountG, priceInrPerKg);
  const settledAt = new Date().toISOString();
  const settled = { id, listingId, buyerOrgId, sellerOrgId, amountG, priceInrPerKg, totalInr, status: "SETTLED", settledAt };
  const tradeHash = settledHash(settled);

  const [debit] = await db.batch([
    sql(db, `UPDATE Listing
      SET remainingG = remainingG - CAST(?1 AS INTEGER),
          status = CASE WHEN remainingG = CAST(?1 AS INTEGER) THEN 'FILLED' ELSE 'LISTED' END
      WHERE id = ?2 AND status = 'LISTED' AND remainingG >= CAST(?1 AS INTEGER)
        AND sellerOrgId = ?3 AND priceInrPerKg = ?4`, amountG, listingId, sellerOrgId, priceInrPerKg),
    sql(db, `INSERT INTO Trade (id, listingId, buyerOrgId, sellerOrgId, amountG, priceInrPerKg, totalInr, tradeHash, settledAt)
      SELECT ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?, ? WHERE changes() = 1`,
    id, listingId, buyerOrgId, sellerOrgId, amountG, priceInrPerKg, totalInr, tradeHash, settledAt),
    sql(db, `INSERT INTO LedgerEntry (id, organisationId, kind, amountG, bucket, listingId, tradeId)
      SELECT ?1, sellerOrgId, 'TRANSFER_OUT', -amountG, 'RESERVED', listingId, id FROM Trade WHERE id = ?3 AND changes() = 1
      UNION ALL
      SELECT ?2, buyerOrgId, 'TRANSFER_IN', amountG, 'AVAILABLE', listingId, id FROM Trade WHERE id = ?3 AND changes() = 1`,
    crypto.randomUUID(), crypto.randomUUID(), id),
    sql(db, "INSERT INTO Anchor (id, tradeId) SELECT ?, id FROM Trade WHERE id = ? AND changes() = 2", crypto.randomUUID(), id),
  ]);
  if (debit.meta.changes === 0) throw new HttpError(409, "insufficient units remaining");
  const { settledAt: _, ...trade } = settled;
  return c.json({ ...trade, tradeHash, settledAt }, 201);
});

trades.get("/mine", requireRole("BUYER", "GENERATOR"), async (c) => c.json(await findTrades(c.env.DB, c.get("user").organisationId)));

async function accessibleTrade(db: D1Database, id: string, org: string, admin: boolean) {
  const trade = await first<StoredTrade>(db, `SELECT ${tradeWithAnchor} ${tradeJoin}
    WHERE t.id = ?1 AND (?2 OR t.buyerOrgId = ?3 OR t.sellerOrgId = ?3)`, id, Number(admin), org);
  if (!trade) throw new HttpError(404, "trade not found");
  return parsedTrade(trade);
}

trades.get("/:id", requireRole("BUYER", "GENERATOR", "ADMIN"), async (c) => {
  const user = c.get("user");
  const trade = await accessibleTrade(c.env.DB, c.req.param("id"), user.organisationId, user.roles.includes("ADMIN"));
  const explorerUrl = trade.anchor?.status === "CONFIRMED" && trade.anchor.txHash
    ? `https://sepolia.etherscan.io/tx/${trade.anchor.txHash}` : null;
  return c.json({ ...trade, explorerUrl });
});

trades.get("/:id/verify", requireRole("BUYER", "GENERATOR", "ADMIN"), async (c) => {
  const user = c.get("user");
  const { id, tradeHash: storedHash } = await accessibleTrade(c.env.DB, c.req.param("id"), user.organisationId, user.roles.includes("ADMIN"));
  const chain = anchorChain(c.env);
  const onChainHash = chain ? await readAnchoredHash(chain, id) : null;
  return c.json({ storedHash, onChainHash, match: storedHash === onChainHash });
});
