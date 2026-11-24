import type { Abi, Address } from "viem";
import ProjectRegistryAbi from "./ProjectRegistry.abi.json";
import CarbonCreditAbi from "./CarbonCredit.abi.json";
import MarketplaceAbi from "./Marketplace.abi.json";
import OffsetRouterAbi from "./OffsetRouter.abi.json";

export const projectRegistryAbi = ProjectRegistryAbi as Abi;
export const carbonCreditAbi = CarbonCreditAbi as Abi;
export const marketplaceAbi = MarketplaceAbi as Abi;
export const offsetRouterAbi = OffsetRouterAbi as Abi;

export type DeployedAddresses = {
  projectRegistry: Address;
  carbonCredit: Address;
  marketplace: Address;
  offsetRouter: Address;
};

const deployments = import.meta.glob<Record<string, DeployedAddresses>>("./addresses.json", {
  eager: true,
  import: "default",
});
const addresses = deployments["./addresses.json"] ?? {};

/// Look up deployed addresses for a given chainId. Falls back to an env-overridden
/// deployment on 11155111 (Sepolia) when provided via Vite env vars. Returns
/// undefined if nothing is configured for the chain.
export function getAddresses(chainId: number | undefined): DeployedAddresses | undefined {
  if (chainId === undefined) return undefined;

  // Allow overriding via env (useful when you deploy to a chain not yet in
  // addresses.json — e.g. a freshly-spun anvil).
  const envReg = import.meta.env.VITE_PROJECT_REGISTRY as string | undefined;
  const envCred = import.meta.env.VITE_CARBON_CREDIT as string | undefined;
  const envMkt = import.meta.env.VITE_MARKETPLACE as string | undefined;
  const envRouter = import.meta.env.VITE_OFFSET_ROUTER as string | undefined;
  const envChain = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
  if (envReg && envCred && envMkt && envRouter && envChain === chainId) {
    return {
      projectRegistry: envReg as Address,
      carbonCredit: envCred as Address,
      marketplace: envMkt as Address,
      offsetRouter: envRouter as Address,
    };
  }

  return addresses[String(chainId)];
}

export const ALL_CONFIGURED_CHAINS = Object.keys(addresses).map(Number);

export function getDeployedChainIds(): number[] {
  return ALL_CONFIGURED_CHAINS;
}
