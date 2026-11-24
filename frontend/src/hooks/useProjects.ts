import { useReadContract, useReadContracts } from "wagmi";
import { projectRegistryAbi } from "@/contracts";
import { useDeployment } from "./useDeployment";

export type Project = {
  id: bigint;
  developer: `0x${string}`;
  name: string;
  location: string;
  methodology: string;
  vintageYear: number;
  totalIssued: bigint;
  totalRetired: bigint;
  metadataURI: string;
  active: boolean;
};

export function useAllProjectIds() {
  const { addresses } = useDeployment();
  return useReadContract({
    abi: projectRegistryAbi,
    address: addresses?.projectRegistry,
    functionName: "allProjectIds",
    query: { enabled: Boolean(addresses) },
  });
}

export function useProject(id: bigint | undefined) {
  const { addresses } = useDeployment();
  return useReadContract({
    abi: projectRegistryAbi,
    address: addresses?.projectRegistry,
    functionName: "getProject",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: Boolean(addresses && id !== undefined) },
  });
}

/// Load every project in the registry in one batched call.
export function useAllProjects() {
  const { addresses } = useDeployment();
  const ids = useAllProjectIds();
  const idList = (ids.data ?? []) as bigint[];

  const many = useReadContracts({
    allowFailure: false,
    contracts: idList.map((id) => ({
      abi: projectRegistryAbi,
      address: addresses!.projectRegistry,
      functionName: "getProject",
      args: [id],
    })),
    query: {
      enabled: Boolean(addresses) && idList.length > 0,
    },
  });

  return {
    ids: idList,
    projects: (many.data ?? []) as Project[],
    isLoading: ids.isLoading || many.isLoading,
    refetch: async () => {
      await ids.refetch();
      await many.refetch();
    },
    error: ids.error ?? many.error,
  };
}
