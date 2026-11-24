import { applyD1Migrations, createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext, type D1Migration } from "cloudflare:test";
import { createHmac, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { beforeAll, beforeEach, expect, inject, test } from "vitest";

import { keccak256, stringToHex } from "viem";
import worker from "../src/index";

beforeAll(() => applyD1Migrations(env.DB, (env as Env & { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS));
const password = "demo1234";
let admin: Account;
let buyer: Account;
type Account = { orgId: string; token: string };
type Meter = Account & { id: string; secret: string };

async function request(path: string, token?: string, body?: object) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body) headers.set("Content-Type", "application/json");
  return SELF.fetch(`http://worker/api/v1${path}`, {
    headers, method: body ? "POST" : "GET", body: body && JSON.stringify(body),
  });
}

async function json<T>(response: Response, status: number): Promise<T> {
  const data = await response.json<T>();
  expect(response.status, JSON.stringify(data)).toBe(status);
  return data;
}

async function account(role: string): Promise<Account> {
  const orgId = randomUUID();
  const email = `${orgId}@test.in`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO Organisation (id, name) VALUES (?, ?)").bind(orgId, role),
    env.DB.prepare("INSERT INTO User (id, email, passwordHash, name, roles, organisationId) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(randomUUID(), email, await hash(password, 4), role, JSON.stringify([role]), orgId),
  ]);
  const login = await json<{ token: string; user: object }>(await request("/auth/login", undefined, { email, password }), 200);
  expect(login.user).not.toHaveProperty("passwordHash");
  expect(await json(await request("/auth/me", login.token), 200)).toEqual(login.user);
  return { orgId, token: login.token };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER ledger_no_delete"),
    ...["LedgerEntry", "Anchor", "Trade", "Listing", "Forecast", "Reading", "Device", "User", "Organisation"].map(
      (table) => env.DB.prepare(`DELETE FROM ${table}`),
    ),
    env.DB.prepare("DELETE FROM EmissionFactor WHERE version <> 'CEA-v20'"),
    env.DB.prepare("CREATE TRIGGER ledger_no_delete BEFORE DELETE ON LedgerEntry BEGIN SELECT RAISE(ABORT, 'LedgerEntry is append-only'); END"),
  ]);
  admin = await account("ADMIN");
  buyer = await account("BUYER");
});

async function meter(): Promise<Meter> {
  const generator = await account("GENERATOR");
  const provision = await json<{ device_id: string; device_secret: string }>(
    await request("/admin/devices", admin.token, { label: "Test meter", ratedCapacityKw: 60, organisationId: generator.orgId }), 201,
  );
  return { ...generator, id: provision.device_id, secret: provision.device_secret };
}

const now = () => Math.floor(Date.now() / 1000);

function reading(device: Meter, overrides: Partial<{ seq: number; timestamp: number; kwh_cumulative: number; kwh_interval: number }> = {}) {
  const fields = { device_id: device.id, seq: 1, timestamp: now() - 30, kwh_cumulative: 102, kwh_interval: 2, ...overrides };
  const payload = [fields.device_id, fields.seq, fields.timestamp, fields.kwh_cumulative.toFixed(6), fields.kwh_interval.toFixed(6)].join("|");
  return { ...fields, signature: createHmac("sha256", device.secret).update(payload).digest("hex") };
}

const send = (body: object) => request("/ingest/reading", undefined, body);
const entries = async (orgId: string) => (await env.DB.prepare(
  "SELECT id, kind, bucket, CAST(amountG AS TEXT) AS amountG, factorVersion, tradeId FROM LedgerEntry WHERE organisationId=? ORDER BY createdAt, id",
).bind(orgId).all<{ id: string; kind: string; bucket: string; amountG: string; factorVersion: string | null; tradeId: string | null }>()).results;
const readings = async (device: Meter) => (await env.DB.prepare("SELECT * FROM Reading WHERE deviceId=? ORDER BY seq").bind(device.id).all()).results;
const summary = async (device: Meter) => json<{ availableG: string; reservedG: string; todayKwh: number }>(await request("/generator/summary", device.token), 200);
const purchase = (listing: { id: string }, amountG: number | string) => request("/trades", buyer.token, { listingId: listing.id, amountG });
const reserve = (device: Meter, amountG: number | string, priceInrPerKg = "12.50") => request("/listings", device.token, { amountG, priceInrPerKg });

async function fundedListing() {
  const device = await meter();
  expect((await send(reading(device))).status).toBe(200);
  const listing = await json<{ id: string; sellerOrgId: string }>(await reserve(device, 1000), 201);
  return { device, listing };
}

async function checkBalances(device: Meter, available: string, reserved: string) {
  const ledger = await entries(device.orgId);
  const sum = (bucket: string) => ledger.filter((item) => item.bucket === bucket).reduce((total, item) => total + BigInt(item.amountG), 0n).toString();
  expect(await summary(device)).toMatchObject({ availableG: sum("AVAILABLE"), reservedG: sum("RESERVED") });
  expect([sum("AVAILABLE"), sum("RESERVED")]).toEqual([available, reserved]);
}

test("TC-1 valid signed reading is credited once with the versioned factor", async () => {
  const device = await meter();
  expect(await json(await send(reading(device)), 200)).toEqual({ status: "accepted", validated: true, creditsAmount: null });
  expect(await readings(device)).toHaveLength(1);
  expect(await entries(device.orgId)).toMatchObject([{ kind: "MINT", amountG: "1420", factorVersion: "CEA-v20" }]);
});

test("TC-2 unsigned reading returns 401 and is not stored", async () => {
  const device = await meter();
  const { signature, ...unsigned } = reading(device);
  expect(await json(await send(unsigned), 401)).toEqual({ error: "unauthorized" });
  expect(await readings(device)).toHaveLength(0);
});

test("TC-3 tampered reading returns 401 and is not stored", async () => {
  const device = await meter();
  expect((await send({ ...reading(device), kwh_interval: 3 })).status).toBe(401);
  expect(await readings(device)).toHaveLength(0);
});

test("TC-4 concurrent replay is rejected without a second credit", async () => {
  const device = await meter();
  const payload = reading(device);
  const results = await Promise.all([send(payload), send(payload)]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(await entries(device.orgId)).toHaveLength(1);
});

test("TC-5 delayed buffered reading uses its capture time", async () => {
  const device = await meter();
  const timestamp = now() - 3 * 86400;
  const payload = reading(device, { timestamp });
  expect((await send(payload)).status).toBe(200);
  expect((await send(payload)).status).toBe(409);
  expect(await readings(device)).toMatchObject([{ deviceTimestamp: timestamp }]);
  expect(await entries(device.orgId)).toHaveLength(1);
  expect((await summary(device)).todayKwh).toBe(0);
});

test("TC-6 implausible spike is flagged, consumes its sequence and issues no units", async () => {
  const device = await meter();
  const payload = reading(device, { kwh_interval: 400 });
  expect(await json(await send(payload), 422)).toEqual({ error: "kwh_interval exceeds plausible maximum of 7.500000 kWh" });
  expect((await send(payload)).status).toBe(409);
  expect(await readings(device)).toMatchObject([{ validated: 0 }]);
  expect(await entries(device.orgId)).toHaveLength(0);
});

test("TC-7 balances equal ledger sums after reservation, sale and release", async () => {
  const { device, listing } = await fundedListing();
  expect((await purchase(listing, 400)).status).toBe(201);
  expect(await json(await request(`/listings/${listing.id}/cancel`, device.token, {}), 200)).toMatchObject({ remainingG: "0", status: "CANCELLED" });
  expect((await request(`/listings/${listing.id}/cancel`, device.token, {})).status).toBe(200);
  await checkBalances(device, "1020", "0");
});

test("TC-8 a failed anchor insert rolls back the purchase and ledger", async () => {
  const { device, listing } = await fundedListing();
  const before = await entries(device.orgId);
  await env.DB.prepare("CREATE TRIGGER fail_anchor BEFORE INSERT ON Anchor BEGIN SELECT RAISE(ABORT, 'injected anchor failure'); END").run();
  try {
    expect((await purchase(listing, 400)).status).toBe(500);
    expect(await env.DB.prepare("SELECT remainingG FROM Listing WHERE id=?").bind(listing.id).first("remainingG")).toBe(1000);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM Trade WHERE listingId=?").bind(listing.id).first("count")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM Anchor").first("count")).toBe(0);
    expect(await entries(device.orgId)).toEqual(before);
    expect(await entries(buyer.orgId)).toHaveLength(0);
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_anchor").run();
  }
});

test("TC-9 a purchase above the remainder returns 409", async () => {
  const { listing } = await fundedListing();
  expect((await purchase(listing, 400)).status).toBe(201);
  expect(await json(await purchase(listing, 601), 409)).toEqual({ error: "insufficient units remaining" });
});

test("TC-10 only one of 24 concurrent purchases settles and ledger sums match", async () => {
  const { device, listing } = await fundedListing();
  const results = await Promise.all(Array.from({ length: 24 }, () => purchase(listing, 1000)));
  expect(results.map((result) => result.status).sort()).toEqual([201, ...Array<number>(23).fill(409)]);
  const trades = await json<Array<{ id: string }>>(await request("/trades/mine", buyer.token), 200);
  expect(trades).toHaveLength(1);
  await checkBalances(device, "420", "0");
  expect(await entries(buyer.orgId)).toMatchObject([{ tradeId: trades[0].id, kind: "TRANSFER_IN", bucket: "AVAILABLE", amountG: "1000" }]);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM Anchor WHERE tradeId=?").bind(trades[0].id).first("count")).toBe(1);
});

test("TC-12 lower cumulative meter value is flagged and issues no negative units", async () => {
  const device = await meter();
  const first = reading(device);
  expect((await send(first)).status).toBe(200);
  expect(await json(await send(reading(device, { seq: 2, timestamp: first.timestamp + 10, kwh_cumulative: 50, kwh_interval: 0.1 })), 422))
    .toEqual({ error: "cumulative meter value decreased" });
  expect(await entries(device.orgId)).toMatchObject([{ amountG: "1420" }]);
});

test("TC-13 buyers cannot use admin routes", async () => {
  expect(await json(await request("/admin/devices", buyer.token), 403)).toEqual({ error: "forbidden" });
  expect((await request("/admin/readings?deviceId=x", buyer.token)).status).toBe(403);
  expect((await request("/admin/forecasts", buyer.token, { rows: [] })).status).toBe(403);
});

test("concurrent reservations cannot double spend and preserve full-range integer quantities", async () => {
  const device = await meter();
  const grams = "9223372036854775807";
  for (const id of ["upfront-a", "upfront-b"]) {
    await env.DB.prepare("INSERT INTO LedgerEntry (id, organisationId, kind, bucket, amountG) VALUES (?, ?, 'MINT', 'AVAILABLE', CAST(? AS INTEGER))")
      .bind(id, device.orgId, grams).run();
  }
  await checkBalances(device, "18446744073709551614", "0");
  const results = await Promise.all(Array.from({ length: 6 }, () => reserve(device, grams, ".000001")));
  expect(results.map((result) => result.status).sort()).toEqual([201, 201, 409, 409, 409, 409]);
  await checkBalances(device, "0", "18446744073709551614");
  const listing = await json<{ id: string }>(results.find((result) => result.status === 201)!, 201);
  expect(await json(await purchase(listing, 1), 201)).toMatchObject({ totalInr: "0.000000001" });
  await checkBalances(device, "0", "18446744073709551613");
});

test("admin reads validated samples and publishes the latest per-device forecast", async () => {
  const device = await meter();
  const other = await meter();
  const effectiveAt = now() - 1800;
  const factor = await json(await request("/admin/emission-factors", admin.token, {
    version: "capture-window", kgPerKwh: "0.500", source: "Test", validFrom: new Date(effectiveAt * 1000).toISOString(),
  }), 201);
  expect(factor).toMatchObject({ kgPerKwh: "0.5" });
  const timestamp = effectiveAt + 30;
  expect((await send(reading(device, { timestamp }))).status).toBe(200);
  expect((await send(reading(device, { seq: 2, timestamp: timestamp + 10, kwh_interval: 500 }))).status).toBe(422);
  expect(await entries(device.orgId)).toMatchObject([{ amountG: "1000", factorVersion: "capture-window" }]);
  expect(await json(await request(`/admin/readings?deviceId=${device.id}`, admin.token), 200))
    .toEqual({ readings: [{ deviceTimestamp: timestamp, kwhInterval: 2 }], nextCursor: null });
  expect(await json(await request("/generator/generation?days=1", device.token), 200))
    .toEqual([{ hour: new Date(Math.floor(timestamp / 3600) * 3600000).toISOString(), kwh: 2 }]);
  const forecast = {
    deviceId: device.id, horizonStart: new Date().toISOString(), horizonHours: 1, modelName: "test",
    modelVersion: "1", energyKwh: [3], avgKwh: 3, co2AvoidedKg: 2.13, unitsExpectedG: "2130",
    maeKwh: 0.1, rmseKwh: 0.2, baselineMaeKwh: 0.3, baselineRmseKwh: 0.4, confidence: 0.9,
  };
  expect((await request("/admin/forecasts", admin.token, { rows: [
    { ...forecast, id: "first", generatedAt: new Date(0).toISOString() },
    { ...forecast, id: "latest", generatedAt: new Date(1000).toISOString(), modelVersion: "2" },
    { ...forecast, id: "other", deviceId: other.id },
  ] })).status).toBe(201);
  expect(await json(await request("/generator/forecast", device.token), 200))
    .toMatchObject([{ id: "latest", deviceId: device.id, modelVersion: "2", energyKwh: [3], unitsExpectedG: "2130" }]);
});

test("admin reports redact secrets and revocation stops ingestion", async () => {
  const device = await meter();
  expect((await send(reading(device, { kwh_interval: 400 }))).status).toBe(422);
  const devices = await json<object[]>(await request("/admin/devices", admin.token), 200);
  expect(devices[0]).not.toHaveProperty("encryptedSecret");
  expect(devices[0]).not.toHaveProperty("secretIv");
  const flagged = await json<object[]>(await request("/admin/readings/flagged", admin.token), 200);
  expect(flagged[0]).toMatchObject({ deviceId: device.id, validated: false });
  expect(flagged[0]).not.toHaveProperty("signature");
  expect(await json(await request("/admin/overview", admin.token), 200)).toEqual({
    devices: 1, flaggedReadings: 1, trades: 0, anchorHealth: { pending: 0, inflight: 0, confirmed: 0, failed: 0, walletBalanceEth: null },
  });
  expect((await request(`/admin/devices/${device.id}/revoke`, admin.token, {})).status).toBe(200);
  expect((await send(reading(device, { seq: 2 }))).status).toBe(401);
});

test("TC-11 the scheduled Worker anchors on Anvil, reconciles a lost receipt and retries failures", async () => {
  const { rpcUrl, address, block, privateKey } = inject("anvil");
  const bindings: Env = { ...env, ANCHOR_RPC_URL: rpcUrl, TRADE_ANCHOR_ADDRESS: address, ANCHOR_DEPLOYMENT_BLOCK: block, ANCHOR_PRIVATE_KEY: privateKey };
  const { listing } = await fundedListing();
  const trade = await json<{ id: string; tradeHash: string; settledAt: string }>(await purchase(listing, 1000), 201);
  const expectedHash = keccak256(stringToHex(JSON.stringify({
    amountG: "1000", buyerOrgId: buyer.orgId, id: trade.id, listingId: listing.id,
    priceInrPerKg: "12.5", sellerOrgId: listing.sellerOrgId, settledAt: trade.settledAt,
    status: "SETTLED", totalInr: "12.5",
  })));
  expect(trade.tradeHash).toBe(expectedHash);
  const verify = async () => json(await worker.fetch(new Request(`http://worker/api/v1/trades/${trade.id}/verify`, {
    headers: { Authorization: `Bearer ${buyer.token}` },
  }), bindings), 200);
  expect(await verify()).toEqual({ storedHash: expectedHash, onChainHash: null, match: false });

  const runCron = async (runBindings = bindings) => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "* * * * *" }), runBindings, ctx);
    await waitOnExecutionContext(ctx);
  };
  const savedAnchor = (id = trade.id) => env.DB.prepare("SELECT * FROM Anchor WHERE tradeId=?").bind(id)
    .first<{ txHash: string; blockNumber: number; status: string; attempts: number; updatedAt: string; nextAttemptAt: string }>();
  await runCron();
  const settled = await savedAnchor();
  expect(settled).toMatchObject({ status: "CONFIRMED", txHash: expect.stringMatching(/^0x[a-f0-9]{64}$/) });
  expect(settled!.blockNumber).toBeGreaterThan(Number(block));
  expect(await verify()).toEqual({ storedHash: expectedHash, onChainHash: expectedHash, match: true });

  await env.DB.prepare("UPDATE Anchor SET status='INFLIGHT', txHash=NULL, blockNumber=NULL, nextAttemptAt=? WHERE tradeId=?")
    .bind(new Date(0).toISOString(), trade.id).run();
  await runCron();
  expect(await savedAnchor()).toMatchObject({ status: "CONFIRMED", txHash: settled!.txHash, blockNumber: settled!.blockNumber });
  expect(await json(await request(`/trades/${trade.id}`, buyer.token), 200))
    .toMatchObject({ explorerUrl: `https://sepolia.etherscan.io/tx/${settled!.txHash}` });

  const next = await fundedListing();
  const retry = await json<{ id: string }>(await purchase(next.listing, 1000), 201);
  await runCron({ ...bindings, ANCHOR_PRIVATE_KEY: "0x02".padEnd(66, "0") });
  const failed = await savedAnchor(retry.id);
  expect(failed).toMatchObject({ status: "FAILED", attempts: 1 });
  expect(failed!.nextAttemptAt > failed!.updatedAt).toBe(true);
  await runCron();
  expect((await savedAnchor(retry.id))?.attempts).toBe(1);
  expect((await request(`/admin/anchors/${retry.id}/retry`, admin.token, {})).status).toBe(200);
  await runCron();
  expect(await savedAnchor(retry.id)).toMatchObject({ status: "CONFIRMED", attempts: 1 });
});

test("demo SQL seeds three weeks per meter and can be reapplied after a purchase", async () => {
  const { demoSeedStatements } = await import("../scripts/seed-data");
  const seed = async () => {
    const queries = await demoSeedStatements(env.DEVICE_SECRET_ENCRYPTION_KEY);
    for (let start = 0; start < queries.length; start += 75) {
      await env.DB.batch(queries.slice(start, start + 75).map((query) => env.DB.prepare(query)));
    }
  };
  const login = async (email: string) => json<{ token: string }>(
    await request("/auth/login", undefined, { email, password }), 200,
  );
  await seed();
  const generator = await login("generator@demo.in");
  await login("generator2@demo.in");
  const demoBuyer = await login("buyer@demo.in");
  await login("admin@demo.in");
  const homes = await json<Array<{ id: string; remainingG: string }>>(await request("/listings/mine", generator.token), 200);
  expect(homes).toHaveLength(2);
  const seedTrades = await json<Array<{ status: string; anchor: { status: string } }>>(await request("/trades/mine", demoBuyer.token), 200);
  expect(seedTrades).toHaveLength(3);
  expect(seedTrades.every((trade) => trade.status === "SETTLED" && trade.anchor.status === "PENDING")).toBe(true);
  const listing = homes[0];
  expect((await request("/trades", demoBuyer.token, { listingId: listing.id, amountG: 1 })).status).toBe(201);
  await seed();
  const counts = await env.DB.prepare("SELECT deviceId, COUNT(*) AS count FROM Reading GROUP BY deviceId ORDER BY deviceId").all();
  expect(counts.results).toEqual([{ deviceId: "dev_demo_lake", count: 504 }, { deviceId: "dev_demo_north", count: 504 }]);
  const remaining = await env.DB.prepare("SELECT remainingG FROM Listing WHERE id=?").bind(listing.id).first("remainingG");
  expect(remaining).toBe(Number(listing.remainingG) - 1);
  expect(await json<unknown[]>(await request("/trades/mine", demoBuyer.token), 200)).toHaveLength(4);
});

test("legacy opt-in retains the credits response and records mint failure separately from ingestion", async () => {
  const device = await meter();
  const ctx = createExecutionContext();
  const bindings = { ...env, LEGACY_MINT_ENABLED: "true" };
  const response = await worker.fetch(new Request("http://worker/api/v1/ingest/reading", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reading(device)),
  }), bindings, ctx);
  expect(await json(response, 200)).toEqual({ status: "accepted", validated: true, creditsAmount: 1 });
  await waitOnExecutionContext(ctx);
  expect(await readings(device)).toMatchObject([{ creditsAmount: 1, mintStatus: "failed", mintError: "device not bound to a project/generatorAddress" }]);
  await checkBalances(device, "1420", "0");
});

test("the ledger refuses updates, deletes and replacement of an existing entry", async () => {
  const device = await meter();
  expect((await send(reading(device))).status).toBe(200);
  const [mint] = await entries(device.orgId);
  await expect(env.DB.prepare("UPDATE LedgerEntry SET amountG = 1 WHERE id = ?").bind(mint.id).run()).rejects.toThrow();
  await expect(env.DB.prepare("DELETE FROM LedgerEntry WHERE id = ?").bind(mint.id).run()).rejects.toThrow();
  await expect(env.DB.prepare(`
    INSERT OR REPLACE INTO LedgerEntry (id, organisationId, kind, amountG, bucket)
    VALUES (?, ?, 'MINT', 1, 'AVAILABLE')`).bind(mint.id, device.orgId).run()).rejects.toThrow();
  await expect(env.DB.prepare(`
    INSERT OR REPLACE INTO LedgerEntry (id, organisationId, kind, amountG, bucket, readingId)
    SELECT 'replacement', organisationId, kind, 1, bucket, readingId FROM LedgerEntry WHERE id = ?
  `).bind(mint.id).run()).rejects.toThrow();
  expect(await entries(device.orgId)).toEqual([mint]);
});
