import type { AdminDevice, EmissionFactor, FlaggedReading, Forecast, Generation, Listing, Trade, User } from "../types";

export const hour = 3_600_000;
const currentHour = Math.floor(Date.now() / hour) * hour;
export const dateAt = (offsetHours: number) => new Date(currentHour + offsetHours * hour).toISOString();
const dayInIndia = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", dateStyle: "short" });

export const users: User[] = [
  { id: "user-generator", name: "Anika Rao", email: "generator@demo.in", roles: ["GENERATOR"], organisationId: "org-surya" },
  { id: "user-buyer", name: "Dev Shah", email: "buyer@demo.in", roles: ["BUYER"], organisationId: "org-lotus" },
  { id: "user-admin", name: "Meera Iyer", email: "admin@demo.in", roles: ["ADMIN"], organisationId: "org-ucs" },
];
export const sellers: Record<string, string> = {
  "org-surya": "Surya Solar Collective",
  "org-neel": "Neel Renewables",
};

export const devices: AdminDevice[] = [
  { deviceId: "MTR-101", label: "Surya rooftop array", organisationId: "org-surya", ratedCapacityKw: 120, status: "active", createdAt: dateAt(-720), lastSeenAt: dateAt(0) },
  { deviceId: "MTR-102", label: "Surya workshop array", organisationId: "org-surya", ratedCapacityKw: 75, status: "active", createdAt: dateAt(-700), lastSeenAt: dateAt(0) },
  { deviceId: "MTR-201", label: "Neel ground array", organisationId: "org-neel", ratedCapacityKw: 160, status: "active", createdAt: dateAt(-620), lastSeenAt: dateAt(-2) },
  { deviceId: "MTR-099", label: "Surya test meter", organisationId: "org-surya", ratedCapacityKw: 15, status: "revoked", createdAt: dateAt(-800), lastSeenAt: dateAt(-200) },
];

function solarProfile(at: number, capacity: number, modifier: number) {
  const localHour = (new Date(at).getUTCHours() + 5.5) % 24;
  if (localHour < 6 || localHour > 19) return 0;
  const clearSky = Math.sin(Math.PI * (localHour - 6) / 13) ** 1.55;
  return Number((clearSky * capacity * modifier).toFixed(2));
}

export const readings: Generation[] = Array.from({ length: 14 * 24 }, (_, i) => {
  const offset = i - 14 * 24 + 1;
  const cloud = 0.78 + 0.14 * Math.sin(i / 38) + 0.06 * Math.cos(i / 3);
  return { hour: dateAt(offset), kwh: solarProfile(currentHour + offset * hour, 195, cloud) };
});

export const todayKwh = readings
  .filter(({ hour }) => dayInIndia.format(new Date(hour)) === dayInIndia.format(new Date(currentHour)))
  .reduce((sum, reading) => sum + reading.kwh, 0);

export const forecasts: Forecast[] = devices.slice(0, 2).map((device, index) => {
  const horizonHours = 48;
  const energyKwh = Array.from({ length: horizonHours }, (_, i) =>
    solarProfile(currentHour + (i + 1) * hour, device.ratedCapacityKw, 0.82 + 0.08 * Math.sin(i / 9)),
  );
  const energy = energyKwh.reduce((sum, value) => sum + value, 0);
  return {
    id: `forecast-${device.deviceId}`, deviceId: device.deviceId, generatedAt: dateAt(0),
    horizonStart: dateAt(1), horizonHours, modelName: "Gradient Boosting", modelVersion: "v1.2",
    energyKwh, avgKwh: energy / horizonHours, co2AvoidedKg: energy * 0.71, unitsExpectedG: String(Math.floor(energy * 710)),
    maeKwh: index ? 2.14 : 3.28, rmseKwh: index ? 3.06 : 4.74,
    baselineMaeKwh: index ? 4.86 : 6.95, baselineRmseKwh: index ? 6.12 : 9.18,
  };
});

export const listings: Listing[] = [
  { id: "LST-104", sellerOrgId: "org-surya", amountG: "1500000", remainingG: "1250000", priceInrPerKg: "4.25", status: "LISTED", createdAt: dateAt(-12) },
  { id: "LST-103", sellerOrgId: "org-neel", amountG: "860000", remainingG: "860000", priceInrPerKg: "4.80", status: "LISTED", createdAt: dateAt(-26) },
  { id: "LST-102", sellerOrgId: "org-surya", amountG: "750000", remainingG: "575000", priceInrPerKg: "5.10", status: "LISTED", createdAt: dateAt(-52) },
  { id: "LST-101", sellerOrgId: "org-surya", amountG: "400000", remainingG: "0", priceInrPerKg: "4.60", status: "FILLED", createdAt: dateAt(-70) },
];

function seededTrade(index: number, listing: Listing, amountG: number, status: Trade["status"]): Trade {
  const settledAt = dateAt(-(index - 100) * 3);
  const confirmed = status === "ANCHORED";
  const failed = status === "ANCHOR_FAILED";
  const txHash = `0x${String(index).padStart(64, "b")}`;
  return {
    id: `TRD-${index}`, listingId: listing.id, buyerOrgId: "org-lotus", sellerOrgId: listing.sellerOrgId,
    amountG: String(amountG), priceInrPerKg: listing.priceInrPerKg,
    totalInr: (Number(listing.priceInrPerKg) * amountG / 1000).toFixed(2),
    status, tradeHash: `0x${String(index).padStart(64, "a")}`, settledAt,
    anchor: {
      status: confirmed ? "CONFIRMED" : failed ? "FAILED" : "PENDING",
      txHash: confirmed ? txHash : null, blockNumber: confirmed ? 9210471 + index : null,
      attempts: failed ? 3 : confirmed ? 1 : 0, lastError: failed ? "Sepolia RPC timed out after 3 attempts." : null,
      updatedAt: settledAt,
    },
    explorerUrl: confirmed ? `https://sepolia.etherscan.io/tx/${txHash}` : null,
  };
}

export const trades: Trade[] = [
  seededTrade(101, listings[0], 250_000, "ANCHORED"),
  seededTrade(102, listings[2], 175_000, "ANCHOR_FAILED"),
  seededTrade(103, listings[3], 300_000, "ANCHOR_PENDING"),
  seededTrade(104, listings[3], 100_000, "ANCHORED"),
];

export const flags: FlaggedReading[] = [
  { id: 794, deviceId: "MTR-101", seq: 801, receivedAt: dateAt(-7), kwhInterval: 213.4, flagReason: "Interval exceeds rated capacity" },
  { id: 781, deviceId: "MTR-201", seq: 682, receivedAt: dateAt(-32), kwhInterval: -0.42, flagReason: "Cumulative reading decreased" },
];

export const factors: EmissionFactor[] = [
  { id: "factor-v20", version: "CEA-v20", kgPerKwh: "0.710", source: "Central Electricity Authority", validFrom: "2025-04-01T00:00:00Z" },
  { id: "factor-v19", version: "CEA-v19", kgPerKwh: "0.716", source: "Central Electricity Authority", validFrom: "2024-04-01T00:00:00Z", validTo: "2025-04-01T00:00:00Z" },
];
