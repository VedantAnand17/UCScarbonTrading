# UCS Carbon Trading

A full-stack, on-chain carbon trading platform:

- **Solidity contracts** (Foundry + OpenZeppelin):
  - `ProjectRegistry` — verifier-curated list of carbon offset projects
  - `CarbonCredit` — ERC1155 credits (one tokenId per project, 1 token = 1 tCO₂e) with on-chain **retirement certificates**
  - `Marketplace` — on-chain order book that accepts ETH, with configurable protocol fee to a treasury
  - `OffsetRouter` — atomic "buy across cheapest listings + retire on behalf of beneficiary" in one transaction
- **React frontend** (Vite + TypeScript + wagmi v2 + viem + RainbowKit + TanStack Query + Tailwind):
  - Offset hero widget — type tonnes, get auto-routed across cheapest listings, retire in 1 click
  - Live retirement feed
  - Marketplace with live listings and buy flow
  - Project browser + detail pages
  - Portfolio page with retire + create-listing flows + your certificates
  - Owner-gated Admin page for registering projects and issuing credits

The frontend is fully wired to the contracts and deploys to **Ethereum Sepolia** out of the box via the included Foundry deploy script.

---

## Live deployment (Sepolia, chainId 11155111)

| Contract          | Address                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ProjectRegistry` | [`0x311F2F7bF8A3b3346a6709C8e247CA9d2fEe4d39`](https://sepolia.etherscan.io/address/0x311F2F7bF8A3b3346a6709C8e247CA9d2fEe4d39) |
| `CarbonCredit`    | [`0x84aA28FFd384B6503a4A29CB998dD36DcfcDf140`](https://sepolia.etherscan.io/address/0x84aA28FFd384B6503a4A29CB998dD36DcfcDf140) |
| `Marketplace`     | [`0x9de5bD2c2E7471395f81d6164fE191f1acF63e38`](https://sepolia.etherscan.io/address/0x9de5bD2c2E7471395f81d6164fE191f1acF63e38) |
| `OffsetRouter`    | [`0x66505C0CD9f1dC02464FB1D9c2fBe6CF79E0f4D6`](https://sepolia.etherscan.io/address/0x66505C0CD9f1dC02464FB1D9c2fBe6CF79E0f4D6) |

- Owner / treasury: `0x4db8B3faF4F26c04d6E456e8D5A0c02941eb772e`
- Fee: 250 bps (2.5%)
- Seeded with 2 demo projects + 1500 tonnes of credits in the deployer wallet
- Addresses already wired into `frontend/src/contracts/addresses.json` — `npm run dev` just works

---

## Repo layout

```
contracts/              Foundry project
  src/
    ProjectRegistry.sol
    CarbonCredit.sol
    Marketplace.sol
    OffsetRouter.sol
  script/Deploy.s.sol   End-to-end deployment + optional seed data
  test/CarbonPlatform.t.sol
  deployments/          Deploy script writes <chainId>.json here
  foundry.toml
  remappings.txt
  .env.example

frontend/               Vite + React + TS
  src/
    pages/              Dashboard, Projects, Marketplace, Portfolio, Admin
    components/         Layout, TxButton, NotDeployed, ConnectGate, ...
    hooks/              useDeployment, useProjects, useListings, usePortfolio, useIsOwner
    contracts/          Generated ABIs + addresses.json (via sync script)
    lib/wagmi.ts
  scripts/sync-contracts.mjs
  .env.example
```

---

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- Node 20+ and npm
- A funded Sepolia account (use any faucet)
- An RPC URL for Sepolia (Alchemy / Infura / drpc / public RPC)

---

## 1. Smart contracts

Install OpenZeppelin (already vendored — this step is just informational):

```bash
cd contracts
forge install  # pulls forge-std + openzeppelin-contracts from lib/*
```

Run tests:

```bash
forge test -vv
```

You should see 7 passing tests covering registration, issuance, retirement accounting, marketplace happy path, cancellation, payment validation, and listing bookkeeping.

### Deploy to Sepolia

1. Copy the env file and fill it in:

   ```bash
   cd contracts
   cp .env.example .env
   # edit .env: PRIVATE_KEY, SEPOLIA_RPC_URL, optionally ETHERSCAN_API_KEY,
   # FEE_BPS, TREASURY, SEED
   ```

   The deployer account becomes the platform owner (the address that can register projects and mint credits) **and** the default treasury (fee collector).

2. Deploy + (optionally) seed two demo projects with some minted credits:

   ```bash
   source .env
   forge script script/Deploy.s.sol \
     --rpc-url $SEPOLIA_RPC_URL \
     --broadcast \
     --verify \
     --etherscan-api-key $ETHERSCAN_API_KEY
   ```

   Omit `--verify` / `--etherscan-api-key` if you don't want to verify source code on Etherscan.

   On success the script:
   - Deploys `ProjectRegistry`, `CarbonCredit`, `Marketplace`
   - Wires `ProjectRegistry.creditToken` to the `CarbonCredit` address
   - If `SEED=1`, registers two demo projects and issues 1500 tonnes of credits to the deployer
   - Writes `contracts/deployments/<chainId>.json` with all three addresses (for chainId 11155111 that's Sepolia)

3. Example output:

   ```
   ProjectRegistry: 0x....
   CarbonCredit   : 0x....
   Marketplace    : 0x....
   Wrote deployments/11155111.json
   ```

### Deploy locally (anvil)

```bash
anvil                                   # in one terminal
cd contracts
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
SEED=1 \
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

(the private key above is anvil's first built-in account).

---

## 2. Frontend

```bash
cd frontend
npm ci
VITE_MOCK_API=true npm run dev
```

Open http://localhost:5183 and sign in as `generator@demo.in`, `buyer@demo.in`, or `admin@demo.in` with the password `demo1234`.
Mock mode provides sample readings, forecasts, trades, and verification results.
Changes made in mock mode reset when you reload the page.

For the real REST API, omit `VITE_MOCK_API` and set `VITE_API_URL` to the backend origin without the `/api/v1` suffix.
When `VITE_API_URL` is empty, the app requests `/api/v1` on its own origin, and Vite proxies requests to port 4000 during development.

```bash
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

### Wallet-based tools

The existing Ethereum marketplace, portfolio, projects, and contract administration live under `/on-chain`.
Set `VITE_SEPOLIA_RPC_URL` to your RPC endpoint and `VITE_WALLETCONNECT_PROJECT_ID` if you use WalletConnect.
Run `npm run sync:contracts` after deploying the contracts to import your deployment addresses.

### How the frontend finds the contracts

`npm run sync:contracts` does two things:

1. Extracts the ABIs from `contracts/out/<Name>.sol/<Name>.json` into `frontend/src/contracts/<Name>.abi.json`.
2. Merges every `contracts/deployments/<chainId>.json` into a single `frontend/src/contracts/addresses.json` keyed by chainId.

When you switch the connected wallet to a network (e.g. Sepolia = 11155111), the on-chain tools look up addresses by chain ID.

If you need to override addresses without re-running the sync script (e.g. you only want to test against an already-deployed Sepolia instance), set these in `frontend/.env`:

```
VITE_CHAIN_ID=11155111
VITE_PROJECT_REGISTRY=0x...
VITE_CARBON_CREDIT=0x...
VITE_MARKETPLACE=0x...
VITE_OFFSET_ROUTER=0x...
```

### Production build

```bash
npm run build
npm run preview
```

---

## 3. End-to-end walkthrough

After deploying (with `SEED=1`) and syncing, open `/on-chain` and connect your wallet on Sepolia:

1. **Dashboard** — see aggregate stats (projects, tonnes issued, tonnes retired, active listings).
2. **Projects** — browse the two seeded projects and open either for detail (methodology, vintage, metadata URI, developer, issuance/retirement counters).
3. **Admin** (owner wallet only) — register additional projects, then issue more credits to any address.
4. **Portfolio** — the deployer will see 1000 + 500 tonnes of holdings. Approve the marketplace (one-time ERC1155 `setApprovalForAll`), then **list** some credits for sale, or **retire** credits to produce a permanent on-chain certificate (with beneficiary + reason).
5. **Marketplace** — switch to another wallet and buy credits. ETH is paid atomically, credits transfer to the buyer, fee goes to the treasury, proceeds go to the seller.

---

## Contract reference (quick)

### `ProjectRegistry`

- `registerProject(developer, name, location, methodology, vintageYear, metadataURI)` (owner)
- `updateProject(id, metadataURI, active)` (owner)
- `getProject(id) returns (Project)`
- `allProjectIds() returns (uint256[])`

### `CarbonCredit` (ERC1155 + ERC1155Supply + Ownable)

- `issue(projectId, to, amount)` (owner) — mints credits
- `retire(projectId, amount, beneficiary, reason) returns (uint256 retirementId)` — burns + emits `CreditsRetired`
- `getRetirement(id) returns (Retirement)`
- `retirementsOf(user) returns (uint256[])`
- `uri(id)` — returns the project's metadata URI

### `Marketplace`

- `createListing(token, tokenId, quantity, pricePerUnit) returns (uint256 id)`
- `cancelListing(id)`
- `buy(id, quantity) payable` — `msg.value` must equal `quantity * pricePerUnit`
- `activeListingIds() returns (uint256[])`
- Admin: `setTreasury(address)`, `setFeeBps(uint16)` (max 1000 = 10%)

All three contracts emit events rich enough to reconstruct platform state off-chain (e.g. for an indexer/subgraph).

---

## Security notes

- The platform operator is a single `Ownable` owner. For production, replace with a multisig / timelock (e.g. `Ownable2Step` + Safe).
- `Marketplace` uses `ReentrancyGuard` on buy/cancel and performs state updates before external calls.
- The marketplace fee is hard-capped at 10% (`MAX_FEE_BPS = 1000`).
- Retirement permanently burns tokens — the retirement receipt is the offset claim.
- This is a reference implementation; before handling real value, get a professional audit and add oracle-backed price discovery, KYC/AML hooks, and a robust verifier role (e.g. `AccessControl` with separate registrar / verifier / minter roles).

---

## License

MIT.
