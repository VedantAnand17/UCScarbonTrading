import { useReadContract } from "wagmi";
import { carbonCreditAbi } from "@/contracts";
import { useDeployment } from "./useDeployment";

/// Returns true when the connected account is the owner of the CarbonCredit
/// contract (i.e. the platform operator who can register projects and mint
/// credits). Used to gate the Admin page.
export function useIsOwner() {
  const { addresses, user } = useDeployment();
  const { data: owner, isLoading } = useReadContract({
    abi: carbonCreditAbi,
    address: addresses?.carbonCredit,
    functionName: "owner",
    query: { enabled: Boolean(addresses) },
  });

  return {
    isOwner:
      Boolean(user && owner) &&
      (owner as string | undefined)?.toLowerCase() === user?.toLowerCase(),
    owner: owner as `0x${string}` | undefined,
    isLoading,
  };
}
