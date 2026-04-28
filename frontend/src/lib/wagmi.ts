import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia, mainnet, foundry } from "wagmi/chains";
import { http } from "viem";

const sepoliaRpc = import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined;
const projectId =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ??
  // RainbowKit requires a non-empty projectId string even if WalletConnect is
  // unused; using a stable placeholder works for local dev but WalletConnect
  // modal popups will error out until a real id is supplied.
  "ucs-carbon-dev";

export const wagmiConfig = getDefaultConfig({
  appName: "UCS Carbon Trading",
  projectId,
  chains: [sepolia, mainnet, foundry],
  transports: {
    [sepolia.id]: http(sepoliaRpc),
    [mainnet.id]: http(),
    [foundry.id]: http("http://127.0.0.1:8545"),
  },
  ssr: false,
});
