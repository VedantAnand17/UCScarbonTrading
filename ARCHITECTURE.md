# UCS Carbon Trading — Architecture

Snapshot of everything built so far, as of 2026-08-20. This is a full-stack, on-chain
carbon credit issuance + trading + retirement platform: Solidity contracts (Foundry)
on one side, a React/wagmi frontend on the other, glued together by a codegen sync
script and a deployed-address registry.

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Sepolia (chain 11155111)                  │
│                                                                       │
│  ProjectRegistry ──owns stats──▶ CarbonCredit (ERC1155) ◀──buys/sells│
│        ▲                              │      ▲                Marketplace
│        │ registers                    │mint/ │retire                │
│        │                              │burn  │                      │
│      (owner)                          ▼      │                      │
│                                   OffsetRouter ── buys via ──▶ Marketplace
└─────────────────────────────────────────────────────────────────────┘
                    ▲ ABI + address sync (scripts/sync-contracts.mjs)
                    │
┌─────────────────────────────────────────────────────────────────────┐
│                     React frontend (Vite + wagmi v2 + viem)          │
│  Dashboard / Projects / Marketplace / Portfolio / Admin (owner-gated)│
└─────────────────────────────────────────────────────────────────────┘
```

## 1. Smart contracts (`contracts/`, Foundry + OpenZeppelin v5)

Four contracts, all Solidity `^0.8.24`, `Ownable`-gated where an admin role is
needed. 7 Foundry tests exist in `test/CarbonPlatform.t.sol` and `test/OffsetRouter.t.sol`.

### `ProjectRegistry.sol`
On-chain curated list of carbon offset projects. This is the source of truth for
project metadata and cumulative issuance/retirement counters.

- `Project` struct: id, developer, name, location, methodology (e.g. "VCS VM0007
  REDD+"), vintageYear, totalIssued, totalRetired, metadataURI, active.
- Owner-only: `registerProject(...)`, `updateProject(id, metadataURI, active)`,
  `setCreditToken(address)` — wires the one `CarbonCredit` contract allowed to
  push stats back.
- `CarbonCredit`-only (via `onlyCreditToken` modifier): `recordIssuance`,
  `recordRetirement` — keeps `totalIssued`/`totalRetired` in sync as credits
  move.
- Project id is monotonically increasing and **doubles as the ERC1155 tokenId**
  in `CarbonCredit` — one registry entry = one token type.

### `CarbonCredit.sol` (ERC1155 + ERC1155Supply + Ownable)
The credit token itself. 1 token unit = 1 tCO₂e for a given project/tokenId.

- `issue(projectId, to, amount)` — owner-only mint; requires the project be
  `active` in the registry; calls back into `ProjectRegistry.recordIssuance`.
- `retire(projectId, amount, beneficiary, reason)` — **anyone holding credits**
  can burn them to permanently claim an offset. Not owner-gated — this is the
  end-user action.
  - Burns the tokens, calls `recordRetirement`, then writes a `Retirement`
    receipt (id, project, retiredBy, beneficiary, amount, timestamp, reason)
    into on-chain storage, indexed three ways: by retiring user, by
    beneficiary (only if different from caller — supports router-style
    retire-on-behalf-of), and by project.
  - `getRetirement`, `retirementsOf(user)`, `retirementsForBeneficiary(user)`,
    `retirementsByProject(id)` are the read-side API. No off-chain indexer is
    used yet — these on-chain arrays double as a mini index (see §4 on
    scaling limits).
- `uri(tokenId)` is overridden to proxy to `ProjectRegistry.getProject(id).metadataURI`
  — no separate metadata storage on the token itself.

### `Marketplace.sol` (Ownable + ReentrancyGuard + IERC1155Receiver)
A minimal on-chain order book, ETH-denominated, generic over any ERC1155 token
(used here for `CarbonCredit`).

- `createListing(token, tokenId, quantity, pricePerUnit)` — seller must have
  already called `setApprovalForAll(marketplace, true)` on the token; credits
  are pulled into escrow immediately.
- `buy(id, quantity) payable` — `msg.value` must equal `quantity * pricePerUnit`
  exactly. Effects (state updates) happen before interactions (external calls)
  — standard checks-effects-interactions plus `nonReentrant`. Fee is skimmed
  (`feeBps`, hard-capped at 1000 = 10% via `MAX_FEE_BPS`) and sent to
  `treasury`; remainder goes to the seller.
- `cancelListing(id)` — refunds remaining escrowed credits to the seller.
- Active listing bookkeeping: `_activeListingIds` array + `_activeIndex`
  mapping (index+1, so 0 means "not present") gives O(1) add/remove via
  swap-and-pop — avoids the classic O(n) array-deletion gas trap.
- Implements `IERC1155Receiver` so it can legally custody credits during
  escrow.

### `OffsetRouter.sol` (IERC1155Receiver + ReentrancyGuard)
The one-transaction "I want to offset N tonnes, don't make me think about
which listing" entrypoint. Never holds credits at rest — every purchase is
retired in the same call.

- `offset(listingIds[], quantities[], beneficiary, reason) payable` — caller
  (typically the frontend, see `useOffsetRoute`) computes the fill route
  off-chain by sorting active listings ascending by price, then this function
  walks the arrays: buys `quantities[i]` from `listingIds[i]` via
  `Marketplace.buy`, immediately retires the same amount via
  `CarbonCredit.retire(..., beneficiary, reason)`, and records one retirement
  id per listing filled.
- Validates `listingIds.length == quantities.length`, rejects zero-address
  beneficiary and empty orders, reverts `WrongToken` if a listing isn't the
  configured `CarbonCredit`, and refunds any `msg.value` overpayment at the
  end.
- Split into `offset` → `_fillAndRetire` → `_fillOne` purely to stay under
  Solidity's stack-depth limit without enabling `via-ir`.
- Emits one aggregate `Offset` event (buyer, beneficiary, totalTonnes,
  totalSpent, retirementIds[], reason) in addition to the per-listing
  `ListingFilled`/`CreditsRetired` events underneath.

### Deployment (`script/Deploy.s.sol`)
Single Foundry script: deploys `ProjectRegistry` → `CarbonCredit` → `Marketplace`
→ `OffsetRouter`, wires `ProjectRegistry.setCreditToken`, optionally (`SEED=1`)
registers 2 demo projects and issues 1500 tonnes to the deployer, then writes
`contracts/deployments/<chainId>.json` with all four addresses. Deployer wallet
becomes both `Ownable` owner (verifier/minter) and default fee treasury.

**Currently live on Sepolia** (chainId 11155111) — addresses in `README.md`,
owner/treasury `0x4db8...eb772e`, fee 250 bps (2.5%), seeded with 2 projects +
1500 tonnes.

## 2. Frontend (`frontend/`, Vite + React + TypeScript)

Stack: `wagmi` v2 + `viem` for chain interaction, `@rainbow-me/rainbowkit` for
wallet connect UI, `@tanstack/react-query` (via wagmi) for caching/refetch,
`react-router-dom` for routing, Tailwind for styling.

### Contract wiring (`src/contracts/`, `src/lib/wagmi.ts`)
- `scripts/sync-contracts.mjs` is the bridge from Foundry output to the
  frontend: pulls ABIs out of `contracts/out/<Name>.sol/<Name>.json` into
  `src/contracts/<Name>.abi.json`, and merges every
  `contracts/deployments/<chainId>.json` into one `addresses.json` keyed by
  chainId. Run manually via `npm run sync:contracts`.
- `src/contracts/index.ts` re-exports the ABIs and exposes
  `getAddresses(chainId)`, which checks `VITE_*` env overrides first (useful
  for pointing at a chain not yet baked into `addresses.json`) before falling
  back to the synced `addresses.json`.
- `src/lib/wagmi.ts` configures RainbowKit for `sepolia`, `mainnet`, and local
  `foundry` (anvil) chains.

### Data hooks (`src/hooks/`) — all thin wrappers over wagmi's `useReadContract`/`useReadContracts`
- `useDeployment` — resolves the active chain's contract addresses + connected
  account; every other hook depends on this.
- `useIsOwner` — compares connected wallet to `CarbonCredit.owner()`; gates the
  Admin page.
- `useProjects` — `useAllProjectIds` + `useAllProjects` (batched multicall via
  `useReadContracts` over every project id).
- `useListings` — `useActiveListingIds` + `useActiveListings` (same batched
  pattern for marketplace listings).
- `useOffsetRoute` — **client-side greedy router**: given a target tonnage,
  sorts active listings ascending by price and fills until the target is met
  or listings run out (`shortfall`), computing `totalCost`/`avgPrice`. This is
  the plan later submitted to `OffsetRouter.offset`.
- `useMarketApproval` — reads/writes `setApprovalForAll` for the marketplace
  on the `CarbonCredit` ERC1155 (required once before listing).
- `usePortfolio` — `useUserBalances` (per-project balanceOf, batched) and
  `useUserRetirements` (union of `retirementsOf` + `retirementsForBeneficiary`,
  deduped, then batched `getRetirement` detail fetch).
- `useRetirements` — `useRecentRetirements(limit)`: walks
  `nextRetirementId` backwards to get the N most recent retirements globally,
  without an indexer/subgraph — cheap but doesn't scale indefinitely (see §4).

### Pages (`src/pages/`)
- **Dashboard** — aggregate stats (project count, tonnes issued/retired,
  active listings) + the offset widget + live retirement feed.
- **Projects** / **ProjectDetail** — browse registry entries; detail page
  shows methodology, vintage, metadata URI, developer, issuance/retirement
  counters.
- **Marketplace** — live listing table + buy flow.
- **Portfolio** — holdings per project, list-for-sale flow (with the
  approval gate from `useMarketApproval`), retire flow, and the user's
  retirement certificates.
- **Admin** — owner-gated (via `useIsOwner`); register projects, issue
  credits.

### Shared components (`src/components/`)
- `OffsetWidget` — the "type tonnes → get a route → retire in one click"
  hero flow; wraps `useOffsetRoute` + a `TxButton` calling
  `OffsetRouter.offset`.
- `RetirementFeed` — renders `useRecentRetirements` as a live list.
- `TxButton` — generic wagmi `writeContract` + `useWaitForTransactionReceipt`
  button (pending/mining/success/error states) reused across all write flows.
- `ConnectGate` — gates children behind wallet connection.
- `NotDeployed` — shown when `getAddresses(chainId)` returns nothing (wrong
  network).
- `Layout` — nav shell + RainbowKit connect button.
- `EmptyState` — generic empty-list placeholder.

## 3. How it fits together end to end

1. Owner deploys contracts (Foundry script), optionally seeds demo data.
2. `npm run sync:contracts` pulls fresh ABIs/addresses into the frontend.
3. Owner uses **Admin** to register projects and `issue` credits to
   developers.
4. Developers/holders list credits on **Marketplace** (`createListing`, after
   one-time `setApprovalForAll`).
5. Buyers either fill listings directly (**Marketplace** page → `buy`), or use
   the **Dashboard**'s offset widget, which computes a route with
   `useOffsetRoute` and submits it to `OffsetRouter.offset` — buying across
   the cheapest listings and retiring atomically in one tx, with a retirement
   certificate minted per listing filled.
6. **Portfolio** shows holdings, lets users retire directly (no marketplace
   hop needed if you already hold credits), and lists all certificates
   (`retirementsOf` ∪ `retirementsForBeneficiary`).
7. **RetirementFeed** / Dashboard shows the tail of `nextRetirementId` as a
   live activity feed.

## 4. Explicit non-goals / known limits (per README "Security notes")

- Single `Ownable` owner is both verifier and minter — no multisig/timelock
  yet, no `AccessControl` role separation (registrar vs. verifier vs. minter).
- No off-chain indexer/subgraph — `useRecentRetirements` and portfolio lookups
  rely on on-chain array reads and batched multicalls, which won't scale past
  a moderate number of retirements/projects.
- No oracle-backed price discovery — marketplace is a plain limit order book.
- No KYC/AML hooks.
- Contracts are unaudited; README explicitly flags this as a reference
  implementation, not production-ready for real value.
