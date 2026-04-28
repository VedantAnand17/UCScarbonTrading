import { useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import toast from "react-hot-toast";
import { ShoppingCart, Tag } from "lucide-react";
import { marketplaceAbi } from "@/contracts";
import { useDeployment } from "@/hooks/useDeployment";
import { useActiveListings, type Listing } from "@/hooks/useListings";
import { useAllProjects } from "@/hooks/useProjects";
import { NotDeployed } from "@/components/NotDeployed";
import { ConnectGate } from "@/components/ConnectGate";
import { EmptyState } from "@/components/EmptyState";
import { TxButton } from "@/components/TxButton";
import { formatEth, formatTonnes, shortAddress } from "@/lib/format";

function BuyCard({
  listing,
  projectName,
  onAfterBuy,
}: {
  listing: Listing;
  projectName: string;
  onAfterBuy: () => void;
}) {
  const { addresses } = useDeployment();
  const { address } = useAccount();
  const [qty, setQty] = useState<string>("1");
  const { writeContract, data: hash, isPending, reset } = useWriteContract();

  const parsed = (() => {
    try {
      const n = BigInt(qty || "0");
      return n > 0n && n <= listing.remaining ? n : null;
    } catch {
      return null;
    }
  })();
  const total = parsed !== null ? parsed * listing.pricePerUnit : 0n;
  const isSeller = address?.toLowerCase() === listing.seller.toLowerCase();

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Sale #{String(listing.id)} · Project #{String(listing.tokenId)}
          </div>
          <div className="mt-1 text-base font-semibold text-white">{projectName}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            Sold by {shortAddress(listing.seller)}
          </div>
        </div>
        <span className="chip">
          <Tag className="h-3 w-3" /> {formatEth(listing.pricePerUnit, 6)} ETH each
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-y border-white/5 py-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Credits left</div>
          <div className="mt-0.5 text-slate-200">
            {formatTonnes(listing.remaining)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">You pay</div>
          <div className="mt-0.5 text-slate-200">{formatEth(total, 6)} ETH</div>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">How many credits?</label>
          <input
            type="number"
            min={1}
            max={String(listing.remaining)}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input"
          />
        </div>
        <TxButton
          hash={hash}
          isWriting={isPending}
          disabled={!addresses || !parsed || isSeller}
          onConfirmed={() => {
            reset();
            onAfterBuy();
          }}
          onClick={() => {
            if (!addresses || !parsed) return;
            writeContract(
              {
                abi: marketplaceAbi,
                address: addresses.marketplace,
                functionName: "buy",
                args: [listing.id, parsed],
                value: parsed * listing.pricePerUnit,
              },
              {
                onError: (e) => toast.error(e.message),
              },
            );
          }}
        >
          <ShoppingCart className="h-4 w-4" /> Buy
        </TxButton>
      </div>
      {isSeller && (
        <div className="text-xs text-amber-300/80">This is your own sale — you can't buy from yourself.</div>
      )}
    </div>
  );
}

export default function Marketplace() {
  const { addresses } = useDeployment();
  const { listings, isLoading, refetch } = useActiveListings();
  const { projects } = useAllProjects();

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return (id: bigint) => map.get(String(id)) ?? `Project #${String(id)}`;
  }, [projects]);

  if (!addresses) return <NotDeployed />;

  return (
    <ConnectGate
      title="Connect your wallet to buy"
      description="You need a wallet to buy carbon credits."
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Carbon credit market</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every credit for sale right now. Pay with ETH — the credits land
            in your wallet the moment you buy. 1 credit = 1 tonne of CO₂.
          </p>
        </div>

        {isLoading && listings.length === 0 ? (
          <div className="card p-12 text-center text-sm text-slate-400">Loading…</div>
        ) : listings.length === 0 ? (
          <EmptyState
            title="Nothing for sale right now"
            description="If you own credits, you can put them up for sale from My credits."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <BuyCard
                key={String(l.id)}
                listing={l}
                projectName={projectName(l.tokenId)}
                onAfterBuy={refetch}
              />
            ))}
          </div>
        )}
      </div>
    </ConnectGate>
  );
}

export function parseEthInput(s: string): bigint | null {
  try {
    return parseEther(s as `${number}`);
  } catch {
    return null;
  }
}
