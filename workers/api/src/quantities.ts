import { HttpError } from "./http";

import { ExactDecimal } from "./decimal";
export const MAX_GRAMS = 9223372036854775807n;
export const LEDGER_BASE = 4294967296n;

export function parseGrams(value: unknown, allowZero = false) {
  const validNumber = typeof value === "number" && Number.isSafeInteger(value);
  const validString = typeof value === "string" && /^\d{1,19}$/.test(value);
  if (!validNumber && !validString) throw new HttpError(400, "amountG must be a positive integer");
  const grams = BigInt(value as number | string);
  if (grams < (allowZero ? 0n : 1n) || grams > MAX_GRAMS) {
    throw new HttpError(400, "amountG is outside the supported range");
  }
  return grams;
}

export function parseDecimal(value: unknown, field: string, wholeDigits: number, fractionDigits: number) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).length > 64 ||
      !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))) {
    throw new HttpError(400, `${field} must be a positive decimal`);
  }
  const amount = new ExactDecimal(value);
  if (!amount.isFinite() || amount.lte(0) || amount.gte(`1e${wholeDigits}`) || amount.decimalPlaces() > fractionDigits) {
    throw new HttpError(400, `${field} is outside the supported range or precision`);
  }
  return amount.toFixed();
}
