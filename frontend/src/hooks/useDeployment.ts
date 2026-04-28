import { useChainId, useAccount } from "wagmi";
import { getAddresses } from "@/contracts";

export function useDeployment() {
  const chainId = useChainId();
  const { address } = useAccount();
  const addresses = getAddresses(chainId);
  return { chainId, addresses, user: address };
}
