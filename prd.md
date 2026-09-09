# Engineering Context & PRD v2
## Blockchain-Anchored Carbon Credit Trading Platform for Distributed Renewable Energy Generators

> **How to use this document:** This is the complete context for the system. If you are an AI coding agent picking up a task, read Sections 1–4 to understand *why* the system is shaped this way, then jump to the section for your module. Section 5 (Invariants) and Section 14 (Anti-Patterns) are binding on every module — violating them breaks the system even if your module's tests pass.

> **MVP v1 scope note:** This document describes the target/full design (DB-authoritative
> credit ledger, async on-chain anchoring of trades). The actual MVP v1 path is narrower
> and diverges from Sections 4.2, 4.4, 6, and 13 in specific, deliberate ways — see
> `mvp-ingestion-decisions.md` for the full rationale. Summary of what changes for v1:
>
> - **Credits mint directly on-chain**, not into a `CreditLedgerEntry` in Postgres. The
>   backend calls the existing `CarbonCredit.issue(projectId, generatorAddress, amount)`
>   (owner-only) per validated reading, using a backend-held hot key. There is no
>   DB-ledger/anchor-worker machinery in v1 — the chain already *is* the ledger for
>   credits. (Trade anchoring via `CarbonTradeAnchor`, Section 4.4, is unaffected and
>   still applies to the marketplace/trading side.)
> - **Minting is per-reading, not batched** — every validated reading (~every 5 min per
>   device) triggers its own mint transaction, accepted as a known MVP tradeoff (more
>   gas/tx volume) rather than the aggregation this PRD assumes elsewhere.
> - **Dashboard reads balances from chain** via the existing `usePortfolio` /
>   `useUserBalances` hooks, not from a materialized Postgres `balance` column.
> - **Validation before minting is minimal**: reject negative `kwh_interval` and enforce
>   the plausibility spike check (Section 4.2 step 5, bullets 1–2 only). Non-monotonic
>   cumulative detection and the admin anomaly review queue (step 5 bullet 3, Section
>   4.6 admin "Anomaly queue") are deferred to v2.
> - **Device→project binding is reassignable**, not fixed at provisioning — an admin can
>   rebind a device later; the mapping table carries effective-dated history so past
>   readings still resolve to the correct owner.
> - Everything else — HMAC ingestion (Section 4.2 steps 1–4), replay protection,
>   `(device_id, seq)` idempotency, dual-path auth (Section 2) — applies unchanged.

---

## 1. Domain Background

### 1.1 What a carbon credit actually is here

A carbon credit represents one metric tonne of CO₂-equivalent (tCO₂e) that was **not** emitted. In this system, credits are created by *avoided emissions*: when a distributed renewable generator produces 1 kWh, that kWh displaces 1 kWh that would otherwise have come from the grid. The grid has an average carbon intensity. Therefore clean generation avoids `kWh × grid_emission_factor` kilograms of CO₂.

This is the **generation-based methodology**. It is deliberately chosen over the alternative (consumption/offset-based accounting, where you measure a facility's emissions and offset them) because:

- Generation is directly, physically measurable at the meter. Consumption-offset accounting requires baseline assumptions that are contestable.
- It makes the credit provably traceable to a hardware reading, which is the whole point of putting an IoT layer under this.
- It matches how India's CEA publishes grid emission factors, so the numbers are defensible against a real published standard.

**Emission factor:** 0.710 kgCO₂/kWh (CEA, India grid average). This means:

```
avoided_kg_CO2  = kWh_generated × 0.710
credits (tCO2e) = avoided_kg_CO2 / 1000
```

So 1,000 kWh generated ≈ 0.71 tCO₂e ≈ 0.71 credits.

**Critical:** the factor is a *versioned config value*, never a hardcoded literal in business logic. CEA republishes it. Every `CreditLedgerEntry` must record which factor version was used at mint time, or the ledger becomes unauditable the moment the factor changes.

### 1.2 Why blockchain at all

The honest answer — and the one to give in a viva — is **tamper-evidence, not decentralization**. The platform operator (you) controls the database. A buyer purchasing credits has to trust that the operator didn't retroactively edit trade history, double-sell a credit lot, or fabricate generation data.

Anchoring a cryptographic hash of each settled trade to a public chain means: the operator *can* still alter the database, but the alteration becomes detectable, because the recomputed hash will no longer match the one immortalized on Sepolia at a known block height and timestamp.

That is the entire value proposition of the chain layer. It is an **append-only notarization service**. It is explicitly **not**:
- a settlement engine,
- a source of truth for balances,
- a place where trading logic lives.

Being clear about this distinction is a strength of the design, not a weakness. Systems that put the order book on-chain pay enormous latency and gas costs for guarantees the use case doesn't need.

### 1.3 Why the database is authoritative

Ethereum Sepolia block times are ~12 seconds, with variable confirmation latency and possible reorgs, gas price spikes, and RPC provider failures. If a user's purchase flow waited on chain confirmation, the UX would be unusable and any RPC outage would take the marketplace offline.

Therefore: **settlement completes in Postgres, synchronously, atomically. Anchoring happens afterward, asynchronously, with retries.** A trade that is `SETTLED` but not yet `ANCHORED` is a completed, valid, final trade. The anchor is a proof that arrives later.

---

## 2. Actors

| Actor | Auth mechanism | Capabilities |
|---|---|---|
| **Metering Device** (ESP32) | HMAC-SHA256 with provisioned per-device secret | Submit signed generation readings. Nothing else. Cannot read data, cannot trade. |
| **Generator** (user) | JWT, role `GENERATOR` | Register/claim devices, view own generation + credit balance, create listings, view own trades, view forecasts for own devices |
| **Buyer** (user) | JWT, role `BUYER` | Browse marketplace, purchase listings, view owned credits, view own trade history + anchor proofs |
| **Admin** | JWT, role `ADMIN` | Device provisioning/revocation, user management, view all trades, review anomaly-flagged readings, trigger manual re-anchor, manage emission factor versions |

A single user account may hold both `GENERATOR` and `BUYER` roles — model roles as a set, not a single enum column, or you will regret it during the demo when you want one account to do both.

**Devices are not users.** Do not issue JWTs to devices. Do not create shadow user rows for devices. The two auth paths never meet.

---

## 3. Architecture Overview

```
┌────────────────────┐
│  ESP32 + Modbus    │  reads kWh from meter/inverter
│  metering node     │
└─────────┬──────────┘
          │ signed payload (HMAC-SHA256 + nonce)
          ▼
┌─────────────────────────────────────────────────┐
│  Node.js / Express Backend                      │
│                                                 │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Ingestion     │  │ Marketplace + Trading  │  │
│  │ - HMAC verify │  │ - listings             │  │
│  │ - validation  │  │ - matching             │  │
│  │ - credit mint │  │ - ATOMIC settlement    │  │
│  └───────┬───────┘  └──────────┬─────────────┘  │
│          │                     │                │
│          ▼                     ▼                │
│  ┌─────────────────────────────────────────┐    │
│  │  PostgreSQL (Prisma)  — SOURCE OF TRUTH │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                            │
│          ┌─────────▼──────────┐                 │
│          │  Anchor Worker     │ async, retrying │
│          └─────────┬──────────┘                 │
└────────────────────┼────────────────────────────┘
                     │                      ▲
                     ▼                      │ forecasts
       ┌──────────────────────┐   ┌─────────┴──────────┐
       │ Ethereum Sepolia     │   │ Python ML module   │
       │ Anchor contract      │   │ (batch forecasts)  │
       └──────────────────────┘   └────────────────────┘
                     ▲
                     │  read tx hashes for proof links
       ┌─────────────┴────────────────────────────────┐
       │  React Dashboard (Generator / Buyer / Admin) │
       └──────────────────────────────────────────────┘
```

**Data flow, end to end:**
1. ESP32 reads kWh over Modbus from the meter.
2. ESP32 signs `{device_id, seq, timestamp, kWh}` with HMAC-SHA256 and POSTs it.
3. Backend verifies signature, checks nonce/sequence for replay, validates the reading is physically plausible.
4. Valid reading is stored, then converted to credits and minted into the generator's ledger.
5. Generator lists credits on the marketplace.
6. Buyer purchases → backend runs an atomic settlement transaction → trade is `SETTLED`.
7. Anchor worker picks up settled-but-unanchored trades, writes a hash to the Sepolia contract, records the tx hash, marks `ANCHORED`.
8. Dashboard shows the trade with a link to the Sepolia explorer for the anchoring tx.
9. Separately, the ML module batch-forecasts future generation per device and writes results to Postgres for dashboard display.

---

## 4. Module Specifications

### 4.1 Metering Layer (ESP32 + Modbus)

**Responsibility:** Read generation data from physical meters and transmit it authenticated.

**Reading acquisition:**
- Communicate with the energy meter/inverter over Modbus RTU (RS-485) or Modbus TCP depending on hardware.
- Read the cumulative energy register (kWh). Prefer transmitting **both** the cumulative reading and the computed interval delta — cumulative is self-healing after missed transmissions, delta is convenient for minting.
- Reporting interval: configurable, default every 5 minutes. This is a design tradeoff between demo responsiveness and data volume; state your chosen interval and be prepared to justify it.

**Payload:**
```json
{
  "device_id": "dev_7f3a2b",
  "seq": 10482,
  "timestamp": 1756000000,
  "kwh_cumulative": 15420.75,
  "kwh_interval": 0.42,
  "signature": "<hex HMAC-SHA256>"
}
```

**Signature:** HMAC-SHA256 over a canonical serialization of all fields except `signature` itself, keyed by the device's provisioned secret. Canonical means: fixed field order, no whitespace ambiguity. Define this precisely once and implement it identically on firmware and backend — mismatched canonicalization is the single most common source of "my HMAC doesn't verify" bugs.

**Replay protection:** monotonically increasing `seq` per device. Backend rejects any `seq` ≤ the highest already accepted for that device. This also gives you free duplicate-suppression on network retries.

**Firmware architecture note:** The device must not block its Modbus polling loop on synchronous network calls. Use a state machine / non-blocking pattern with an outbound buffer, so that network latency or backend downtime does not cause missed meter reads. Buffer unsent readings locally and flush on reconnect.

**Offline behavior:** If the backend is unreachable, buffer readings (bounded ring buffer) and transmit on recovery. Because readings carry their own timestamps and sequence numbers, late arrival is fine — but the backend must accept out-of-wall-clock-order arrivals as long as `seq` is still increasing.

---

### 4.2 Backend — Ingestion Pipeline

**Endpoint:** `POST /api/v1/ingest/reading` (device-authenticated, HMAC)

**Processing order (do not reorder — each step assumes the previous passed):**

1. **Parse & schema-validate** the payload. Reject malformed early with 400.
2. **Look up device** by `device_id`. If unknown, revoked, or inactive → 401. Do not leak which.
3. **Verify HMAC** using the device's stored secret. Use a **constant-time comparison** (`crypto.timingSafeEqual`). Fail → 401.
4. **Replay check:** `seq` must exceed the device's `last_seq`. Fail → 409 Conflict (not an error the device should retry identically).
5. **Plausibility validation:**
   - `kwh_interval` ≥ 0 (generation cannot be negative).
   - `kwh_interval` ≤ `device.rated_capacity_kw × interval_hours × safety_margin`. A 5 kW panel cannot produce 40 kWh in five minutes.
   - `kwh_cumulative` must be ≥ previous cumulative (monotonic, absent a documented meter reset).
   - `timestamp` within an acceptable skew window of server time (e.g. ±24h to allow buffered offline readings, but reject far-future).
   - Optional: solar-specific sanity (near-zero generation at local night) — flag, don't hard-reject, since this is a demo-fragile rule.
6. **Persist reading** with `validated = true/false` and a `flag_reason` if anomalous. Anomalous readings are stored but do **not** mint credits; they surface in the admin anomaly queue.
7. **Mint credits** (validated readings only): compute `credits = kwh_interval × factor / 1000`, create a `CreditLedgerEntry` referencing the source reading id and the emission factor version. Update `device.last_seq`.

Steps 6 and 7 happen in a single DB transaction so a reading can never exist without its corresponding credit entry (or vice versa).

**Idempotency:** the unique constraint on `(device_id, seq)` is your idempotency key. A duplicate POST hits the constraint and is a no-op success from the device's perspective — return 200/409 consistently and document which.

**Rate limiting:** per-device rate limit on this endpoint. A compromised or malfunctioning device should not be able to flood ingestion.

---

### 4.3 Backend — Trading & Settlement Engine

This is the most correctness-critical module in the system. Everything here exists to prevent one failure: **the same credit being sold twice.**

#### 4.3.1 State machine

```
                  ┌──────────┐
                  │  LISTED  │ ◄── generator creates listing;
                  └────┬─────┘     credits moved to "reserved" for this listing
                       │
          buyer order matches listing
                       │
                       ▼
                  ┌──────────┐
                  │ MATCHED  │  buyer identified, amount+price fixed,
                  └────┬─────┘  credits locked. Transient — should be brief.
                       │
       atomic DB transaction: transfer ownership,
       debit seller reserved, credit buyer balance
                       │
                       ▼
                  ┌──────────┐
                  │ SETTLED  │  ◄── TRADE IS FINAL HERE. Terminal for
                  └────┬─────┘      business purposes.
                       │
       async anchor worker writes hash to Sepolia
                       │
                       ▼
                  ┌──────────┐
                  │ ANCHORED │  proof exists on-chain; tx hash stored
                  └──────────┘
```

**Cancellation paths:** `LISTED → CANCELLED` (generator withdraws, credits un-reserved). `MATCHED → FAILED` only if settlement itself fails (release the lock, return credits to `LISTED` or `CANCELLED`). There is **no path out of `SETTLED`.** A trade that needs reversing is corrected by a new compensating trade, never by mutating history — mutating history is exactly what the anchoring layer exists to make detectable.

#### 4.3.2 Settlement atomicity — the hard requirement

Settlement must be a single database transaction with row-level locking on the listing and the relevant ledger rows:

```
BEGIN;
  SELECT ... FROM listings WHERE id = $1 FOR UPDATE;   -- lock the listing row
  -- re-verify status is still MATCHED/LISTED and amount still available
  -- debit seller's reserved balance
  -- credit buyer's balance
  -- insert Trade row with status SETTLED, settled_at = now()
COMMIT;
```

Two concurrent buyers hitting the same listing must serialize: one succeeds, the other finds the listing already consumed and fails cleanly with a 409. **Re-verify state *after* acquiring the lock** — checking availability before locking is a classic TOCTOU race and will produce a double-sell under concurrency.

Use either explicit `FOR UPDATE` row locks or `SERIALIZABLE` isolation with retry-on-serialization-failure. Pick one, apply it consistently, and be able to explain the choice.

**Test this.** Write a concurrency test that fires N simultaneous purchase requests at a listing with capacity for one, and asserts exactly one `SETTLED` trade exists. This test is the single most persuasive artifact you can show an evaluator who asks "how do you know it's correct?"

#### 4.3.3 Matching policy

Simplest defensible option: **direct purchase against a listing** (buyer picks a listing, buys some or all of it). A full continuous double-auction order book is unnecessary scope. If partial fills are supported, decide upfront whether a partially-filled listing stays `LISTED` with reduced quantity (recommended) or splits into child listings.

Document whichever you choose. An evaluator will ask.

---

### 4.4 Blockchain Anchoring Layer

#### 4.4.1 Contract design

Keep it minimal. The contract's job is to accept a hash and emit an event, permanently.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CarbonTradeAnchor {
    address public immutable owner;

    event TradeAnchored(
        bytes32 indexed tradeHash,
        uint256 indexed tradeId,
        uint256 timestamp
    );

    // optional: batch anchoring to amortize gas
    event BatchAnchored(
        bytes32 indexed merkleRoot,
        uint256 tradeCount,
        uint256 timestamp
    );

    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() { owner = msg.sender; }

    function anchorTrade(bytes32 tradeHash, uint256 tradeId) external onlyOwner {
        emit TradeAnchored(tradeHash, tradeId, block.timestamp);
    }

    function anchorBatch(bytes32 merkleRoot, uint256 tradeCount) external onlyOwner {
        emit BatchAnchored(merkleRoot, tradeCount, block.timestamp);
    }
}
```

**Design notes:**
- **Events, not storage.** Event logs are dramatically cheaper than `SSTORE` and are equally immutable and verifiable. You do not need to read anchors back on-chain; you read them from the explorer or via RPC log queries. Anyone can independently verify.
- **`onlyOwner`** because the anchoring key is the platform's, and a public anchor function would let anyone spam junk hashes into your event stream.
- **Batching is the correct upgrade path** if gas/rate becomes an issue: hash N trades into a Merkle root, anchor the root, store each trade's Merkle proof in Postgres. Verification remains fully independent. Mention this in the report as a scalability answer even if you implement single-trade anchoring.

#### 4.4.2 What gets hashed

Define a canonical trade digest and never change it silently:

```
tradeHash = keccak256(
  abi.encodePacked(
    tradeId, listingId, sellerId, buyerId,
    creditAmount, pricePerCredit, settledAtUnix,
    emissionFactorVersion
  )
)
```

Store the exact preimage fields in Postgres so the hash is independently recomputable years later. **A hash whose preimage you cannot reconstruct proves nothing.** This is the most commonly botched part of anchoring designs — get it right and say so in the report.

#### 4.4.3 Anchor worker

- Polls (or is queued) for trades with `status = SETTLED AND anchor_status IN (PENDING, FAILED)`.
- Marks `anchor_status = IN_FLIGHT` before submitting, so a second worker instance doesn't double-submit.
- Submits the tx, records `anchor_tx_hash` immediately on submission.
- Waits for N confirmations (1–2 is fine on a testnet), then sets `status = ANCHORED`, `anchor_status = CONFIRMED`, records block number.
- **Failure handling:** exponential backoff with a retry cap. After the cap, set `anchor_status = FAILED_PERMANENT` and surface it in the admin dashboard for manual re-anchor. **Never roll back the settlement.**
- **Idempotency:** if the worker crashes after submitting but before recording, the stored `IN_FLIGHT` state plus `tradeId` in the contract call lets you detect and reconcile a duplicate rather than blindly resubmitting.

**Operational reality to acknowledge in the report:** the anchoring key needs Sepolia ETH, and a faucet-funded key running dry is a realistic failure mode. Monitor balance; degrade gracefully (queue grows, trades stay `SETTLED` and valid) rather than crashing.

---

### 4.5 ML Forecasting Module

**Purpose:** Predict future generation per device, which translates directly to predicted future credit supply. Useful to generators (when will I have credits to sell?) and to the marketplace (supply visibility).

**Data:** Historical `Reading` time series per device. Naturally seasonal — daily cycle (solar noon peak, zero at night) plus annual/weather-driven variation.

**Recommended approach — start simple and defensible:**

1. **Baseline:** seasonal naive (tomorrow's hourly profile = same hour last week's average). Always implement this. It is your benchmark; a fancy model that doesn't beat seasonal naive is a fancy model you shouldn't ship.
2. **Main model:** something that handles daily seasonality explicitly — SARIMA, exponential smoothing with seasonal terms, or gradient-boosted regression on engineered features (hour-of-day, day-of-year, lagged generation, rolling means, and weather covariates if you fetch them).
3. **Only if justified:** an LSTM/sequence model. Be ready to show it beats the simpler model on held-out data, or it's decoration.

**Evaluation:** hold out the most recent window (never random split — this is a time series; random splits leak future into past). Report MAE and RMSE in kWh against the seasonal-naive baseline. **Showing the baseline comparison is what makes this look like engineering rather than a tutorial copy-paste.**

**Integration:** batch job on a schedule (e.g. nightly), writing `ForecastResult` rows to Postgres. The Express backend just reads them. Do not build a live inference service — the forecast horizon is days, the data updates every few minutes; batch is correct and simpler to defend.

**Cold start:** a newly registered device has no history. Fall back to a capacity-scaled regional average profile and label the forecast as low-confidence in the UI.

---

### 4.6 Frontend (React)

#### Shared
- Auth: login, register, role-aware routing and nav.
- Global trade-status component rendering the four-state progress (`LISTED → MATCHED → SETTLED → ANCHORED`) with the Sepolia explorer link once anchored. **This component is the visual centerpiece of your demo** — it is the one place where the whole architectural thesis (DB-final, chain-eventual) is visible at a glance. Make it good.

#### Generator views
- **Device list:** each device with online/offline status, last-seen timestamp, current-day generation.
- **Generation history:** time-series chart, selectable range, per device or aggregate.
- **Credit balance:** available / reserved (in active listings) / sold-lifetime. The available-vs-reserved distinction matters and shows you thought about the locking model.
- **Create listing:** amount + price, validated against available balance.
- **My listings:** active, with cancel action; and historical.
- **Forecast:** predicted generation and resulting credits for the coming period, with the confidence caveat.

#### Buyer views
- **Marketplace:** browse listings, filter/sort by price, amount, seller, and (nice touch) generation source type.
- **Purchase flow:** review → confirm → live status as it moves through settlement to anchoring.
- **Portfolio:** owned credits, acquisition history.
- **Trade history:** each with anchor proof link and the recomputable hash shown.

#### Admin views
- **Device registry:** provision, view, revoke. Secret shown exactly once at provisioning.
- **Anomaly queue:** readings flagged during validation, with reason and approve/reject actions.
- **All trades:** system-wide, filterable by state; highlight anything stuck in `SETTLED` unanchored past a threshold.
- **Anchor health:** worker status, pending queue depth, anchoring wallet balance, manual re-anchor trigger.
- **Emission factor management:** view versions, effective dates.

---

## 5. System Invariants

These must hold at all times. If any module can violate one, that module is wrong.

1. **Conservation:** total credits minted = credits held by all users + credits reserved in listings + credits retired. Nothing appears or disappears.
2. **Traceability:** every credit traces to one or more validated readings; every reading traces to an authenticated device.
3. **No double-sell:** a credit unit is in exactly one of {available, reserved, sold} at any instant.
4. **Settlement finality:** `SETTLED` is never reversed, and never depends on chain state.
5. **Anchor honesty:** for every `ANCHORED` trade, the stored preimage fields recompute to the anchored hash. If they don't, that's a detected tampering — which is the system working as designed.
6. **Auth separation:** no device ever holds a JWT; no user ever authenticates via device HMAC.
7. **Factor versioning:** every ledger entry records the emission factor version used.
8. **Idempotency:** ingestion and anchoring can both be safely retried without duplicating effects.

---

## 6. Data Model

```
User            id, email, password_hash, name, org, roles[], created_at
Device          id, owner_user_id, name, secret_hash, rated_capacity_kw,
                location, status(ACTIVE|REVOKED), last_seq, last_seen_at,
                meter_type, created_at
Reading         id, device_id, seq, device_timestamp, received_at,
                kwh_cumulative, kwh_interval, validated, flag_reason,
                signature  -- UNIQUE(device_id, seq)
EmissionFactor  id, version, value_kg_per_kwh, source, effective_from
CreditLedgerEntry id, owner_user_id, amount_tco2e, entry_type(MINT|TRANSFER|RESERVE|RELEASE|RETIRE),
                source_reading_id?, related_trade_id?, emission_factor_id,
                created_at
Listing         id, seller_id, amount_total, amount_remaining, price_per_credit,
                status(LISTED|PARTIALLY_FILLED|FILLED|CANCELLED), created_at
Trade           id, listing_id, buyer_id, seller_id, amount, price_per_credit,
                total_price, status(MATCHED|SETTLED|FAILED|ANCHORED),
                settled_at, trade_hash, anchor_status(PENDING|IN_FLIGHT|CONFIRMED|FAILED_PERMANENT),
                anchor_tx_hash, anchor_block_number, anchor_attempts,
                emission_factor_version  -- preimage fields must be immutable post-settlement
ForecastResult  id, device_id, generated_at, horizon_hours, model_version,
                predicted_series(jsonb), confidence_label, baseline_mae
AuditLog        id, actor_type, actor_id, action, target, metadata, created_at
```

Ledger entries are **append-only**. Balances are derived (or maintained as a materialized column updated only inside the same transaction as the entry insert). Never let a balance be updatable independently of a ledger entry — that's how ledgers drift.

---

## 7. API Surface (representative)

**Device (HMAC auth)**
```
POST   /api/v1/ingest/reading
```

**Auth**
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me
```

**Generator**
```
GET    /api/v1/devices                     own devices
POST   /api/v1/devices                     claim/register
GET    /api/v1/devices/:id/readings        paginated, range-filterable
GET    /api/v1/devices/:id/forecast
GET    /api/v1/credits/balance
GET    /api/v1/credits/ledger              paginated
POST   /api/v1/listings
GET    /api/v1/listings/mine
DELETE /api/v1/listings/:id                cancel
```

**Marketplace / Buyer**
```
GET    /api/v1/marketplace/listings        filter, sort, paginate
POST   /api/v1/trades                      { listingId, amount } → settle
GET    /api/v1/trades/mine
GET    /api/v1/trades/:id                  incl. anchor status + tx hash
GET    /api/v1/trades/:id/verification     preimage fields + expected hash
```

**Admin**
```
POST   /api/v1/admin/devices/provision     returns secret ONCE
POST   /api/v1/admin/devices/:id/revoke
GET    /api/v1/admin/readings/flagged
POST   /api/v1/admin/readings/:id/resolve
GET    /api/v1/admin/trades
POST   /api/v1/admin/trades/:id/reanchor
GET    /api/v1/admin/anchor/health
GET    /api/v1/admin/emission-factors
POST   /api/v1/admin/emission-factors
```

**Conventions:** versioned prefix; consistent error envelope `{ error: { code, message, details? } }`; cursor or offset pagination applied consistently; 409 for state conflicts (already sold, replayed seq), 422 for validation, 401/403 distinguished properly.

The `/verification` endpoint is worth building explicitly — it lets anyone recompute the hash and compare it against the on-chain event. It turns "we use blockchain" from a claim into a demonstrable property.

---

## 8. Security Model

**Threats and mitigations:**

| Threat | Mitigation |
|---|---|
| Forged meter readings (fake generation → free credits) | Per-device HMAC-SHA256; secrets never transmitted; constant-time comparison |
| Replay of a valid reading | Monotonic per-device `seq`, unique constraint `(device_id, seq)` |
| Physically compromised device reporting inflated values | Plausibility bounds vs rated capacity; anomaly flagging + admin review; no credits minted from flagged readings |
| Double-sell under concurrency | Row-level locking / serializable isolation, re-verify after lock, concurrency test |
| Operator tampering with trade history | On-chain anchoring of recomputable trade hashes |
| Credential stuffing / token theft | Bcrypt/argon2 password hashing, short-lived access tokens + refresh rotation, RBAC enforced server-side on every route |
| Privilege escalation via client-side role checks | Never trust the client; authorize on the server for every request. Frontend role gating is UX only. |
| Ingestion flooding | Per-device rate limiting |
| Secret leakage from DB dump | Store device secrets hashed/encrypted at rest; display plaintext exactly once at provisioning |

**Explicitly out of scope (say so rather than pretending otherwise):** real-money payment rails, KYC, formal carbon-registry accreditation, mainnet deployment, and physical meter tamper-proofing. Naming your scope boundaries confidently is better than being caught at them.

---

## 9. Failure Modes & Expected Behavior

| Failure | Expected system behavior |
|---|---|
| Backend down, device generating | Device buffers locally, flushes on reconnect; no data loss, no duplicate credits (seq dedupes) |
| Sepolia RPC down | Settlements continue normally; anchor queue grows; trades remain valid at `SETTLED`; worker retries with backoff |
| Anchoring wallet out of testnet ETH | Same as above, plus admin dashboard alert |
| Two buyers race for one listing | Exactly one `SETTLED`; the other gets a clean 409 |
| Anchor worker crashes mid-submit | `IN_FLIGHT` state prevents blind resubmission; reconcile against chain before retrying |
| Meter reset (cumulative drops to zero) | Detected as monotonicity violation → flagged for admin, not silently minted or silently dropped |
| Clock skew on device | Timestamp skew window; `seq` is the authoritative ordering, not the timestamp |
| ML module unavailable | Dashboard degrades gracefully — forecasts show as unavailable; nothing else is affected |

---

## 10. Testing Requirements

**Must exist (these are what convince an evaluator):**
1. **Concurrency test** — N simultaneous purchases of a single-capacity listing → exactly one settlement. The headline test.
2. **HMAC test suite** — valid signature accepted; tampered payload rejected; replayed `seq` rejected; unknown device rejected.
3. **Ledger invariant test** — after a randomized sequence of mints, listings, cancellations, and trades, assert conservation holds.
4. **Anchor idempotency test** — worker interrupted and restarted produces exactly one anchor per trade.
5. **Hash recomputation test** — stored preimage fields recompute to the stored `trade_hash`.
6. **ML baseline comparison** — model MAE/RMSE vs seasonal naive on a held-out recent window.

---

## 11. Build Order

Sequenced so that each phase produces something demonstrable:

1. **Foundation** — Prisma schema, migrations, auth (JWT + RBAC), user registration.
2. **Ingestion** — device provisioning, HMAC verification, reading validation, credit minting. Test with a simulated device script before touching firmware.
3. **Ledger & marketplace** — balances, listings, purchase flow, atomic settlement + concurrency test.
4. **Anchoring** — deploy contract to Sepolia, build worker, wire status through to `ANCHORED`, add `/verification`.
5. **Frontend** — auth → generator dashboard → marketplace → trade status component → admin.
6. **Hardware** — ESP32 Modbus read, HMAC signing, non-blocking transmit with buffering.
7. **ML** — baseline, main model, evaluation, batch job, dashboard integration.
8. **Hardening** — rate limits, audit log, admin tooling, seed/demo data script.

**Build a device simulator early.** A script that emits correctly-signed readings on a schedule unblocks the entire backend and frontend from hardware availability, and doubles as a reliable demo driver when the physical board misbehaves on eval day.

---

## 12. Demo Considerations

- **Seed script** producing realistic multi-week generation history — you cannot demo forecasting or charts against three hours of data.
- **Deterministic demo path:** register → device streams → credits accrue → list → buy → watch state advance to `ANCHORED` → click through to Sepolia explorer → recompute hash via `/verification`.
- **The explorer click-through is the money shot.** A live, public, third-party page displaying your trade's hash is far more convincing than any slide.
- **Pre-fund the anchoring wallet** well before the eval, and have a pre-anchored trade ready in case the network is slow when you present.
- **Have the concurrency test runnable live.** "Let me show you what happens when two people buy the same credits simultaneously" is a strong moment.

---

## 13. Settled Decisions — Do Not Re-litigate

| Decision | Rationale |
|---|---|
| PostgreSQL, not a document store | Relational integrity and transactional locking are the core requirement; a ledger with atomic multi-row settlement is exactly what relational DBs are for |
| Generation-based credit methodology | Physically measurable at the meter, traceable to hardware, matches CEA published factors |
| CEA factor 0.710 kgCO₂/kWh, versioned config | Real published standard; versioning preserves auditability across updates |
| Dual-path auth: HMAC devices / JWT users | Devices and users have fundamentally different trust models and capabilities |
| DB-authoritative settlement, async anchoring | Chain latency and reliability are unacceptable in a synchronous purchase path; tamper-evidence doesn't require on-chain settlement |
| Sepolia testnet | Mainnet cost is unjustifiable for an academic system; the cryptographic properties demonstrated are identical |
| Events over storage in the contract | Orders of magnitude cheaper, equally immutable and independently verifiable |
| `LISTED → MATCHED → SETTLED → ANCHORED` | Separates business finality from proof finality — the central architectural insight of the system |

---

## 14. Anti-Patterns — Do Not Do These

- ❌ Making any user-facing flow wait on a blockchain confirmation.
- ❌ Rolling back or invalidating a `SETTLED` trade because anchoring failed.
- ❌ Reading balances from chain state. The chain stores proofs, not balances.
- ❌ Hardcoding `0.710` anywhere in business logic.
- ❌ Checking listing availability *before* acquiring the row lock.
- ❌ Issuing JWTs to devices, or creating user rows to represent devices.
- ❌ Storing device secrets in plaintext, or returning them on any endpoint after provisioning.
- ❌ Mutating `Trade` preimage fields after settlement — it silently invalidates the anchor.
- ❌ Enforcing authorization only in the React app.
- ❌ Non-constant-time signature comparison.
- ❌ Blocking the ESP32 Modbus polling loop on a synchronous HTTP call.
- ❌ Random train/test split on time-series forecasting data.
- ❌ Deriving balances from ad-hoc updates rather than from the append-only ledger.

---

## 15. Glossary

- **tCO₂e** — tonnes of CO₂ equivalent; the unit a carbon credit is denominated in.
- **Emission factor** — kg CO₂ emitted per kWh of grid electricity; the multiplier converting clean generation into avoided emissions.
- **CEA** — Central Electricity Authority (India), publisher of the grid emission factor used here.
- **Anchoring** — writing a cryptographic hash of an off-chain record to a public blockchain so later tampering becomes detectable.
- **Preimage** — the original data that was hashed; must be retained for a hash to prove anything.
- **Modbus** — industrial serial/TCP protocol used to read registers from meters and inverters.
- **HMAC** — keyed hash used to authenticate a message and prove it came from a holder of the shared secret.
- **TOCTOU** — time-of-check-to-time-of-use; the race condition class that naive availability checks fall into.
- **Merkle root** — single hash committing to many records, enabling batched anchoring with per-record proofs.