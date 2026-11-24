const assert = require("node:assert/strict");
const { randomBytes, randomUUID, createHmac } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { Client } = require("pg");
const supertest = require("supertest");
const { createPublicClient, createTestClient, createWalletClient, http, keccak256, parseEther, stringToHex } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

const databaseUrl = new URL(process.env.TEST_DATABASE_URL || "postgresql://ucs:ucs@localhost:54329/ucs");
const schema = `test_${randomUUID().replaceAll("-", "")}`;
databaseUrl.searchParams.set("schema", schema);
process.env.DATABASE_URL = databaseUrl.href;
process.env.DEVICE_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.LEGACY_MINT_ENABLED = "false";
process.env.ANCHOR_RPC_URL = process.env.TEST_ANCHOR_RPC_URL || "http://127.0.0.1:8546";
process.env.ANCHOR_PRIVATE_KEY = generatePrivateKey();

const contracts = path.resolve(__dirname, "../../contracts");
const db = new Client({ connectionString: databaseUrl.href });
let prisma;
let databaseConnected = false;
let api;
let buyerToken;
let adminToken;
let buyerOrgId;
const password = "demo1234";
let passwordHash;

async function login(email) {
  const { body } = await api.post("/auth/login").send({ email, password }).expect(200);
  assert.equal(body.user.email, email);
  assert.equal(body.user.passwordHash, undefined);
  return body.token;
}

async function user(role) {
  const email = `${randomUUID()}@test.in`;
  const organisation = await prisma.organisation.create({ data: { name: email } });
  await prisma.user.create({ data: { email, name: role, roles: [role], organisationId: organisation.id, passwordHash } });
  return { orgId: organisation.id, token: await login(email) };
}

before(async () => {
  await db.connect();
  databaseConnected = true;
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe" });
  prisma = require("../src/lib/prisma");
  api = supertest(require("../src/app"));
  const request = api;
  api = Object.fromEntries(["get", "post"].map((method) => [method, (route) => request[method](`/api/v1${route}`)]));
  passwordHash = await require("bcryptjs").hash(password, 4);
  ({ token: buyerToken, orgId: buyerOrgId } = await user("BUYER"));
  ({ token: adminToken } = await user("ADMIN"));
  await db.query(`SET search_path TO "${schema}"`);
});

after(async () => {
  await prisma?.$disconnect();
  try {
    if (databaseConnected) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await db.end();
  }
});

async function meter() {
  const { orgId, token } = await user("GENERATOR");
  const { body } = await api.post("/admin/devices").auth(adminToken, { type: "bearer" }).send({
    label: "Test meter", ratedCapacityKw: 60, organisationId: orgId,
  }).expect(201);
  return { orgId, token, id: body.device_id, secret: body.device_secret };
}

const now = () => Math.floor(Date.now() / 1000);
function reading(device, overrides = {}) {
  const fields = { device_id: device.id, seq: 1, timestamp: now() - 30, kwh_cumulative: 102, kwh_interval: 2, ...overrides };
  const canonical = [fields.device_id, fields.seq, fields.timestamp, fields.kwh_cumulative.toFixed(6), fields.kwh_interval.toFixed(6)].join("|");
  return { ...fields, signature: createHmac("sha256", device.secret).update(canonical).digest("hex") };
}

const send = (body) => api.post("/ingest/reading").send(body);
const entries = (device) => prisma.ledgerEntry.findMany({ where: { organisationId: device.orgId } });
const readings = (device) => prisma.reading.findMany({ where: { deviceId: device.id }, orderBy: { seq: "asc" } });
const summary = (device) => api.get("/generator/summary").auth(device.token, { type: "bearer" }).expect(200);
const purchase = (listing, amountG) => api.post("/trades").auth(buyerToken, { type: "bearer" }).send({ listingId: listing.id, amountG });

async function list(device, amountG) {
  return (await api.post("/listings").auth(device.token, { type: "bearer" }).send({ amountG, priceInrPerKg: "12.50" }).expect(201)).body;
}

async function fundedListing() {
  const device = await meter();
  await send(reading(device)).expect(200);
  return { device, listing: await list(device, 1000) };
}

test("TC-1 valid signed reading is credited once with the versioned factor", async () => {
  const device = await meter();
  await send(reading(device)).expect(200);
  assert.equal((await readings(device)).length, 1);
  const [mint, ...other] = await entries(device);
  assert.equal(other.length, 0);
  assert.equal(mint.kind, "MINT");
  assert.equal(mint.amountG, 1420n);
  assert.equal(mint.factorVersion, "CEA-v20");
});

test("TC-2 unsigned reading returns 401 and is not stored", async () => {
  const device = await meter();
  const { signature, ...unsigned } = reading(device);
  await send(unsigned).expect(401);
  assert.equal((await readings(device)).length, 0);
});

test("TC-3 tampered signed reading returns 401 and is not stored", async () => {
  const device = await meter();
  await send({ ...reading(device), kwh_interval: 3 }).expect(401);
  assert.equal((await readings(device)).length, 0);
});

test("TC-4 concurrent replay of a sequence is rejected without a second credit", async () => {
  const device = await meter();
  const body = reading(device);
  const results = await Promise.all([send(body), send(body)]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal((await entries(device)).length, 1);
});

test("TC-5 delayed buffered reading uses its capture time and is admitted once", async () => {
  const device = await meter();
  const timestamp = now() - 3 * 86400;
  const delayed = reading(device, { timestamp });
  await send(delayed).expect(200);
  await send(delayed).expect(409);
  const [stored] = await readings(device);
  assert.equal(stored.deviceTimestamp, timestamp);
  assert.equal((await entries(device)).length, 1);
  assert.equal((await summary(device)).body.todayKwh, 0);
});

test("TC-6 implausible spike returns 422, is flagged and issues no units", async () => {
  const device = await meter();
  const spike = reading(device, { kwh_interval: 400 });
  await send(spike).expect(422);
  await send(spike).expect(409);
  const stored = await readings(device);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].validated, false);
  assert.equal((await entries(device)).length, 0);
});

test("TC-7 projected balances equal ledger sums after reservation, sale, and release", async () => {
  const { device, listing } = await fundedListing();
  await purchase(listing, 400).expect(201);
  await api.post(`/listings/${listing.id}/cancel`).auth(device.token, { type: "bearer" }).expect(200);
  const ledger = await entries(device);
  const projected = (bucket) => ledger.filter((entry) => entry.bucket === bucket).reduce((sum, entry) => sum + entry.amountG, 0n);
  const { body } = await summary(device);
  assert.equal(BigInt(body.availableG), projected("AVAILABLE"));
  assert.equal(BigInt(body.reservedG), projected("RESERVED"));
  assert.deepEqual([body.availableG, body.reservedG], ["1020", "0"]);
});

test("TC-8 injected failure during settlement rolls back listing, trade, ledger, and anchor", async () => {
  const { device, listing } = await fundedListing();
  const beforeEntries = await entries(device);
  const buyerCount = await prisma.ledgerEntry.count({ where: { organisationId: buyerOrgId } });
  await db.query(`CREATE FUNCTION fail_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected anchor insert failure'; END $$`);
  await db.query('CREATE TRIGGER fail_anchor BEFORE INSERT ON "Anchor" FOR EACH ROW EXECUTE FUNCTION fail_anchor()');
  try {
    await purchase(listing, 400).expect(500);
  } finally {
    await db.query('DROP TRIGGER fail_anchor ON "Anchor"');
    await db.query('DROP FUNCTION fail_anchor()');
  }
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).remainingG, 1000n);
  assert.equal(await prisma.trade.count({ where: { listingId: listing.id } }), 0);
  assert.equal(await prisma.anchor.count({ where: { trade: { listingId: listing.id } } }), 0);
  assert.deepEqual((await entries(device)).map(({ id }) => id).sort(), beforeEntries.map(({ id }) => id).sort());
  assert.equal(await prisma.ledgerEntry.count({ where: { organisationId: buyerOrgId } }), buyerCount);
});

test("TC-9 purchase above remaining listing amount returns 409", async () => {
  const { listing } = await fundedListing();
  await purchase(listing, 400).expect(201);
  await purchase(listing, 601).expect(409);
});

test("TC-10 concurrent requests settle exactly one purchase when only one fits", async () => {
  const { device, listing } = await fundedListing();
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => purchase(listing, 1000)));
  assert.equal(outcomes.filter(({ status }) => status === 201).length, 1);
  assert.equal(outcomes.filter(({ status }) => status === 409).length, 11);
  const trade = await prisma.trade.findFirstOrThrow({ where: { listingId: listing.id } });
  assert.equal(await prisma.trade.count({ where: { listingId: listing.id } }), 1);
  assert.equal((await summary(device)).body.reservedG, "0");
  assert.equal(await prisma.ledgerEntry.count({ where: { tradeId: trade.id, kind: "TRANSFER_IN", amountG: 1000n } }), 1);
});

test("TC-11 worker anchors the canonical trade hash on Anvil and reconciles a lost receipt", async () => {
  const tests = execFileSync("forge", ["inspect", "src/TradeAnchor.sol:TradeAnchor", "abi", "--json"], { cwd: contracts });
  const abi = JSON.parse(tests.toString());
  const bytecode = execFileSync("forge", ["inspect", "src/TradeAnchor.sol:TradeAnchor", "bytecode"], { cwd: contracts }).toString().trim();
  const account = privateKeyToAccount(process.env.ANCHOR_PRIVATE_KEY);
  const transport = http(process.env.ANCHOR_RPC_URL);
  const chain = createPublicClient({ transport });
  const wallet = createWalletClient({ account, transport });
  assert.equal(await chain.getChainId(), 31337);
  const anvil = createTestClient({ mode: "anvil", transport });
  await anvil.setBalance({ address: account.address, value: parseEther("10") });
  const hash = await wallet.deployContract({ abi, bytecode, args: [account.address], chain: null });
  const deployment = await chain.waitForTransactionReceipt({ hash });
  assert.equal(deployment.status, "success");
  process.env.TRADE_ANCHOR_ADDRESS = deployment.contractAddress;
  process.env.ANCHOR_DEPLOYMENT_BLOCK = deployment.blockNumber.toString();
  const { listing } = await fundedListing();
  const { body: trade } = await purchase(listing, 1000).expect(201);
  const canonical = JSON.stringify({
    amountG: "1000", buyerOrgId, id: trade.id, listingId: listing.id,
    priceInrPerKg: "12.5", sellerOrgId: listing.sellerOrgId, settledAt: trade.settledAt,
    status: "SETTLED", totalInr: "12.5",
  });
  const expectedHash = keccak256(stringToHex(canonical));
  assert.equal(trade.tradeHash, expectedHash);
  const verify = () => api.get(`/trades/${trade.id}/verify`).auth(buyerToken, { type: "bearer" }).expect(200);
  assert.deepEqual((await verify()).body, { storedHash: expectedHash, onChainHash: null, match: false });
  const runWorker = (overrides = {}) => execFileSync(process.execPath, ["src/worker/anchor.js", "--once"], {
    cwd: path.resolve(__dirname, ".."), env: { ...process.env, ...overrides }, stdio: "pipe", timeout: 60_000,
  });
  runWorker();
  assert.deepEqual((await verify()).body, { storedHash: expectedHash, onChainHash: expectedHash, match: true });
  const settled = await prisma.anchor.findUniqueOrThrow({ where: { tradeId: trade.id } });
  assert.equal(settled.status, "CONFIRMED");
  assert.match(settled.txHash, /^0x[0-9a-f]{64}$/);
  assert.ok(settled.blockNumber > deployment.blockNumber);

  // Emulate a process that submitted successfully and lost its last database write.
  await prisma.anchor.update({ where: { tradeId: trade.id }, data: { status: "INFLIGHT", txHash: null, blockNumber: null } });
  runWorker();
  const reconciled = await prisma.anchor.findUniqueOrThrow({ where: { tradeId: trade.id } });
  assert.equal(reconciled.status, "CONFIRMED");
  assert.equal(reconciled.txHash, settled.txHash);
  assert.equal(reconciled.blockNumber, settled.blockNumber);
  const detail = await api.get(`/trades/${trade.id}`).auth(buyerToken, { type: "bearer" }).expect(200);
  assert.equal(detail.body.explorerUrl, `https://sepolia.etherscan.io/tx/${settled.txHash}`);

  const next = await fundedListing();
  const retryTrade = (await purchase(next.listing, 1000).expect(201)).body;
  const retryId = retryTrade.id;
  const savedAnchor = () => prisma.anchor.findUniqueOrThrow({ where: { tradeId: retryId } });
  assert.throws(() => runWorker({ ANCHOR_PRIVATE_KEY: generatePrivateKey() }), { status: 1 });
  const failed = await savedAnchor();
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.attempts, 1);
  assert.ok(failed.nextAttemptAt > failed.updatedAt);
  runWorker();
  assert.equal((await savedAnchor()).attempts, 1);
  await api.post(`/admin/anchors/${retryId}/retry`).auth(adminToken, { type: "bearer" }).expect(200);
  runWorker();
  assert.equal((await savedAnchor()).status, "CONFIRMED");
  const retryDetail = await api.get(`/trades/${retryId}`).auth(buyerToken, { type: "bearer" }).expect(200);
  assert.equal(retryDetail.body.tradeHash, retryTrade.tradeHash);
  assert.equal(retryDetail.body.settledAt, retryTrade.settledAt);
  assert.equal(await prisma.ledgerEntry.count({ where: { tradeId: retryId } }), 2);
});

test("TC-12 lower cumulative meter value is flagged and issues no negative units", async () => {
  const device = await meter();
  const first = reading(device);
  await send(first).expect(200);
  await send(reading(device, { seq: 2, timestamp: first.timestamp + 10, kwh_cumulative: 50, kwh_interval: 0.1 })).expect(422);
  const stored = await readings(device);
  assert.match(stored[1].flagReason, /cumulative/i);
  assert.deepEqual((await entries(device)).map(({ amountG }) => amountG), [1420n]);
});

test("TC-13 buyer calling an admin route receives 403", async () => {
  await api.get("/admin/devices").auth(buyerToken, { type: "bearer" }).expect(403);
});

test("admin factor versions follow capture time and generator reports stay scoped to its devices", async () => {
  const device = await meter();
  const other = await meter();
  const effectiveAt = now() - 7200;
  const factor = await api.post("/admin/emission-factors").auth(adminToken, { type: "bearer" }).send({
    version: "test-capture-time", kgPerKwh: "0.500", source: "Test factor",
    validFrom: new Date(effectiveAt * 1000).toISOString(), validTo: new Date((effectiveAt + 3600) * 1000).toISOString(),
  }).expect(201);
  assert.equal(factor.body.kgPerKwh, "0.5");
  const factors = await api.get("/admin/emission-factors").auth(adminToken, { type: "bearer" }).expect(200);
  assert.equal(factors.body[0].version, factor.body.version);
  const capture = effectiveAt + 30;
  await send(reading(device, { timestamp: capture })).expect(200);
  await send(reading(other, { timestamp: capture, kwh_interval: 3 })).expect(200);
  const [mint] = await entries(device);
  assert.deepEqual([mint.amountG, mint.factorVersion], [1000n, factor.body.version]);
  const generation = await api.get("/generator/generation?days=1").auth(device.token, { type: "bearer" }).expect(200);
  assert.deepEqual(generation.body, [{ hour: new Date(Math.floor(capture / 3600) * 3_600_000).toISOString(), kwh: 2 }]);

  const forecast = {
    deviceId: device.id, horizonStart: new Date(), horizonHours: 1, modelName: "test", modelVersion: "1",
    energyKwh: [3], avgKwh: 3, co2AvoidedKg: 2.13, unitsExpectedG: 2130n,
    maeKwh: 0.1, rmseKwh: 0.2, baselineMaeKwh: 0.3, baselineRmseKwh: 0.4, confidence: 0.9,
  };
  await prisma.forecast.createMany({ data: [
    { ...forecast, generatedAt: new Date(0) }, { ...forecast, modelVersion: "2", generatedAt: new Date(1) },
    { ...forecast, deviceId: other.id },
  ] });
  const latest = await api.get("/generator/forecast").auth(device.token, { type: "bearer" }).expect(200);
  assert.equal(latest.body.length, 1);
  assert.deepEqual([latest.body[0].deviceId, latest.body[0].modelVersion, latest.body[0].unitsExpectedG], [device.id, "2", "2130"]);
});

test("concurrent listing reservations cannot spend the same available grams twice", async () => {
  const device = await meter();
  await send(reading(device)).expect(200);
  const reserve = () => api.post("/listings").auth(device.token, { type: "bearer" }).send({ amountG: 1000, priceInrPerKg: "12.5" });
  const results = await Promise.all([reserve(), reserve()]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
  const { body } = await summary(device);
  assert.deepEqual([body.availableG, body.reservedG], ["420", "1000"]);
});

test("demo seed posts three weeks per meter and can be rerun without duplicate ledger or trades", async () => {
  const runSeed = () => execFileSync(process.execPath, ["scripts/seed.js"], { stdio: "pipe", timeout: 60_000 });
  runSeed();
  const generator = await login("generator@demo.in");
  const demoBuyer = await login("buyer@demo.in");
  const demoAdmin = await login("admin@demo.in");
  await api.get("/auth/me").auth(demoAdmin, { type: "bearer" }).expect(200);
  const mine = await api.get("/trades/mine").auth(demoBuyer, { type: "bearer" }).expect(200);
  assert.ok(mine.body.length >= 2);
  assert.ok(mine.body.every((trade) => trade.status === "SETTLED" && trade.anchor.status === "PENDING"));
  const owned = await api.get("/listings/mine").auth(generator, { type: "bearer" }).expect(200);
  assert.ok(owned.body.length >= 1);
  const sellerOrgId = owned.body[0].sellerOrgId;
  const readingCount = () => prisma.reading.count({ where: { device: { organisationId: sellerOrgId } } });
  const ledgerCount = () => prisma.ledgerEntry.count({ where: { organisationId: sellerOrgId } });
  const count = await ledgerCount();
  assert.ok(count > 21);
  assert.equal(await readingCount(), 21 * 24);
  runSeed();
  assert.equal(await ledgerCount(), count);
  assert.equal(await readingCount(), 21 * 24);
  const after = await api.get("/trades/mine").auth(demoBuyer, { type: "bearer" }).expect(200);
  assert.equal(after.body.length, mine.body.length);
});


test("large ledger sums and small prices keep their exact decimal representation", async () => {
  const device = await meter();
  const amountG = 9223372036854775807n;
  await prisma.ledgerEntry.createMany({ data: [1, 2].map(() => ({
    organisationId: device.orgId, kind: "MINT", bucket: "AVAILABLE", amountG,
  })) });
  const projection = await summary(device);
  assert.equal(projection.body.availableG, "18446744073709551614");
  const token = device.token;
  const listing = (await api.post("/listings").auth(token, { type: "bearer" }).send({ amountG: 1, priceInrPerKg: ".000001" }).expect(201)).body;
  const trade = (await purchase(listing, 1).expect(201)).body;
  assert.equal(trade.totalInr, "0.000000001");
});

test("admin reports redact device secrets and a revoked meter can no longer submit", async () => {
  const device = await meter();
  await send(reading(device, { kwh_interval: 400 })).expect(422);
  const adminGet = (route) => api.get(route).auth(adminToken, { type: "bearer" }).expect(200);
  const { body: flagged } = await adminGet("/admin/readings/flagged");
  assert.ok(flagged.some((item) => item.deviceId === device.id && item.flagReason && !item.signature));
  const { body: devices } = await adminGet("/admin/devices");
  const record = devices.find((item) => item.deviceId === device.id);
  assert.equal(record.organisationId, device.orgId);
  assert.equal(record.encryptedSecret, undefined);
  assert.equal(record.secretIv, undefined);
  const { body: overview } = await adminGet("/admin/overview");
  assert.ok(overview.flaggedReadings >= 1);
  assert.deepEqual(Object.keys(overview.anchorHealth).sort(), ["confirmed", "failed", "inflight", "pending", "walletBalanceEth"]);
  await adminGet("/admin/trades");
  await api.post(`/admin/devices/${device.id}/revoke`).auth(adminToken, { type: "bearer" }).expect(200);
  await send(reading(device, { seq: 2 })).expect(401);
  assert.equal((await readings(device)).length, 1);
});
