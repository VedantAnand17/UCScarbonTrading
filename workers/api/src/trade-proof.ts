import { keccak256, stringToHex } from "viem";
import { ExactDecimal } from "./decimal.ts";

export type SettledTrade = {
  id: string; listingId: string; buyerOrgId: string; sellerOrgId: string; amountG: string;
  priceInrPerKg: string; totalInr: string; status: string; settledAt: string;
};

export function tradeTotal(amountG: string, price: string) {
  return new ExactDecimal(amountG).times(price).div(1000).toFixed();
}

export function settledHash(trade: SettledTrade) {
  const { amountG, buyerOrgId, id, listingId, priceInrPerKg, sellerOrgId, settledAt, status, totalInr } = trade;
  return keccak256(stringToHex(JSON.stringify({
    amountG, buyerOrgId, id, listingId, priceInrPerKg, sellerOrgId, settledAt, status, totalInr,
  })));
}
