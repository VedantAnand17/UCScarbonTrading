import { AlertTriangle } from "lucide-react";
import { useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useDeployment } from "@/hooks/useDeployment";
import { getDeployedChainIds } from "@/contracts";

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia",
  31337: "Anvil / Localhost",
  1337: "Hardhat",
};

export function NotDeployed() {
  const { chainId } = useDeployment();
  const { switchChain, isPending } = useSwitchChain();
  const deployedChains = getDeployedChainIds();
  const onDeployedChain = deployedChains.includes(chainId);
  const wrongNetwork = !onDeployedChain && deployedChains.length > 0;
  const currentName = CHAIN_NAMES[chainId] ?? `chainId ${chainId}`;

  if (wrongNetwork) {
    return (
      <div className="card flex items-start gap-4 border-amber-500/30 bg-amber-500/5 p-6">
        <AlertTriangle className="mt-1 h-5 w-5 flex-none text-amber-400" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-100">
            Wrong network: {currentName}
          </div>
          <div className="mt-1 text-sm text-amber-100/70">
            This site lives on{" "}
            <span className="font-medium text-amber-100">Sepolia</span>. Change
            networks in your wallet to keep going.
          </div>
          <button
            type="button"
            onClick={() => switchChain({ chainId: sepolia.id })}
            disabled={isPending}
            className="btn-primary mt-3 disabled:opacity-50"
          >
            {isPending ? "Switching..." : "Switch to Sepolia"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex items-start gap-4 border-amber-500/30 bg-amber-500/5 p-6">
      <AlertTriangle className="mt-1 h-5 w-5 flex-none text-amber-400" />
      <div>
        <div className="text-sm font-semibold text-amber-100">
          No deployment found{chainId ? ` for ${currentName}` : ""}
        </div>
        <div className="mt-1 text-sm text-amber-100/70">
          Deploy the contracts with{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-amber-200">
            forge script script/Deploy.s.sol --rpc-url sepolia --broadcast
          </code>
          , then run{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-amber-200">
            npm run sync:contracts
          </code>{" "}
          in the <span className="font-mono">frontend/</span> folder.
        </div>
      </div>
    </div>
  );
}
