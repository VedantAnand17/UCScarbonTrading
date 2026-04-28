import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { carbonCreditAbi } from "@/contracts";
import { useDeployment } from "./useDeployment";
import { useAllProjects, type Project } from "./useProjects";

export type Balance = {
  project: Project;
  balance: bigint;
};

export type RetirementRecord = {
  id: bigint;
  projectId: bigint;
  retiredBy: `0x${string}`;
  beneficiary: `0x${string}`;
  amount: bigint;
  timestamp: bigint;
  reason: string;
};

export function useUserBalances() {
  const { addresses, user } = useDeployment();
  const { ids, projects, isLoading: loadingProjects } = useAllProjects();

  const balances = useReadContracts({
    allowFailure: false,
    contracts: ids.map((id) => ({
      abi: carbonCreditAbi as any,
      address: addresses!.carbonCredit,
      functionName: "balanceOf",
      args: [user!, id],
    })),
    query: { enabled: Boolean(addresses && user) && ids.length > 0 },
  });

  const raw = (balances.data ?? []) as bigint[];

  const result: Balance[] = projects.map((p, i) => ({
    project: p,
    balance: raw[i] ?? 0n,
  }));

  return {
    balances: result.filter((b) => b.balance > 0n),
    allBalances: result,
    isLoading: loadingProjects || balances.isLoading,
    refetch: balances.refetch,
  };
}

/// Returns retirements where the connected wallet is either the caller
/// (`retiredBy`) or the recorded beneficiary — so router-routed offsets show
/// up on the user's certificate list too.
export function useUserRetirements() {
  const { addresses, user } = useDeployment();
  const enabled = Boolean(addresses && user);

  const ofUser = useReadContract({
    abi: carbonCreditAbi,
    address: addresses?.carbonCredit,
    functionName: "retirementsOf",
    args: user ? [user] : undefined,
    query: { enabled },
  });
  const forBenef = useReadContract({
    abi: carbonCreditAbi,
    address: addresses?.carbonCredit,
    functionName: "retirementsForBeneficiary",
    args: user ? [user] : undefined,
    query: { enabled },
  });

  const idList = useMemo<bigint[]>(() => {
    const a = (ofUser.data ?? []) as bigint[];
    const b = (forBenef.data ?? []) as bigint[];
    const seen = new Set<string>();
    const out: bigint[] = [];
    for (const id of [...a, ...b]) {
      const k = String(id);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(id);
      }
    }
    return out;
  }, [ofUser.data, forBenef.data]);

  const many = useReadContracts({
    allowFailure: false,
    contracts: idList.map((id) => ({
      abi: carbonCreditAbi as any,
      address: addresses!.carbonCredit,
      functionName: "getRetirement",
      args: [id],
    })),
    query: { enabled: enabled && idList.length > 0 },
  });

  return {
    retirements: (many.data ?? []) as RetirementRecord[],
    isLoading: ofUser.isLoading || forBenef.isLoading || many.isLoading,
    refetch: async () => {
      await ofUser.refetch();
      await forBenef.refetch();
      await many.refetch();
    },
  };
}
