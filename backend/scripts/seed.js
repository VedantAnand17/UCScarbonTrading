require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/lib/prisma");
const { canonicalPayload, encryptSecret, generateDeviceSecret, hmacHex } = require("../src/lib/crypto");
const { mintGrams } = require("../src/lib/quantities");
const { createListing, settlePurchase } = require("../src/lib/marketplace");

const plants = [
  { organisationId: "demo_north_solar", name: "North Solar", deviceId: "dev_demo_north", ratedCapacityKw: 55 },
  { organisationId: "demo_lake_solar", name: "Lakeside Renewables", deviceId: "dev_demo_lake", ratedCapacityKw: 38 },
];
const buyerId = "demo_buyer";
const hourSeconds = 3600;
const samples = 21 * 24;

function randomFraction(key) {
  const mixed = Math.imul(key ^ (key >>> 16), 0x45d9f3b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 2 ** 32;
}

function solarKwh(plant, plantIndex, timestamp) {
  const localSeconds = timestamp + 5.5 * hourSeconds;
  const day = Math.floor(localSeconds / 86400);
  const hour = (localSeconds % 86400) / hourSeconds;
  if (hour < 6 || hour > 18) return 0;
  const daylight = Math.sin(Math.PI * (hour - 6) / 12);
  const cloudCover = 0.55 + 0.45 * randomFraction(day * 13 + plantIndex);
  const noise = 0.9 + 0.2 * randomFraction(Math.floor(localSeconds / hourSeconds) + plantIndex * 1009);
  return Number((plant.ratedCapacityKw * daylight * cloudCover * noise).toFixed(6));
}

async function addReadings(tx, plant, plantIndex, start, factors) {
  const secret = generateDeviceSecret();
  await tx.device.create({ data: {
    deviceId: plant.deviceId, label: `${plant.name} meter`, ratedCapacityKw: plant.ratedCapacityKw,
    organisationId: plant.organisationId, lastSeq: samples, createdAt: new Date(start * 1000), ...encryptSecret(secret),
  } });
  let cumulative = 1000;
  const data = Array.from({ length: samples }, (_item, index) => {
    const timestamp = start + index * hourSeconds;
    const interval = index === 0 ? 0 : solarKwh(plant, plantIndex, timestamp);
    cumulative = Number((cumulative + interval).toFixed(6));
    const seq = index + 1;
    const signature = hmacHex(canonicalPayload({
      device_id: plant.deviceId, seq, timestamp, kwh_cumulative: cumulative, kwh_interval: interval,
    }), secret);
    return {
      deviceId: plant.deviceId, seq, deviceTimestamp: timestamp, receivedAt: new Date(timestamp * 1000),
      kwhCumulative: cumulative, kwhInterval: interval, validated: true, signature,
    };
  });
  const readings = await tx.reading.createManyAndReturn({ data });
  await tx.ledgerEntry.createMany({ data: readings.filter((reading) => reading.kwhInterval > 0).map((reading) => {
    const capture = new Date(reading.deviceTimestamp * 1000);
    const factor = factors.find(({ validFrom, validTo }) => validFrom <= capture && (validTo === null || capture < validTo));
    if (!factor) throw new Error(`No emission factor is available for ${capture.toISOString()}`);
    return {
      organisationId: plant.organisationId, kind: "MINT", bucket: "AVAILABLE", readingId: reading.id,
      amountG: mintGrams(reading.kwhInterval, factor.kgPerKwh), factorVersion: factor.version, createdAt: reading.receivedAt,
    };
  }) });
}

async function seed() {
  const passwordHash = await bcrypt.hash("demo1234", 12);
  const seeded = await prisma.$transaction(async (tx) => {
    // The fixed organisation ID marks the completed seed transaction. Serialize concurrent seed invocations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(88170021)`;
    if (await tx.organisation.findUnique({ where: { id: plants[0].organisationId } })) return false;
    await tx.organisation.createMany({ data: [
      ...plants.map(({ organisationId: id, name }) => ({ id, name })), { id: buyerId, name: "Demo Industrial Buyer" },
    ] });
    const accounts = [
      { email: "generator@demo.in", name: "North Solar Operator", roles: ["GENERATOR"], organisationId: plants[0].organisationId },
      { email: "generator2@demo.in", name: "Lakeside Solar Operator", roles: ["GENERATOR"], organisationId: plants[1].organisationId },
      { email: "buyer@demo.in", name: "Demo Buyer", roles: ["BUYER"], organisationId: buyerId },
      { email: "admin@demo.in", name: "Demo Administrator", roles: ["ADMIN"], organisationId: buyerId },
    ];
    await tx.user.createMany({ data: accounts.map((account) => ({ ...account, passwordHash })) });

    const end = Math.floor(Date.now() / (hourSeconds * 1000)) * hourSeconds;
    const start = end - (samples - 1) * hourSeconds;
    const factors = await tx.emissionFactor.findMany({ orderBy: [{ validFrom: "desc" }, { version: "desc" }] });
    for (const [index, plant] of plants.entries()) await addReadings(tx, plant, index, start, factors);

    const north = plants[0].organisationId;
    const lake = plants[1].organisationId;
    const first = await createListing(tx, north, 300_000n, "12.5");
    const second = await createListing(tx, lake, 200_000n, "14");
    const third = await createListing(tx, north, 150_000n, "13.25");
    await settlePurchase(tx, first.id, buyerId, 100_000n);
    await settlePurchase(tx, second.id, buyerId, 200_000n);
    await settlePurchase(tx, third.id, buyerId, 80_000n);
    return true;
  }, { timeout: 60_000 });
  console.log(seeded ? "Seeded three demo organisations, two meters, 1008 readings, and three settled trades." : "Demo data is already seeded.");
}

seed().catch((err) => {
  console.error(err.code || err.message);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
