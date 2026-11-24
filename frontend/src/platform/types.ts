export type Role = "GENERATOR" | "BUYER" | "ADMIN";
export type Measurement = number | string;
export type User = {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  organisationId: string;
};
export type Session = { token: string; user: User };

export type DeviceStatus = {
  deviceId: string;
  label: string | null;
  status: string;
  lastSeenAt?: string | null;
};

export type GeneratorSummary = {
  todayKwh: number;
  co2AvoidedTodayKg: number;
  availableG: Measurement;
  reservedG: Measurement;
  devices: DeviceStatus[];
};

export type Generation = { hour: string; kwh: number };
export type Forecast = {
  id: string | number;
  deviceId: string;
  generatedAt: string;
  horizonStart: string;
  horizonHours: number;
  modelName: string;
  modelVersion: string;
  energyKwh: number[];
  avgKwh: Measurement;
  co2AvoidedKg: Measurement;
  unitsExpectedG: Measurement;
  maeKwh: Measurement | null;
  rmseKwh: Measurement | null;
  baselineMaeKwh: Measurement | null;
  baselineRmseKwh: Measurement | null;
  confidence?: Measurement | null;
};

export type OpenListing = {
  id: string;
  sellerOrgName: string;
  remainingG: Measurement;
  priceInrPerKg: Measurement;
  createdAt: string;
};
export type Listing = Omit<OpenListing, "sellerOrgName"> & {
  sellerOrgId: string;
  amountG: Measurement;
  status: "LISTED" | "CANCELLED" | "FILLED";
};
export type TradeStatusValue =
  | "LISTED" | "RESERVED" | "SETTLED" | "ANCHOR_PENDING" | "ANCHORED" | "ANCHOR_FAILED" | "CANCELLED";
export type Anchor = {
  status: "PENDING" | "INFLIGHT" | "CONFIRMED" | "FAILED";
  txHash?: string | null;
  blockNumber?: Measurement | null;
  attempts: number;
  lastError?: string | null;
  updatedAt: string;
};
export type Trade = {
  id: string;
  listingId: string;
  buyerOrgId: string;
  sellerOrgId: string;
  amountG: Measurement;
  priceInrPerKg: Measurement;
  totalInr: Measurement;
  status: TradeStatusValue;
  tradeHash: string;
  settledAt: string;
  anchor?: Anchor | null;
  explorerUrl?: string | null;
};
export type Verification = { storedHash: string; onChainHash: string; match: boolean };

export type AdminOverview = {
  devices: number;
  flaggedReadings: number;
  trades: number;
  anchorHealth: {
    pending: number;
    inflight: number;
    confirmed: number;
    failed: number;
    walletBalanceEth: Measurement | null;
  };
};
export type AdminDevice = DeviceStatus & {
  organisationId: string | null;
  ratedCapacityKw: number;
  createdAt: string;
};
export type ProvisionDevice = { label: string; organisationId: string; ratedCapacityKw: number };
export type DeviceCredentials = { device_id: string; device_secret: string; warning?: string };
export type FlaggedReading = {
  id: string | number;
  deviceId: string;
  seq: number;
  receivedAt: string;
  kwhInterval: number;
  flagReason: string | null;
};
export type EmissionFactor = {
  id: string | number;
  version: string;
  kgPerKwh: Measurement;
  source: string;
  validFrom: string;
  validTo?: string | null;
};
