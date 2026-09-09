// Local stub of POST /api/v1/ingest/reading for testing the ESP32 firmware
// against a real HTTP server without standing up the full backend.
//
// Implements the same canonical-payload HMAC verification and (device_id, seq)
// idempotency contract as prd.md §4.2, so firmware behavior observed against
// this stub should carry over to the real backend.
//
// Usage:
//   npm install
//   node server.js
//
// Then point the firmware's INGEST_URL at http://<this machine's LAN IP>:3000/api/v1/ingest/reading

const http = require("http");
const crypto = require("crypto");

const PORT = 3000;

// Must match DEVICE_ID / DEVICE_SECRET in esp32-ingestion.ino
const DEVICES = {
  dev_test001: "test-secret-change-me",
};

// device_id -> highest accepted seq
const lastSeq = {};
// (device_id, seq) already accepted -> true, for idempotent 409s
const seen = new Set();

function canonicalPayload(body) {
  return [
    body.device_id,
    body.seq,
    body.timestamp,
    Number(body.kwh_cumulative).toFixed(6),
    Number(body.kwh_interval).toFixed(6),
  ].join("|");
}

function verifyHmac(payload, secret, signatureHex) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHex || "", "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/v1/ingest/reading") {
    res.writeHead(404).end();
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      console.log("400 malformed JSON:", raw);
      res.writeHead(400).end("malformed JSON");
      return;
    }

    console.log("\n<< received:", body);

    const secret = DEVICES[body.device_id];
    if (!secret) {
      console.log(`401 unknown device_id=${body.device_id}`);
      res.writeHead(401).end();
      return;
    }

    const payload = canonicalPayload(body);
    if (!verifyHmac(payload, secret, body.signature)) {
      console.log("401 bad signature. canonical string was:", payload);
      res.writeHead(401).end();
      return;
    }

    const key = `${body.device_id}:${body.seq}`;
    if (seen.has(key) || body.seq <= (lastSeq[body.device_id] || 0)) {
      console.log(`409 duplicate/replayed seq=${body.seq}`);
      res.writeHead(409).end();
      return;
    }

    seen.add(key);
    lastSeq[body.device_id] = body.seq;

    console.log(
      `200 accepted seq=${body.seq} kwh_cumulative=${body.kwh_cumulative} kwh_interval=${body.kwh_interval}`
    );
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ status: "accepted" })
    );
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ingest stub listening on http://0.0.0.0:${PORT}/api/v1/ingest/reading`);
  console.log("known devices:", Object.keys(DEVICES));
});
