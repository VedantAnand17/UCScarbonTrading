import { useMemo } from "react";
import { useActiveListings, type Listing } from "./useListings";

export type OffsetRouteStep = {
  listing: Listing;
  quantity: bigint;
  cost: bigint;
};

export type OffsetRoute = {
  steps: OffsetRouteStep[];
  totalTonnes: bigint;
  totalCost: bigint;
  /// True when the active listings cannot fully cover the requested tonnes.
  shortfall: bigint;
  /// Average price per tonne (wei). 0n when no fillable listings.
  avgPrice: bigint;
  isLoading: boolean;
};

/// Greedy fill across active listings sorted by price ascending. Returns the
/// listing ids + quantities a buyer should pass to `OffsetRouter.offset`.
export function useOffsetRoute(targetTonnes: bigint): OffsetRoute {
  const { listings, isLoading } = useActiveListings();

  return useMemo<OffsetRoute>(() => {
    if (targetTonnes <= 0n) {
      return {
        steps: [],
        totalTonnes: 0n,
        totalCost: 0n,
        shortfall: 0n,
        avgPrice: 0n,
        isLoading,
      };
    }

    const sorted = listings
      .filter((l) => l.active && l.remaining > 0n)
      .slice()
      .sort((a, b) => {
        if (a.pricePerUnit === b.pricePerUnit) return 0;
        return a.pricePerUnit < b.pricePerUnit ? -1 : 1;
      });

    const steps: OffsetRouteStep[] = [];
    let remaining = targetTonnes;
    let totalCost = 0n;
    let totalTonnes = 0n;

    for (const l of sorted) {
      if (remaining === 0n) break;
      const take = l.remaining < remaining ? l.remaining : remaining;
      const cost = take * l.pricePerUnit;
      steps.push({ listing: l, quantity: take, cost });
      totalTonnes += take;
      totalCost += cost;
      remaining -= take;
    }

    const shortfall = remaining;
    const avgPrice = totalTonnes > 0n ? totalCost / totalTonnes : 0n;

    return {
      steps,
      totalTonnes,
      totalCost,
      shortfall,
      avgPrice,
      isLoading,
    };
  }, [listings, targetTonnes, isLoading]);
}
