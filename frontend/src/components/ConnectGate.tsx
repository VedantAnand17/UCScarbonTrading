import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { EmptyState } from "./EmptyState";

/// Wraps pages/sections that require a connected wallet. Shows a clean
/// call-to-action when nobody is connected.
export function ConnectGate({
  children,
  title = "Connect your wallet",
  description = "Connect a wallet to start using the site.",
}: {
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const { isConnected } = useAccount();
  if (!isConnected) {
    return (
      <EmptyState
        title={title}
        description={description}
        action={<ConnectButton />}
      />
    );
  }
  return <>{children}</>;
}
