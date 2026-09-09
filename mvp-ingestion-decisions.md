# MVP Architectural Decisions — ESP32 → Credits → Dashboard

**Status: DECIDED.** Final answers are recorded inline under each decision below
(look for **Decision:** lines) and summarized at the end.

Context: `prd.md` describes a Postgres-authoritative ledger with an HMAC-authenticated
ESP32 ingestion pipeline and async chain anchoring. `ARCHITECTURE.md` describes what's
actually built — a purely on-chain ERC1155 system (mint/list/buy/retire) with **no
ingestion layer at all**. Nothing currently connects an ESP32 to credit minting. That
mismatch is why decision 1 below has to be made before anything else.

These are the open decisions for the narrow MVP path: a reading comes off an ESP32,
becomes credits, and those credits show up in a user's dashboard.

---

## 1. Where do credits live — chain or DB?

The existing contracts (`CarbonCredit.issue`) mint on-chain, owner-only. The PRD wants
DB-authoritative minting with async anchoring instead. Pick one for the MVP, don't try
to build both:

- **On-chain mint** (fits current contracts): ESP32 reading → backend computes credits
  → backend (holding the owner key) calls `CarbonCredit.issue(projectId,
  generatorAddress, amount)` directly. Simple, reuses everything already built, but
  every mint costs gas and blocks on confirmation — bad if readings arrive every
  5 minutes.
- **DB-ledger + batch anchor** (fits the PRD): mint into a Postgres `CreditLedgerEntry`
  immediately, anchor a hash/batch to chain later, use `CarbonCredit.issue` only for
  periodic batch settlement. More infrastructure, but matches the PRD's full rationale
  (§1.3: DB-authoritative settlement, async anchoring) and avoids gas-spamming per
  reading.

**Decision: on-chain mint.** Backend (holding the owner key) calls `CarbonCredit.issue`
directly. Dashboard reuses the existing `usePortfolio` / `useUserBalances` read hooks
unmodified (see decision 5).

---

## 2. Who maps an ESP32 device to a user/project?

Need a `Device → owner_user_id → projectId (on-chain)` binding established at
provisioning time (PRD §2, §6: devices are not users, never issue them JWTs).

**Decision: reassignable.** A device is bound to a project/user at provisioning time,
but an admin can rebind it later (e.g. device swapped to a new install). This lives in
a DB table only — off-chain metadata the contracts don't need to know about — and
should carry effective-dated history (not just current binding), since past readings
must still resolve to whichever project/user owned the device when the reading was
taken.

---

## 3. Ingestion trust boundary

The PRD's HMAC design (§4.2) is solid and should be reused as-is even in a trimmed
MVP — don't cut corners here just because it's a demo:

- Per-device provisioned secret, HMAC-SHA256 over a canonical payload serialization.
- Constant-time signature comparison (`crypto.timingSafeEqual`).
- Monotonically increasing `seq` per device, rejecting any `seq` ≤ last accepted
  (doubles as replay protection and duplicate suppression).

**Decision: as written, no changes.**

---

## 4. kWh → credits conversion — when and how often?

- **Per-reading** (every 5 min) vs. **periodic aggregation** (e.g. daily) before
  minting. Per-reading is conceptually simpler but produces many tiny ledger
  entries — and if minting is on-chain (decision 1), many tiny transactions.

**Decision: per-reading, on-chain.** Every validated reading (~every 5 min per device)
triggers its own `CarbonCredit.issue` call immediately. Confirmed deliberately despite
the gas/tx-volume tradeoff — acceptable for MVP/testnet scale. If device count or
network costs grow, revisit batching before mainnet.

- The emission factor (0.710 kgCO₂/kWh, CEA) must be a **versioned config value**
  referenced by every mint, never hardcoded in business logic — cheap to do correctly
  from day one, expensive to retrofit once ledger entries exist without a recorded
  factor version.

---

## 5. What does the dashboard actually read from?

Decide the read path now, since it depends directly on decision 1:

- If credits mint on-chain (per batch), the dashboard keeps using the existing
  `usePortfolio` / `useUserBalances` hooks (`src/hooks/`) unchanged — this is the
  strongest argument for choosing on-chain-mint-per-batch as the MVP path.
- If credits live in a DB ledger, the dashboard needs a new balance API and hooks that
  read a materialized `balance` column — one that is only ever updated inside the same
  transaction as the ledger-entry insert (never independently), to avoid ledger drift.

**Decision: on-chain (follows decision 1).** Dashboard keeps `usePortfolio` /
`useUserBalances` unchanged; no new balance API needed.

---

## 6. Validation before minting

The PRD (§4.2 step 5) specifies bounds checking before a reading is allowed to mint
credits:

- Reject negative `kwh_interval` outright.
- Reject readings that exceed `rated_capacity_kw × interval_hours × safety_margin`
  (a 5kW panel can't produce 40kWh in 5 minutes).
- Reject or flag non-monotonic cumulative readings (possible meter reset).

For the MVP: at minimum enforce negative-delta rejection and a plausibility spike
check, so a flaky or misconfigured device can't mint bogus credits. Full anomaly
flagging + admin review queue can be a v2 hardening pass.

**Decision: minimum.** Reject negative `kwh_interval` and enforce the plausibility
spike check (`rated_capacity_kw × interval_hours × safety_margin`). No non-monotonic
detection or admin review queue for v1 — deferred to v2.

---

## 7. Idempotency / duplicate submission

A unique constraint on `(device_id, seq)` is required regardless of which path (1) is
chosen — ESP32s will retry sends on network failure, and a duplicate POST must be a
safe no-op rather than a double-mint.

**Decision: as written, no changes.**

---

## 8. Backend key custody for minting

`CarbonCredit.issue` is `onlyOwner`. If minting happens on-chain, the backend needs to
hold or call through the owner key on the device's behalf:

- **Hot key held directly by the backend** — simplest for MVP, acceptable risk on
  testnet.
- **Queued mint requests requiring admin approval** — safer, but adds a manual step
  between "reading validated" and "credits visible," which works against fast demo
  turnaround.

**Decision: hot key in backend.** The owner private key is held by the backend
process (env var / secrets manager at boot — never committed to the repo) and used to
sign each mint tx automatically as readings validate. This is required by decision 4
(per-reading, automatic minting) — a queued/admin-approved flow would block that
cadence. Acceptable risk for MVP/testnet; revisit (e.g. isolated signing service,
rate/spend limits) before any mainnet or real-value deployment.

---

## MVP path (final, decided)

Keep ingestion + validation in the backend exactly as the PRD specifies (HMAC-SHA256,
timing-safe compare, monotonic `seq` replay protection, unique `(device_id, seq)`
constraint). A device is bound to a project/user via a reassignable, effective-dated DB
mapping. Each validated reading is minted **individually and immediately** on-chain via
`CarbonCredit.issue`, signed by an owner hot key held directly in the backend
(env var / secrets manager). Validation before minting is minimal: reject negative
`kwh_interval` and enforce a plausibility spike check; no non-monotonic detection or
admin review queue in v1. Skip the DB-ledger/anchor-worker machinery from the PRD
entirely — the chain already *is* the ledger in the deployed contracts. The dashboard
reuses the existing `usePortfolio` / `useUserBalances` read hooks unchanged.

Known tradeoff accepted for MVP: per-reading on-chain minting means a transaction
roughly every 5 minutes per device, and an automated hot key with no approval gate.
Both are fine at testnet/demo scale; revisit batching and key custody before scaling
device count or moving to mainnet.
