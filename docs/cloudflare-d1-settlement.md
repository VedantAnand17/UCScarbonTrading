# Cloudflare D1 settlement

A reservation starts with a guarded `INSERT INTO Listing … SELECT` that projects the seller's available grams from the append-only ledger and inserts only when that balance covers the reservation.
A purchase starts with a guarded `UPDATE Listing` that decrements the remainder only if the listing is still open and has sufficient units, marking it filled at zero.
The purchase reads the seller and unit price beforehand to compute the canonical trade hash, and the guarded debit checks those same terms.

Each operation runs in a single serial, atomic D1 batch.
The next statement checks SQLite's `changes()` from the guarded write, and subsequent statements depend on the preceding insert, so a losing request creates no ledger entries, trade, or anchor.
Any failed statement rolls back the entire batch, including the initial write.
Cancellation similarly changes the listing status, releases only its unpurchased grams to the seller's available bucket, and zeros the remainder in one batch.

D1 stores each signed gram amount as an SQLite integer and returns it as text to preserve precision at the JavaScript boundary.
Balance projections sum the quotient and remainder of each entry divided by 2³² separately, then recombine with integer arithmetic so a balance can exceed the range of an individual entry.
Prices use canonical decimal strings and trade totals use exact decimal arithmetic.

## Local verification

From the repository root, run the following with Node 22.18 or later and Foundry's `anvil` and `forge` on your PATH.

```sh
cd workers/api
npm ci
cp .dev.vars.example .dev.vars
npm test
npm run typecheck
npm run seed:local
npm run dev -- --port 8787
```

In another terminal at the repository root, run the frontend with the API proxy pointed at the Worker.

```sh
cd frontend
npm ci
API_PROXY_TARGET=http://127.0.0.1:8787 npm run dev
```

The demo password is `demo1234` for `generator@demo.in`, `generator2@demo.in`, `buyer@demo.in`, and `admin@demo.in`.
The three demo anchors stay pending locally until an RPC endpoint, contract address, deployment block, and matching signing key are configured.
To publish forecasts through the Worker, provide admin credentials each night or a current admin JWT in `FORECAST_API_TOKEN`, then run:

```sh
cd forecasting
FORECAST_API_EMAIL=admin@demo.in FORECAST_API_PASSWORD=demo1234 \
  uv run --locked python -m ucs_forecast.publish --api http://127.0.0.1:8787
```

## Remote demo seed

Run `npm run seed:sql` in `workers/api` with the destination Worker's `DEVICE_SECRET_ENCRYPTION_KEY` in the environment.
Then apply `demo-seed.sql` to the migrated D1 database with `npx wrangler d1 execute DB --remote --file=demo-seed.sql`.
The generated SQL contains encrypted meter credentials and uses fixed keys to preserve existing demo rows when reapplied.
