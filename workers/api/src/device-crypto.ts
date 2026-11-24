import { Buffer } from "node:buffer";

const utf8 = new TextEncoder();

async function encryptionKey(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("DEVICE_SECRET_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)");
  }
  return crypto.subtle.importKey("raw", Buffer.from(secret, "hex"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const randomHex = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");

export async function encryptSecret(secret: string, key: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(key), utf8.encode(secret));
  return { encryptedSecret: Buffer.from(ciphertext).toString("base64"), secretIv: Buffer.from(iv).toString("base64") };
}

export async function decryptSecret(encrypted: string, iv: string, key: string) {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    await encryptionKey(key), Buffer.from(encrypted, "base64"),
  );
  return new TextDecoder().decode(bytes);
}

export type SignedReading = {
  device_id: string; seq: number; timestamp: number; kwh_cumulative: number; kwh_interval: number; signature: string;
};

export function canonicalReading(reading: Omit<SignedReading, "signature">) {
  return [
    reading.device_id, reading.seq, reading.timestamp, reading.kwh_cumulative.toFixed(6), reading.kwh_interval.toFixed(6),
  ].join("|");
}

export async function verifyReading(reading: SignedReading, secret: string) {
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, Buffer.from(reading.signature, "hex"), utf8.encode(canonicalReading(reading)));
}
