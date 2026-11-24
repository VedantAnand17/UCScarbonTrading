import { useReadContract, useReadContracts } from "wagmi";
import { marketplaceAbi } from "@/contracts";
import { useDeployment } from "./useDeployment";

export type Listing = {
  id: bigint;
  seller: `0x${string}`;
  token: `0x${string}`;
  tokenId: bigint;
  remaining: bigint;
  pricePerUnit: bigint;
  active: boolean;
};

export function useActiveListingIds() {
  const { addresses } = useDeployment();
  return useReadContract({
    abi: marketplaceAbi,
    address: addresses?.marketplace,
    functionName: "activeListingIds",
    query: { enabled: Boolean(addresses) },
  });
}

export function useActiveListings() {
  const { addresses } = useDeployment();
  const ids = useActiveListingIds();
  const idList = (ids.data ?? []) as bigint[];

  const many = useReadContracts({
    allowFailure: false,
    contracts: idList.map((id) => ({
      abi: marketplaceAbi,
      address: addresses!.marketplace,
      functionName: "getListing",
      args: [id],
    })),
    query: { enabled: Boolean(addresses) && idList.length > 0 },
  });

  return {
    ids: idList,
    listings: (many.data ?? []) as Listing[],
    isLoading: ids.isLoading || many.isLoading,
    refetch: async () => {
      await ids.refetch();
      await many.refetch();
    },
    error: ids.error ?? many.error,
  };
}
