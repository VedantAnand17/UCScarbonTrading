// kWh -> whole-tonne credit conversion.
//
// CarbonCredit's ERC1155 amount is a whole-number tonne count (see
// frontend/src/lib/format.ts — displayed with no decimal places). At the
// real emission factor (0.710 kg CO2/kWh), a single ~5min reading needs
// roughly 1,400 kWh of delta to reach even 1 whole credit — real bench
// readings (fractions of a kWh) would floor to 0 every cycle, so nothing
// would ever visibly mint in a demo.
//
// DEMO_AMPLIFY scales the real formula up (still floors to 0 for truly
// tiny deltas). DEMO_MIN_CREDITS is the actual guarantee: any validated
// reading with kwh_interval > 0 mints at least this many credits, so a
// live demo always shows something happening. Both are explicit env
// knobs — set DEMO_AMPLIFY=1 and DEMO_MIN_CREDITS=0 to go fully "real"
// once minting isn't per-tiny-reading anymore (e.g. after switching to
// accumulated/batched minting).
const EMISSION_FACTOR_KG_PER_KWH = Number(process.env.EMISSION_FACTOR_KG_PER_KWH || 0.71);
const DEMO_AMPLIFY = Number(process.env.DEMO_AMPLIFY || 100);
const DEMO_MIN_CREDITS = Number(process.env.DEMO_MIN_CREDITS ?? 1);

function computeCreditsAmount(kwhInterval) {
  if (kwhInterval <= 0) return 0;

  const realTonnes = (kwhInterval * EMISSION_FACTOR_KG_PER_KWH) / 1000;
  const amplifiedTonnes = realTonnes * DEMO_AMPLIFY;
  const floored = Math.floor(amplifiedTonnes);

  return Math.max(floored, DEMO_MIN_CREDITS);
}

module.exports = { computeCreditsAmount, EMISSION_FACTOR_KG_PER_KWH, DEMO_AMPLIFY, DEMO_MIN_CREDITS };
