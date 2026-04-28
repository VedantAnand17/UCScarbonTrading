import { useState } from "react";
import { useWriteContract } from "wagmi";
import { parseEther, type Address } from "viem";
import toast from "react-hot-toast";
import { Lock, Recycle, ShoppingBag, Tag } from "lucide-react";
import { carbonCreditAbi, marketplaceAbi } from "@/contracts";
import { useDeployment } from "@/hooks/useDeployment";
import { useUserBalances, useUserRetirements, type Balance } from "@/hooks/usePortfolio";
import { useMarketApproval } from "@/hooks/useMarketApproval";
import { NotDeployed } from "@/components/NotDeployed";
import { ConnectGate } from "@/components/ConnectGate";
import { EmptyState } from "@/components/EmptyState";
import { TxButton } from "@/components/TxButton";
import { formatDate, formatTonnes, shortAddress } from "@/lib/format";

function ApproveBanner() {
  const { approved, isApproving, approve, hash, isLoaded } = useMarketApproval();

  if (!isLoaded || approved) return null;

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-leaf-500/20 bg-leaf-500/[0.04] p-4 text-sm">
      <div>
        <div className="font-medium text-leaf-100">Let the market handle your credits (one-time)</div>
        <div className="text-leaf-100/70">
          Before you can sell, give the market permission to move your credits
          when someone buys. You only do this once, ever.
        </div>
      </div>
      <TxButton
        hash={hash}
        isWriting={isApproving}
        onClick={() => {
          try {
            approve();
          } catch (e: any) {
            toast.error(e?.message ?? "Approval failed");
          }
        }}
      >
        Allow
      </TxButton>
    </div>
  );
}

function BalanceRow({ b, onAction }: { b: Balance; onAction: () => void }) {
  const { addresses, user } = useDeployment();
  const { approved, isApproving, approve, hash: approveHash } = useMarketApproval();
  const [mode, setMode] = useState<"none" | "retire" | "list">("none");

  const [retireAmount, setRetireAmount] = useState("");
  const [retireBeneficiary, setRetireBeneficiary] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const retireWrite = useWriteContract();

  const [listAmount, setListAmount] = useState("");
  const [listPrice, setListPrice] = useState(""); // ETH per unit
  const listWrite = useWriteContract();

  const parsedRetire = (() => {
    try {
      const n = BigInt(retireAmount || "0");
      return n > 0n && n <= b.balance ? n : null;
    } catch {
      return null;
    }
  })();
  const parsedListAmount = (() => {
    try {
      const n = BigInt(listAmount || "0");
      return n > 0n && n <= b.balance ? n : null;
    } catch {
      return null;
    }
  })();
  const parsedPrice = (() => {
    try {
      return parseEther((listPrice || "0") as `${number}`);
    } catch {
      return 0n;
    }
  })();

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Project #{String(b.project.id)} · Year {b.project.vintageYear}
          </div>
          <div className="mt-1 text-base font-semibold text-white">{b.project.name}</div>
          <div className="mt-0.5 text-xs text-slate-400">{b.project.location}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">You own</div>
          <div className="text-2xl font-semibold text-white">
            {formatTonnes(b.balance)}{" "}
            <span className="text-xs font-normal text-slate-400">credits</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          className={mode === "retire" ? "btn-primary" : "btn-secondary"}
          onClick={() => setMode(mode === "retire" ? "none" : "retire")}
        >
          <Recycle className="h-4 w-4" /> Spend
        </button>
        <button
          className={mode === "list" ? "btn-primary" : "btn-secondary"}
          onClick={() => setMode(mode === "list" ? "none" : "list")}
        >
          <Tag className="h-4 w-4" /> Sell
        </button>
      </div>

      {mode === "retire" && (
        <div className="mt-4 grid gap-3 border-t border-white/5 pt-4 md:grid-cols-3">
          <div>
            <label className="label">How many credits?</label>
            <input
              className="input"
              type="number"
              min={1}
              max={String(b.balance)}
              value={retireAmount}
              onChange={(e) => setRetireAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Whose name on the receipt?</label>
            <input
              className="input font-mono"
              placeholder={user ?? "0x…"}
              value={retireBeneficiary}
              onChange={(e) => setRetireBeneficiary(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input
              className="input"
              placeholder="e.g. my flight to Tokyo"
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <TxButton
              hash={retireWrite.data}
              isWriting={retireWrite.isPending}
              disabled={!addresses || !user || !parsedRetire}
              onConfirmed={() => {
                retireWrite.reset();
                setMode("none");
                setRetireAmount("");
                setRetireBeneficiary("");
                setRetireReason("");
                onAction();
              }}
              onClick={() => {
                if (!addresses || !user || !parsedRetire) return;
                const beneficiary = (retireBeneficiary || user) as Address;
                retireWrite.writeContract(
                  {
                    abi: carbonCreditAbi,
                    address: addresses.carbonCredit,
                    functionName: "retire",
                    args: [b.project.id, parsedRetire, beneficiary, retireReason || ""],
                  },
                  { onError: (e) => toast.error(e.message) },
                );
              }}
            >
              Spend forever
            </TxButton>
          </div>
        </div>
      )}

      {mode === "list" && (
        <div className="mt-4 grid gap-3 border-t border-white/5 pt-4 md:grid-cols-3">
          <div>
            <label className="label">How many credits?</label>
            <input
              className="input"
              type="number"
              min={1}
              max={String(b.balance)}
              value={listAmount}
              onChange={(e) => setListAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Price per credit (ETH)</label>
            <input
              className="input"
              type="text"
              placeholder="0.01"
              value={listPrice}
              onChange={(e) => setListPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Total price</label>
            <div className="input flex items-center">
              {parsedListAmount && parsedPrice > 0n
                ? `${Number(parsedListAmount) * Number(listPrice || "0")} ETH`
                : "—"}
            </div>
          </div>
          {!approved && (
            <div className="md:col-span-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-100/80">
              <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                One-time setup: give the market permission to move your credits
                when someone buys. You only do this once, ever.
              </span>
            </div>
          )}
          <div className="md:col-span-3 flex justify-end">
            {!approved ? (
              <TxButton
                hash={approveHash}
                isWriting={isApproving}
                disabled={!addresses}
                onClick={() => {
                  try {
                    approve();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Approval failed");
                  }
                }}
              >
                <Lock className="h-4 w-4" /> Allow market (1-time)
              </TxButton>
            ) : (
              <TxButton
                hash={listWrite.data}
                isWriting={listWrite.isPending}
                disabled={!addresses || !parsedListAmount || parsedPrice <= 0n}
                onConfirmed={() => {
                  listWrite.reset();
                  setMode("none");
                  setListAmount("");
                  setListPrice("");
                  onAction();
                }}
                onClick={() => {
                  if (!addresses || !parsedListAmount) return;
                  listWrite.writeContract(
                    {
                      abi: marketplaceAbi,
                      address: addresses.marketplace,
                      functionName: "createListing",
                      args: [
                        addresses.carbonCredit,
                        b.project.id,
                        parsedListAmount,
                        parsedPrice,
                      ],
                    },
                    { onError: (e) => toast.error(e.message) },
                  );
                }}
              >
                <ShoppingBag className="h-4 w-4" /> Put on sale
              </TxButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Portfolio() {
  const { addresses } = useDeployment();
  const { balances, isLoading, refetch } = useUserBalances();
  const { retirements, isLoading: loadingRets, refetch: refetchRets } = useUserRetirements();

  if (!addresses) return <NotDeployed />;

  const onAction = async () => {
    await refetch();
    await refetchRets();
  };

  return (
    <ConnectGate title="Connect your wallet to see your credits">
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">My credits</h1>
          <p className="mt-1 text-sm text-slate-400">
            Everything in your wallet: credits you own, credits you've put up
            for sale, and receipts for credits you've already spent.
          </p>
        </div>

        <ApproveBanner />

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-white">Credits you own</h2>
          {isLoading && balances.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-400">Loading…</div>
          ) : balances.length === 0 ? (
            <EmptyState
              title="You don't own any credits yet"
              description="Buy some from the market, or wait for the team to send you a starter pack."
            />
          ) : (
            <div className="grid gap-4">
              {balances.map((b) => (
                <BalanceRow key={String(b.project.id)} b={b} onAction={onAction} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold text-white">Receipts (credits you've spent)</h2>
          {loadingRets && retirements.length === 0 ? (
            <div className="card p-10 text-center text-sm text-slate-400">
              Loading…
            </div>
          ) : retirements.length === 0 ? (
            <div className="card p-6 text-sm text-slate-400">
              No receipts yet. When you spend credits, they get used up forever
              and a permanent receipt shows up here — with the date, amount,
              and your note.
            </div>
          ) : (
            <div className="card divide-y divide-white/5">
              {retirements
                .slice()
                .reverse()
                .map((r) => (
                  <div
                    key={String(r.id)}
                    className="flex flex-wrap items-center justify-between gap-4 p-5 text-sm"
                  >
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500">
                        Receipt #{String(r.id)} · Project #{String(r.projectId)}
                      </div>
                      <div className="mt-1 font-medium text-white">
                        {formatTonnes(r.amount)} credits spent
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        For {shortAddress(r.beneficiary)}
                        {r.reason ? ` · "${r.reason}"` : ""}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      {formatDate(r.timestamp)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </ConnectGate>
  );
}
