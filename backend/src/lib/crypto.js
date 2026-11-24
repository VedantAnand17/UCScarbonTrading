const crypto = require("crypto");

const ENC_ALGO = "aes-256-gcm";

function getEncryptionKey() {
  const hex = process.env.DEVICE_SECRET_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(hex || "")) {
    throw new Error(
      "DEVICE_SECRET_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes)"
    );
  }
  return Buffer.from(hex, "hex");
}

// Encrypts a device secret for storage. Reversible (unlike a password
// hash) because HMAC verification needs the raw secret back.
function encryptSecret(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Store ciphertext + authTag together; iv stored separately.
  return {
    encryptedSecret: Buffer.concat([ciphertext, authTag]).toString("base64"),
    secretIv: iv.toString("base64"),
  };
}

function decryptSecret(encryptedSecret, secretIv) {
  const key = getEncryptionKey();
  const iv = Buffer.from(secretIv, "base64");
  const combined = Buffer.from(encryptedSecret, "base64");

  const authTag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);

  const decipher = crypto.createDecipheriv(ENC_ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function generateDeviceSecret() {
  return crypto.randomBytes(32).toString("hex"); // 64 hex chars
}

function generateDeviceId() {
  return `dev_${crypto.randomBytes(4).toString("hex")}`;
}

// Canonical serialization — MUST match firmware's canonicalPayload()
// in esp32-ingestion.ino exactly (fixed field order, 6-decimal floats,
// no whitespace):
//   device_id|seq|timestamp|kwh_cumulative|kwh_interval
function canonicalPayload({ device_id, seq, timestamp, kwh_cumulative, kwh_interval }) {
  return [
    device_id,
    seq,
    timestamp,
    Number(kwh_cumulative).toFixed(6),
    Number(kwh_interval).toFixed(6),
  ].join("|");
}

function hmacHex(message, secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

// Constant-time comparison, per prd.md 4.2 step 3.
function verifyHmac(payload, secret, signatureHex) {
  const expected = hmacHex(payload, secret);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHex || "", "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  encryptSecret,
  decryptSecret,
  generateDeviceSecret,
  generateDeviceId,
  canonicalPayload,
  hmacHex,
  verifyHmac,
};
