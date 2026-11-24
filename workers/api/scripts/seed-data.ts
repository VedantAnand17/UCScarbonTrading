import { createHmac } from "node:crypto";
import { hash } from "bcryptjs";
import { canonicalReading, encryptSecret, randomHex } from "../src/device-crypto.ts";
import { mintGrams } from "../src/decimal.ts";
import { settledHash, tradeTotal } from "../src/trade-proof.ts";

const plants = [
  { organisationId: "demo_north_solar", name: "North Solar", deviceId: "dev_demo_north", ratedCapacityKw: 55 },
  { organisationId: "demo_lake_solar", name: "Lakeside Renewables", deviceId: "dev_demo_lake", ratedCapacityKw: 38 },
];
const buyerOrgId = "demo_buyer";
const hourSeconds = 3600;
const samples = 21 * 24;

type Value = string | number | bigint;
type Row = Record<string, Value>;

const literal = (value: Value) => typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value);
function insert(table: string, row: Row) {
  const columns = Object.keys(row).join(", ");
  const values = Object.values(row).map(literal).join(", ");
  if (table === "LedgerEntry") {
    return `INSERT INTO LedgerEntry (${columns}) SELECT ${values}
      WHERE NOT EXISTS (SELECT 1 FROM LedgerEntry WHERE id = ${literal(row.id)});`;
  }
  return `INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING;`;
}

function randomFraction(key: number) {
  const mixed = Math.imul(key ^ (key >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 2 ** 32;
}

function solarKwh(capacity: number, plantIndex: number, timestamp: number) {
  const localSeconds = timestamp + 5.5 * hourSeconds;
  const day = Math.floor(localSeconds / 86400);
  const hour = (localSeconds % 86400) / hourSeconds;
  if (hour < 6 || hour > 18) return 0;
  const daylight = Math.sin(Math.PI * (hour - 6) / 12);
  const cloudCover = 0.55 + 0.45 * randomFraction(day * 13 + plantIndex);
  const noise = 0.9 + 0.2 * randomFraction(Math.floor(localSeconds / hourSeconds) + plantIndex * 1009);
  return Number((capacity * daylight * cloudCover * noise).toFixed(6));
}

export async function demoSeedStatements(encryptionKey: string) {
  const createdAt = new Date().toISOString();
  const passwordHash = await hash("demo1234", 12);
  const end = Math.floor(Date.now() / (hourSeconds * 1000)) * hourSeconds;
  const start = end - (samples - 1) * hourSeconds;
  const statements = [
    ...plants.map((plant) => insert("Organisation", { id: plant.organisationId, name: plant.name, createdAt })),
    insert("Organisation", { id: buyerOrgId, name: "Demo Industrial Buyer", createdAt }),
  ];
  const users = [
    ["generator", "North Solar Operator", "GENERATOR", plants[0].organisationId],
    ["generator2", "Lakeside Solar Operator", "GENERATOR", plants[1].organisationId],
    ["buyer", "Demo Buyer", "BUYER", buyerOrgId],
    ["admin", "Demo Administrator", "ADMIN", buyerOrgId],
  ];
  for (const [account, name, role, organisationId] of users) {
    statements.push(insert("User", {
      id: `demo_user_${account}`, email: `${account}@demo.in`, name, passwordHash,
      roles: JSON.stringify([role]), organisationId, createdAt,
    }));
  }

  for (const [plantIndex, { organisationId, name, deviceId, ratedCapacityKw }] of plants.entries()) {
    const secret = randomHex(32);
    statements.push(insert("Device", {
      deviceId, ...(await encryptSecret(secret, encryptionKey)), label: `${name} meter`, ratedCapacityKw,
      organisationId, lastSeq: samples, createdAt: new Date(start * 1000).toISOString(),
    }));
    let kwhCumulative = 1000;
    for (let index = 0; index < samples; index++) {
      const seq = index + 1;
      const deviceTimestamp = start + index * hourSeconds;
      const receivedAt = new Date(deviceTimestamp * 1000).toISOString();
      const kwhInterval = index === 0 ? 0 : solarKwh(ratedCapacityKw, plantIndex, deviceTimestamp);
      kwhCumulative = Number((kwhCumulative + kwhInterval).toFixed(6));
      const signature = createHmac("sha256", secret).update(canonicalReading({
        device_id: deviceId, seq, timestamp: deviceTimestamp, kwh_cumulative: kwhCumulative, kwh_interval: kwhInterval,
      })).digest("hex");
      statements.push(insert("Reading", {
        deviceId, seq, deviceTimestamp, receivedAt, kwhCumulative, kwhInterval, validated: 1, signature,
      }));
      if (kwhInterval > 0) {
        // Use the reading actually persisted, so regenerating the demo script in a later hour remains a no-op.
        const ledgerId = literal(`demo_mint_${deviceId}_${seq}`);
        statements.push(`INSERT INTO LedgerEntry (id, organisationId, kind, amountG, bucket, readingId, factorVersion, createdAt)
          SELECT ${ledgerId}, ${literal(organisationId)}, 'MINT', ${mintGrams(kwhInterval, "0.71")}, 'AVAILABLE', r.id, 'CEA-v20', r.receivedAt
          FROM Reading r WHERE r.deviceId = ${literal(deviceId)} AND r.seq = ${seq} AND r.deviceTimestamp = ${deviceTimestamp}
          AND NOT EXISTS (SELECT 1 FROM LedgerEntry WHERE id = ${ledgerId} OR (readingId = r.id AND kind = 'MINT'));`);
      }
    }
  }

  const listings = [
    { sellerOrgId: plants[0].organisationId, amount: 300_000n, bought: 100_000n, priceInrPerKg: "12.5" },
    { sellerOrgId: plants[1].organisationId, amount: 200_000n, bought: 200_000n, priceInrPerKg: "14" },
    { sellerOrgId: plants[0].organisationId, amount: 150_000n, bought: 80_000n, priceInrPerKg: "13.25" },
  ];
  for (const [index, { sellerOrgId, amount, bought, priceInrPerKg }] of listings.entries()) {
    const listingId = `demo_listing_${index + 1}`;
    const id = `demo_trade_${index + 1}`;
    const remainingG = amount - bought;
    const settled = {
      id, listingId, buyerOrgId, sellerOrgId, amountG: bought.toString(), priceInrPerKg,
      totalInr: tradeTotal(bought.toString(), priceInrPerKg), status: "SETTLED", settledAt: createdAt,
    };
    statements.push(
      insert("Listing", {
        id: listingId, sellerOrgId, amountG: amount, remainingG, priceInrPerKg,
        status: remainingG === 0n ? "FILLED" : "LISTED", createdAt,
      }),
      insert("Trade", { ...settled, amountG: bought, tradeHash: settledHash(settled) }),
      insert("LedgerEntry", { id: `demo_debit_${listingId}`, organisationId: sellerOrgId, kind: "RESERVE", amountG: -amount, bucket: "AVAILABLE", listingId, createdAt }),
      insert("LedgerEntry", { id: `demo_reserve_${listingId}`, organisationId: sellerOrgId, kind: "RESERVE", amountG: amount, bucket: "RESERVED", listingId, createdAt }),
      insert("LedgerEntry", { id: `demo_out_${id}`, organisationId: sellerOrgId, kind: "TRANSFER_OUT", amountG: -bought, bucket: "RESERVED", listingId, tradeId: id, createdAt }),
      insert("LedgerEntry", { id: `demo_in_${id}`, organisationId: buyerOrgId, kind: "TRANSFER_IN", amountG: bought, bucket: "AVAILABLE", listingId, tradeId: id, createdAt }),
      insert("Anchor", { id: `demo_anchor_${index + 1}`, tradeId: id, status: "PENDING", updatedAt: createdAt, nextAttemptAt: createdAt }),
    );
  }
  return statements;
}
