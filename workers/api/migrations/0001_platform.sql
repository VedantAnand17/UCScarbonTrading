CREATE TABLE Organisation (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE User (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  name TEXT NOT NULL,
  roles TEXT NOT NULL CHECK (json_valid(roles) AND json_type(roles) = 'array'),
  organisationId TEXT NOT NULL REFERENCES Organisation(id),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX user_org ON User(organisationId);

CREATE TABLE Device (
  deviceId TEXT PRIMARY KEY NOT NULL,
  encryptedSecret TEXT NOT NULL,
  secretIv TEXT NOT NULL,
  label TEXT,
  projectId INTEGER,
  generatorAddress TEXT,
  ratedCapacityKw REAL NOT NULL,
  lastSeq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  organisationId TEXT NOT NULL REFERENCES Organisation(id)
) STRICT;
CREATE INDEX device_org ON Device(organisationId);

CREATE TABLE Reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deviceId TEXT NOT NULL REFERENCES Device(deviceId),
  seq INTEGER NOT NULL,
  deviceTimestamp INTEGER NOT NULL,
  receivedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kwhCumulative REAL NOT NULL,
  kwhInterval REAL NOT NULL,
  validated INTEGER NOT NULL CHECK (validated IN (0, 1)),
  flagReason TEXT,
  signature TEXT NOT NULL,
  creditsAmount INTEGER,
  mintTxHash TEXT,
  mintStatus TEXT,
  mintError TEXT,
  UNIQUE (deviceId, seq)
) STRICT;
CREATE INDEX reading_device_capture ON Reading(deviceId, deviceTimestamp, seq);
CREATE INDEX reading_validated_received ON Reading(validated, receivedAt);
CREATE INDEX reading_device_trusted ON Reading(deviceId, seq DESC) WHERE validated = 1;

CREATE TABLE EmissionFactor (
  id TEXT PRIMARY KEY NOT NULL,
  version TEXT NOT NULL UNIQUE,
  kgPerKwh TEXT NOT NULL,
  source TEXT NOT NULL,
  validFrom TEXT NOT NULL,
  validTo TEXT CHECK (validTo IS NULL OR validTo > validFrom)
) STRICT;
CREATE INDEX factor_effective ON EmissionFactor(validFrom DESC, version DESC);
INSERT INTO EmissionFactor (id, version, kgPerKwh, source, validFrom)
VALUES ('factor_cea_v20', 'CEA-v20', '0.71', 'Central Electricity Authority CO2 Baseline Database v20', '1970-01-01T00:00:00.000Z');

CREATE TABLE Listing (
  id TEXT PRIMARY KEY NOT NULL,
  sellerOrgId TEXT NOT NULL REFERENCES Organisation(id),
  amountG INTEGER NOT NULL CHECK (amountG > 0),
  remainingG INTEGER NOT NULL CHECK (remainingG BETWEEN 0 AND amountG),
  priceInrPerKg TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LISTED' CHECK (status IN ('LISTED', 'CANCELLED', 'FILLED')),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX listing_seller_created ON Listing(sellerOrgId, createdAt);
CREATE INDEX listing_status_created ON Listing(status, createdAt);

CREATE TABLE Trade (
  id TEXT PRIMARY KEY NOT NULL,
  listingId TEXT NOT NULL REFERENCES Listing(id),
  buyerOrgId TEXT NOT NULL REFERENCES Organisation(id),
  sellerOrgId TEXT NOT NULL REFERENCES Organisation(id),
  amountG INTEGER NOT NULL CHECK (amountG > 0),
  priceInrPerKg TEXT NOT NULL,
  totalInr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SETTLED' CHECK (status IN ('SETTLED', 'ANCHOR_PENDING', 'ANCHORED', 'ANCHOR_FAILED')),
  tradeHash TEXT NOT NULL,
  settledAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX trade_listing ON Trade(listingId);
CREATE INDEX trade_buyer_settled ON Trade(buyerOrgId, settledAt);
CREATE INDEX trade_seller_settled ON Trade(sellerOrgId, settledAt);

CREATE TABLE LedgerEntry (
  id TEXT PRIMARY KEY NOT NULL,
  organisationId TEXT NOT NULL REFERENCES Organisation(id),
  kind TEXT NOT NULL CHECK (kind IN ('MINT', 'RESERVE', 'RELEASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'FEE')),
  amountG INTEGER NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('AVAILABLE', 'RESERVED')),
  readingId INTEGER REFERENCES Reading(id),
  listingId TEXT REFERENCES Listing(id),
  tradeId TEXT REFERENCES Trade(id),
  factorVersion TEXT REFERENCES EmissionFactor(version),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (readingId, kind)
) STRICT, WITHOUT ROWID;
CREATE INDEX ledger_org_bucket ON LedgerEntry(organisationId, bucket);
CREATE INDEX ledger_listing ON LedgerEntry(listingId);
CREATE INDEX ledger_trade ON LedgerEntry(tradeId);
CREATE INDEX ledger_factor ON LedgerEntry(factorVersion);
-- SQLite REPLACE can bypass delete triggers, so reject both uniqueness conflicts before insertion.
CREATE TRIGGER ledger_no_replace BEFORE INSERT ON LedgerEntry
WHEN EXISTS (SELECT 1 FROM LedgerEntry WHERE id = NEW.id OR (readingId = NEW.readingId AND kind = NEW.kind))
BEGIN
  SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON LedgerEntry
BEGIN
  SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON LedgerEntry
BEGIN
  SELECT RAISE(ABORT, 'LedgerEntry is append-only');
END;

-- Summing both signed 32-bit parts separately lets a balance exceed the 64-bit entry limit.
CREATE VIEW LedgerBalance AS
SELECT organisationId, bucket, SUM(amountG / 4294967296) AS high, SUM(amountG % 4294967296) AS low
FROM LedgerEntry GROUP BY organisationId, bucket;

CREATE TABLE Anchor (
  id TEXT PRIMARY KEY NOT NULL,
  tradeId TEXT NOT NULL UNIQUE REFERENCES Trade(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INFLIGHT', 'CONFIRMED', 'FAILED')),
  txHash TEXT,
  blockNumber INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastError TEXT,
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  nextAttemptAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  firstBlock INTEGER,
  leaseId TEXT
) STRICT;
CREATE INDEX anchor_due ON Anchor(nextAttemptAt, id) WHERE status IN ('PENDING', 'INFLIGHT', 'FAILED');

CREATE TABLE Forecast (
  id TEXT PRIMARY KEY NOT NULL,
  deviceId TEXT NOT NULL REFERENCES Device(deviceId),
  generatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  horizonStart TEXT NOT NULL,
  horizonHours INTEGER NOT NULL CHECK (horizonHours > 0),
  modelName TEXT NOT NULL,
  modelVersion TEXT NOT NULL,
  energyKwh TEXT NOT NULL CHECK (json_valid(energyKwh) AND json_type(energyKwh) = 'array'),
  avgKwh REAL NOT NULL,
  co2AvoidedKg REAL NOT NULL,
  unitsExpectedG INTEGER NOT NULL CHECK (unitsExpectedG >= 0),
  maeKwh REAL NOT NULL,
  rmseKwh REAL NOT NULL,
  baselineMaeKwh REAL NOT NULL,
  baselineRmseKwh REAL NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1)
) STRICT;
CREATE INDEX forecast_latest ON Forecast(deviceId, generatedAt DESC, id DESC);
