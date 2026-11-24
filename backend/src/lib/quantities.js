const { Prisma } = require("@prisma/client");
const { HttpError } = require("./http");

const Decimal = Prisma.Decimal.clone({ precision: 50 });
const MAX_BIGINT = 9223372036854775807n;

function parseGrams(value) {
  const validNumber = typeof value === "number" && Number.isSafeInteger(value);
  const validString = typeof value === "string" && /^\d{1,19}$/.test(value);
  if (!validNumber && !validString) throw new HttpError(400, "amountG must be a positive integer");
  const grams = BigInt(value);
  if (grams <= 0n || grams > MAX_BIGINT) throw new HttpError(400, "amountG is outside the supported range");
  return grams;
}

function parseDecimal(value, field, wholeDigits, fractionDigits) {
  if (!["string", "number"].includes(typeof value) || String(value).length > 64 || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))) {
    throw new HttpError(400, `${field} must be a positive decimal`);
  }
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lte(0) || amount.gte(`1e${wholeDigits}`) || amount.decimalPlaces() > fractionDigits) {
    throw new HttpError(400, `${field} is outside the supported range or precision`);
  }
  return amount.toFixed();
}

function mintGrams(kwh, kgPerKwh) {
  return BigInt(new Decimal(kwh).times(kgPerKwh.toString()).times(1000).floor().toFixed(0));
}

function tradeTotal(amountG, priceInrPerKg) {
  return new Decimal(amountG.toString()).times(priceInrPerKg.toString()).div(1000).toFixed();
}

module.exports = { parseGrams, parseDecimal, mintGrams, tradeTotal, MAX_BIGINT };
