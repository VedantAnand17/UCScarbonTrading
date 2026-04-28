import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useEffect } from "react";
import { carbonCreditAbi } from "@/contracts";
import { useDeployment } from "@/hooks/useDeployment";

/// Reads + lets you flip the seller's `setApprovalForAll(marketplace, true)` flag
/// on the CarbonCredit ERC1155. Required before listing on the marketplace.
export function useMarketApproval() {
  const { addresses, user } = useDeployment();

  const { data: approved, refetch, isFetched } = useReadContract({
    abi: carbonCreditAbi,
    address: addresses?.carbonCredit,
    functionName: "isApprovedForAll",
    args: user && addresses ? [user, addresses.marketplace] : undefined,
    query: { enabled: Boolean(addresses && user) },
  });

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetch();
      reset();
    }
  }, [isSuccess, refetch, reset]);

  const approve = () => {
    if (!addresses) return;
    writeContract({
      abi: carbonCreditAbi,
      address: addresses.carbonCredit,
      functionName: "setApprovalForAll",
      args: [addresses.marketplace, true],
    });
  };

  return {
    approved: Boolean(approved),
    isApproving: isPending || isMining,
    isLoaded: isFetched,
    approve,
    hash,
    refetch,
  };
}
