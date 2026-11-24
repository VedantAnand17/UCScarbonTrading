# Capstone build spec: ledger, trading, anchoring, dashboards

This spec is the shared contract between the backend and frontend work.
Both sides must follow it exactly so they can be built in parallel and merged.

## Architecture

- Field layer: energy meter read by an ESP32 over Modbus RTU (`firmware/`, already exists).
- Ingestion: `POST /api/v1/ingest/reading` with HMAC-SHA256, replay and plausibility checks (`backend/src/routes/ingest.js`, already exists).
- Application core (new): positive energy delta x versioned CEA emission factor (default 0.710 kgCO2/kWh, version `CEA-v20`) gives prototype carbon units, posted to an append-only ledger.
- Persistence: PostgreSQL via Prisma is the authoritative state. Balances are always projected from the ledger (sum of entries), never stored in a mutable column.
- Marketplace (new): generators list units (units move from AVAILABLE to RESERVED), buyers purchase, and settlement happens in one database transaction with row locking so no listing can oversell.
- Audit (new): an idempotent worker anchors `keccak256` of each settled trade's canonical JSON to a `TradeAnchor` contract on Ethereum Sepolia.
- Forecasting (built separately in `forecasting/`, Python): writes rows to the `Forecast` table.
- The existing on-chain ERC1155 credits, Marketplace and OffsetRouter contracts and their frontend pages stay as they are.

## Units

- 1 prototype unit = 1 kgCO2e avoided, stored as integer grams to avoid floating point (`amountG`).
- `units = floor(deltaKwh * factorKgPerKwh * 1000)` grams.

## Trade states

`LISTED -> RESERVED -> SETTLED -> ANCHOR_PENDING -> ANCHORED`, plus `CANCELLED` (listing cancelled) and `ANCHOR_FAILED` (retryable).
A listing is LISTED; a trade row is created SETTLED and moves through anchoring states.
The frontend trade status component shows the five-step progress LISTED, RESERVED, SETTLED, ANCHOR_PENDING, ANCHORED.

## Data model (Prisma, PostgreSQL)

- `Organisation { id, name, createdAt }`
- `User { id, email unique, passwordHash, name, roles String[] (GENERATOR | BUYER | ADMIN), organisationId, createdAt }`
- `Device` (existing) gains `organisationId`.
- `Reading` (existing) unchanged apart from relation to ledger entries.
- `EmissionFactor { id, version unique, kgPerKwh Decimal, source, validFrom, validTo? }`
- `LedgerEntry { id, organisationId, kind (MINT | RESERVE | RELEASE | TRANSFER_OUT | TRANSFER_IN | FEE), amountG BigInt (signed), bucket (AVAILABLE | RESERVED), readingId?, listingId?, tradeId?, factorVersion?, createdAt }` - append-only, never updated or deleted.
- `Listing { id, sellerOrgId, amountG, remainingG, priceInrPerKg Decimal, status (LISTED | CANCELLED | FILLED), createdAt }`
- `Trade { id, listingId, buyerOrgId, sellerOrgId, amountG, priceInrPerKg, totalInr, status, tradeHash, settledAt }`
- `Anchor { id, tradeId unique, status (PENDING | INFLIGHT | CONFIRMED | FAILED), txHash?, blockNumber?, attempts, lastError?, updatedAt }`
- `Forecast { id, deviceId, generatedAt, horizonStart, horizonHours, modelName, modelVersion, energyKwh Json (hourly array), avgKwh, co2AvoidedKg, unitsExpectedG BigInt, maeKwh, rmseKwh, baselineMaeKwh, baselineRmseKwh, confidence }`

## REST API (`/api/v1`, JSON, JWT bearer auth except where noted)

Auth:
- `POST /auth/login {email, password}` -> `{token, user: {id, name, email, roles, organisationId}}`
- `GET /auth/me` -> `user`

Generator (role GENERATOR):
- `GET /generator/summary` -> `{todayKwh, co2AvoidedTodayKg, availableG, reservedG, devices: [{deviceId, label, status, lastSeenAt}]}`
- `GET /generator/generation?days=14` -> `[{hour ISO, kwh}]`
- `GET /generator/forecast` -> latest `Forecast` rows for the org's devices
- `GET /listings/mine` -> listings of the caller's org
- `POST /listings {amountG, priceInrPerKg}` -> listing (409 if amount > available)
- `POST /listings/:id/cancel` -> listing

Buyer (role BUYER):
- `GET /listings` -> open listings `[{id, sellerOrgName, remainingG, priceInrPerKg, createdAt}]`
- `POST /trades {listingId, amountG}` -> trade (409 when remaining is insufficient)
- `GET /trades/mine` -> trades where caller's org is buyer or seller, each with `anchor`

Shared:
- `GET /trades/:id` -> trade with `anchor`, `tradeHash`, and an `explorerUrl` (`https://sepolia.etherscan.io/tx/<txHash>`) once anchored
- `GET /trades/:id/verify` -> `{storedHash, onChainHash, match: boolean}`

Admin (role ADMIN):
- `GET /admin/overview` -> `{devices, flaggedReadings, trades, anchorHealth: {pending, inflight, confirmed, failed, walletBalanceEth}}`
- `GET /admin/devices`, `POST /admin/devices`, `POST /admin/devices/:id/revoke` (existing device provisioning moves here)
- `GET /admin/readings/flagged`
- `GET /admin/trades`
- `GET /admin/emission-factors`, `POST /admin/emission-factors`
- `POST /admin/anchors/:tradeId/retry`

Errors are `{error: string}` with 400, 401, 403, 404, 409 or 422.

## Seed data

`npm run seed` creates three organisations (two solar generators and one buyer), one admin, users with password `demo1234`, devices, three weeks of hourly readings from a daily solar profile scaled by plant capacity with cloud cover and noise, the posted ledger entries, a few listings and settled trades.
Demo logins: `generator@demo.in`, `buyer@demo.in`, `admin@demo.in`.

## Backend contract details

- The API serializes Prisma `BigInt` and `Decimal` values as base-10 strings so grams, block numbers, and prices keep their precision.
  Gram inputs accept positive integer strings or safe JSON integers.
- `GET /trades/mine` also accepts `GENERATOR` so sellers can read their organisation's trades.
  The shared trade and verification lookups are scoped to a participant's organisation or an administrator.
- `POST /admin/devices` accepts `{label?, projectId?, generatorAddress?, ratedCapacityKw, organisationId?}` and uses the administrator's organisation when `organisationId` is omitted.
  The response preserves the provisioning fields `{device_id, device_secret, warning}`.
- `POST /admin/emission-factors` accepts `{version, kgPerKwh, source, validFrom, validTo?}` with ISO dates.
  Ingestion uses the most recent effective factor at capture time and records the version on each MINT.
- Generator energy reports use capture time in UTC, and the device's `lastSeenAt` is the most recent received reading's server timestamp.
  `GET /generator/forecast` returns one latest forecast per device that has one.
- An implausible signed reading is stored as flagged, consumes its sequence, and returns `422` with `{error}`.
  Retrying that sequence returns `409` so the existing firmware can advance its buffer.
  The `creditsAmount` in successful ingestion responses refers to the optional legacy ERC1155 mint and is `null` when it is disabled.
  Unexpected server failures return `500` with the same error shape.
- Trade hashing uses UTF-8 JSON with keys ordered `amountG`, `buyerOrgId`, `id`, `listingId`, `priceInrPerKg`, `sellerOrgId`, `settledAt`, `status`, `totalInr`.
  The hash uses `SETTLED` for status, UTC ISO format for `settledAt`, and base-10 strings for the amount and both monetary values.
  The on-chain key is `keccak256` of the UTF-8 trade ID.
- A settled trade enters the anchor queue as `PENDING`.
  Verification returns `onChainHash: null` and `match: false` until a hash is available from the configured contract.
  `GET /trades/:id` returns `explorerUrl: null` until the anchor is confirmed.
- PostgreSQL has a new migration baseline, including the default emission factor.
  The old SQLite migrations are archived in `backend/prisma/sqlite-migrations` for reference.
  Importing historical SQLite rows requires mapping each device to an organisation.
