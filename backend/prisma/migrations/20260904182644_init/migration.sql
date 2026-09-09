-- CreateTable
CREATE TABLE "Device" (
    "deviceId" TEXT NOT NULL PRIMARY KEY,
    "encryptedSecret" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "label" TEXT,
    "projectId" INTEGER,
    "generatorAddress" TEXT,
    "ratedCapacityKw" REAL NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "deviceTimestamp" INTEGER NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kwhCumulative" REAL NOT NULL,
    "kwhInterval" REAL NOT NULL,
    "validated" BOOLEAN NOT NULL,
    "flagReason" TEXT,
    "signature" TEXT NOT NULL,
    CONSTRAINT "Reading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Reading_deviceId_seq_key" ON "Reading"("deviceId", "seq");
