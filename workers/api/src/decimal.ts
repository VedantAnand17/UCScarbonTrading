import Decimal from "decimal.js";

export const ExactDecimal = Decimal.clone({ precision: 50 });

export function mintGrams(kwh: number, factor: string) {
  return BigInt(new ExactDecimal(kwh).times(factor).times(1000).floor().toFixed(0));
}
