-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('MINT', 'RESERVE', 'RELEASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'FEE');

-- CreateEnum
CREATE TYPE "LedgerBucket" AS ENUM ('AVAILABLE', 'RESERVED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('LISTED', 'CANCELLED', 'FILLED');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('SETTLED', 'ANCHOR_PENDING', 'ANCHORED', 'ANCHOR_FAILED');

-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'INFLIGHT', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" TEXT[],
    "organisationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "deviceId" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "label" TEXT,
    "projectId" INTEGER,
    "generatorAddress" TEXT,
    "ratedCapacityKw" DOUBLE PRECISION NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" SERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "deviceTimestamp" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kwhCumulative" DOUBLE PRECISION NOT NULL,
    "kwhInterval" DOUBLE PRECISION NOT NULL,
    "validated" BOOLEAN NOT NULL,
    "flagReason" TEXT,
    "signature" TEXT NOT NULL,
    "creditsAmount" INTEGER,
    "mintTxHash" TEXT,
    "mintStatus" TEXT,
    "mintError" TEXT,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissionFactor" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kgPerKwh" DECIMAL(12,9) NOT NULL,
    "source" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "EmissionFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amountG" BIGINT NOT NULL,
    "bucket" "LedgerBucket" NOT NULL,
    "readingId" INTEGER,
    "listingId" TEXT,
    "tradeId" TEXT,
    "factorVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "amountG" BIGINT NOT NULL,
    "remainingG" BIGINT NOT NULL,
    "priceInrPerKg" DECIMAL(18,6) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'LISTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "sellerOrgId" TEXT NOT NULL,
    "amountG" BIGINT NOT NULL,
    "priceInrPerKg" DECIMAL(18,6) NOT NULL,
    "totalInr" DECIMAL(38,9) NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'SETTLED',
    "tradeHash" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "blockNumber" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstBlock" BIGINT,

    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizonStart" TIMESTAMP(3) NOT NULL,
    "horizonHours" INTEGER NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "energyKwh" JSONB NOT NULL,
    "avgKwh" DOUBLE PRECISION NOT NULL,
    "co2AvoidedKg" DOUBLE PRECISION NOT NULL,
    "unitsExpectedG" BIGINT NOT NULL,
    "maeKwh" DOUBLE PRECISION NOT NULL,
    "rmseKwh" DOUBLE PRECISION NOT NULL,
    "baselineMaeKwh" DOUBLE PRECISION NOT NULL,
    "baselineRmseKwh" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE INDEX "Device_organisationId_idx" ON "Device"("organisationId");

-- CreateIndex
CREATE INDEX "Reading_deviceId_deviceTimestamp_idx" ON "Reading"("deviceId", "deviceTimestamp");

-- CreateIndex
CREATE INDEX "Reading_validated_receivedAt_idx" ON "Reading"("validated", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reading_deviceId_seq_key" ON "Reading"("deviceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "EmissionFactor_version_key" ON "EmissionFactor"("version");

-- CreateIndex
CREATE INDEX "EmissionFactor_validFrom_idx" ON "EmissionFactor"("validFrom");

-- CreateIndex
CREATE INDEX "LedgerEntry_organisationId_bucket_idx" ON "LedgerEntry"("organisationId", "bucket");

-- CreateIndex
CREATE INDEX "LedgerEntry_listingId_idx" ON "LedgerEntry"("listingId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tradeId_idx" ON "LedgerEntry"("tradeId");

-- CreateIndex
CREATE INDEX "LedgerEntry_factorVersion_idx" ON "LedgerEntry"("factorVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_readingId_kind_key" ON "LedgerEntry"("readingId", "kind");

-- CreateIndex
CREATE INDEX "Listing_sellerOrgId_createdAt_idx" ON "Listing"("sellerOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_status_createdAt_idx" ON "Listing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_listingId_idx" ON "Trade"("listingId");

-- CreateIndex
CREATE INDEX "Trade_buyerOrgId_settledAt_idx" ON "Trade"("buyerOrgId", "settledAt");

-- CreateIndex
CREATE INDEX "Trade_sellerOrgId_settledAt_idx" ON "Trade"("sellerOrgId", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_tradeId_key" ON "Anchor"("tradeId");

-- CreateIndex
CREATE INDEX "Anchor_status_nextAttemptAt_idx" ON "Anchor"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Forecast_deviceId_generatedAt_idx" ON "Forecast"("deviceId", "generatedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "Reading"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_factorVersion_fkey" FOREIGN KEY ("factorVersion") REFERENCES "EmissionFactor"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sellerOrgId_fkey" FOREIGN KEY ("sellerOrgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;
