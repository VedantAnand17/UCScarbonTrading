# Nightly Forecast Worker

`ucs-carbon-forecast` runs at 18:30 UTC every day (midnight in India, at the start of the next day).
The Worker forwards both scheduled jobs and authenticated `POST /run` requests to one Cloudflare Container and logs scheduled results in Workers Logs.
The container listens on port 8080, serves `GET /health`, and calls the existing forecast publisher against `FORECAST_API_URL`.
A completed run returns `{ "ok": true, "devices": ["..."], "durationMs": 123 }`, where `devices` contains the publisher's report lines for the forecasts it posted.
An overlapping run returns HTTP 409; a publisher failure returns HTTP 500 and includes any report lines produced before the failure.

The `basic` instance type has 1 GiB RAM and 1/4 vCPU.
A local run at those limits on two devices with 840 hourly readings each finished in about 71 seconds and peaked at about 404 MiB of container memory, above the `lite` limit of 256 MiB.
The container sleeps after five idle minutes.

## Deploy

Use the Cloudflare account that hosts the API, with Workers Paid and Containers enabled, a configured `workers.dev` subdomain for the manual route, and Docker running locally.
The package lock pins Wrangler 4.167.0, which supports the Container configuration in this directory.
`FORECAST_API_URL` defaults to `https://api.carbon.vedant-dev.com`; update `wrangler.toml` before deploying if the API origin changes.

From the repository root:

```sh
cd workers/forecast-cron
npm ci
umask 077
touch .deploy-secrets
```

Put these three values in the ignored `.deploy-secrets` file using `KEY=value` dotenv syntax:

- `FORECAST_API_EMAIL`: the email of an admin on the target API.
- `FORECAST_API_PASSWORD`: that API admin's password.
- `CRON_TRIGGER_TOKEN`: a separate, randomly generated bearer secret (`openssl rand -hex 32`).

Deploy with all required secrets in the same upload, then remove the local secrets file:

```sh
npx wrangler deploy --secrets-file .deploy-secrets
rm .deploy-secrets
```

After the first deploy, Cloudflare can take several minutes to provision the container.
Use the Worker URL printed by Wrangler as `WORKER_URL` and load the trigger token from your secret store into `CRON_TRIGGER_TOKEN` before running:

```sh
curl --fail-with-body --max-time 300 -X POST "$WORKER_URL/run" \
  -H "Authorization: Bearer $CRON_TRIGGER_TOKEN"
```

For later code-only deployments, run `npx wrangler deploy`.
To rotate a secret interactively, use `npx wrangler secret put CRON_TRIGGER_TOKEN`, `npx wrangler secret put FORECAST_API_EMAIL`, or `npx wrangler secret put FORECAST_API_PASSWORD`.

## Local Checks

From the repository root:

```sh
(cd forecasting && OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 uv run --locked pytest)
(cd workers/forecast-cron && npm ci && npm test && npm run typecheck)
docker build --platform linux/amd64 -f workers/forecast-cron/Dockerfile -t ucs-carbon-forecast:local .
```

Start the seeded local API using the [D1 local verification steps](../../docs/cloudflare-d1-settlement.md#local-verification).
On Linux, use host networking so the container can reach the API on `127.0.0.1:8787`, and bind the container server to loopback for this test rather than exposing its unauthenticated route to the local network:

```sh
docker run --rm --network host --cpus 0.25 --memory 1g --memory-swap 1g \
  -e FORECAST_API_URL=http://127.0.0.1:8787 \
  -e FORECAST_API_EMAIL=admin@demo.in -e FORECAST_API_PASSWORD=demo1234 \
  ucs-carbon-forecast:local python -c \
  'from ucs_forecast.server import create_server; create_server("127.0.0.1").serve_forever()'
```

In another terminal, run `curl -fsS http://127.0.0.1:8080/health` and `curl -fsS -X POST http://127.0.0.1:8080/run`.
Log in to the local API as `generator@demo.in` with `demo1234` and use the returned token to check that `GET /api/v1/generator/forecast` returns a new forecast ID and 24 hourly values.
