import type { Measurement } from "./types";

const grouped = new Intl.NumberFormat("en-IN");
const decimal = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});

function formatGrams(grams: bigint, scale: bigint, digits: number) {
  const absolute = grams < 0n ? -grams : grams;
  const whole = grouped.format(absolute / scale);
  const fraction = String(absolute % scale).padStart(digits, "0").replace(/0+$/, "");
  return `${grams < 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatCarbon(grams: Measurement) {
  const amount = BigInt(grams);
  if (amount >= 1_000_000n || amount <= -1_000_000n) {
    // Tonnes are shown to the nearest kilogram (3 decimals) to stay readable.
    const half = amount < 0n ? -500n : 500n;
    return `${formatGrams((amount + half) / 1_000n, 1_000n, 3)} tCO₂e`;
  }
  return `${formatGrams(amount, 1_000n, 3)} kgCO₂e`;
}

export function kilogramsToGrams(kilograms: string) {
  const match = /^(\d*?)(?:\.(\d{1,3}))?$/.exec(kilograms.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const grams = Number(`${match[1]}${(match[2] ?? "").padEnd(3, "0")}`);
  return Number.isSafeInteger(grams) && grams > 0 ? grams : null;
}

export const formatNumber = (value: Measurement) => decimal.format(Number(value));
export const formatInr = (value: Measurement) => rupees.format(Number(value));
export const formatDate = (value: string) => date.format(new Date(value));
export const formatDateTime = (value: string) => dateTime.format(new Date(value));
export const shortId = (value: string) => value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;

/** Turns backend validation reasons into sentence-case labels for people. */
export function formatFlagReason(reason: string | null | undefined) {
  if (!reason) return "Validation flagged";
  const text = reason
    .replace(/\bkwh_interval\b/gi, "energy interval")
    .replaceAll("_", " ")
    .replace(/\b(\d+\.\d*?)0+\b/g, (_, n: string) => n.replace(/\.$/, ""));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
