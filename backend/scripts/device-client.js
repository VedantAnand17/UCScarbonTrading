#!/usr/bin/env node
// Software client that emulates an ESP32 metering node. It signs readings exactly
// like the firmware (HMAC-SHA256 over the canonical payload) and can replay the
// negative cases used in testing: unsigned, tampered, replayed, spike and meter
// rollback readings.
//
// Usage:
//   DEVICE_ID=... DEVICE_SECRET=... node scripts/device-client.js [--url http://localhost:4000] [--rated-kw 5]
const { canonicalPayload, hmacHex } = require("../src/lib/crypto");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const baseUrl = args.url || "http://localhost:4000";
const deviceId = process.env.DEVICE_ID;
const secret = process.env.DEVICE_SECRET;
const ratedKw = Number(args["rated-kw"] || 5);
if (!deviceId || !secret) {
  console.error("Set DEVICE_ID and DEVICE_SECRET (shown once when the device is provisioned).");
  process.exit(1);
}

function sign(reading) {
  return { ...reading, signature: hmacHex(canonicalPayload(reading), secret) };
}

async function post(label, body) {
  const started = performance.now();
  const res = await fetch(`${baseUrl}/api/v1/ingest/reading`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = performance.now() - started;
  const text = await res.text();
  console.log(`${label.padEnd(34)} HTTP ${res.status}  ${ms.toFixed(1)} ms  ${text.slice(0, 120)}`);
  return { status: res.status, ms };
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  let seq = Number(args["start-seq"] || 1);
  let cumulative = Number(args["start-kwh"] || 1000);
  const perMinuteKwh = (ratedKw * 0.8) / 60;
  const latencies = [];

  for (let i = 0; i < 5; i += 1) {
    cumulative += perMinuteKwh;
    const reading = sign({
      device_id: deviceId, seq, timestamp: now - (5 - i) * 60,
      kwh_cumulative: Number(cumulative.toFixed(6)), kwh_interval: Number(perMinuteKwh.toFixed(6)),
    });
    latencies.push((await post(`valid reading seq ${seq}`, reading)).ms);
    seq += 1;
  }

  const base = { device_id: deviceId, seq, timestamp: now, kwh_cumulative: Number((cumulative + perMinuteKwh).toFixed(6)), kwh_interval: Number(perMinuteKwh.toFixed(6)) };
  await post("unsigned reading", { ...base, signature: "" });
  const tampered = sign(base);
  await post("tampered after signing", { ...tampered, kwh_cumulative: tampered.kwh_cumulative + 50 });
  await post("replayed sequence", sign({ ...base, seq: seq - 1 }));
  await post("implausible spike", sign({ ...base, kwh_cumulative: cumulative + 40, kwh_interval: 40 }));
  await post("meter rollback (lower cumulative)", sign({ ...base, seq: seq + 1, kwh_cumulative: cumulative - 10, kwh_interval: 0 }));

  latencies.sort((a, b) => a - b);
  console.log(`valid-reading latency: median ${latencies[2].toFixed(1)} ms, max ${latencies[4].toFixed(1)} ms`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
