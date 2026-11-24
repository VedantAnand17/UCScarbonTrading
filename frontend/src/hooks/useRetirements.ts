import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { carbonCreditAbi } from "@/contracts";
import { useDeployment } from "./useDeployment";

export type Retirement = {
  id: bigint;
  projectId: bigint;
  retiredBy: Address;
  beneficiary: Address;
  amount: bigint;
  timestamp: bigint;
  reason: string;
};

/// Reads the most recent N retirements globally by walking
/// `nextRetirementId` backwards. Cheap one-shot view that doesn't require
/// indexing logs.
export function useRecentRetirements(limit = 10) {
  const { addresses } = useDeployment();

  const next = useReadContract({
    abi: carbonCreditAbi,
    address: addresses?.carbonCredit,
    functionName: "nextRetirementId",
    query: { enabled: Boolean(addresses) },
  });

  const ids = useMemo<bigint[]>(() => {
    const n = (next.data as bigint | undefined) ?? 1n;
    if (n <= 1n) return [];
    const out: bigint[] = [];
    for (let i = n - 1n; i >= 1n && out.length < limit; i--) {
      out.push(i);
    }
    return out;
  }, [next.data, limit]);

  const details = useReadContracts({
    allowFailure: false,
    contracts: ids.map((id) => ({
      abi: carbonCreditAbi,
      address: addresses!.carbonCredit,
      functionName: "getRetirement",
      args: [id],
    })),
    query: { enabled: Boolean(addresses) && ids.length > 0 },
  });

  return {
    ids,
    retirements: (details.data ?? []) as Retirement[],
    isLoading: next.isLoading || details.isLoading,
    refetch: async () => {
      await next.refetch();
      await details.refetch();
    },
    error: next.error ?? details.error,
  };
}
