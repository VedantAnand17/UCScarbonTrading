import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import { Leaf, Recycle, ArrowRight, AlertTriangle } from "lucide-react";
import type { Address } from "viem";
import { offsetRouterAbi } from "@/contracts";
import { useDeployment } from "@/hooks/useDeployment";
import { useOffsetRoute } from "@/hooks/useOffsetRoute";
import { useAllProjects } from "@/hooks/useProjects";
import { TxButton } from "./TxButton";
import { formatEth, formatTonnes } from "@/lib/format";

const PRESETS = [1n, 5n, 10n, 50n];

/// Hero "I want to offset N tonnes" widget. Auto-routes across the cheapest
/// active marketplace listings and atomically buys+retires through the
/// OffsetRouter so the user ends up with retirement certificates, not credits.
export function OffsetWidget({ onOffset }: { onOffset?: () => void }) {
  const { addresses } = useDeployment();
  const { address, isConnected } = useAccount();
  const [tonnesStr, setTonnesStr] = useState<string>("1");
  const [reason, setReason] = useState<string>("");
  const [beneficiaryStr, setBeneficiaryStr] = useState<string>("");
  const { writeContract, data: hash, isPending, reset } = useWriteContract();

  useEffect(() => {
    if (!beneficiaryStr && address) setBeneficiaryStr(address);
  }, [address, beneficiaryStr]);

  const tonnes = useMemo(() => {
    try {
      const n = BigInt(tonnesStr || "0");
      return n > 0n ? n : 0n;
    } catch {
      return 0n;
    }
  }, [tonnesStr]);

  const route = useOffsetRoute(tonnes);
  const { projects } = useAllProjects();
  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return (id: bigint) => map.get(String(id)) ?? `Project #${String(id)}`;
  }, [projects]);

  const beneficiary = (() => {
    const v = beneficiaryStr.trim();
    if (!v) return undefined;
    if (!/^0x[a-fA-F0-9]{40}$/.test(v)) return undefined;
    return v as Address;
  })();

  const ready =
    isConnected &&
    Boolean(addresses?.offsetRouter) &&
    tonnes > 0n &&
    route.steps.length > 0 &&
    route.shortfall === 0n &&
    Boolean(beneficiary);

  return (
    <div className="card relative overflow-hidden p-6 md:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-leaf-500/10 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div className="chip">
            <Leaf className="h-3 w-3 text-leaf-400" /> 1 credit = 1 tonne of CO₂
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Buy + spend · in one click
          </div>
        </div>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
          Buy &amp; spend carbon credits.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Pick how many credits you want. We find the cheapest ones for sale,
          buy them, and spend them in your name — all in a single payment.
          You keep the receipt forever.
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Left — input */}
          <div className="flex flex-col gap-4">
            <div>
              <label className="label">How many credits do you want?</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={tonnesStr}
                  onChange={(e) => setTonnesStr(e.target.value)}
                  className="input text-2xl font-semibold tabular-nums"
                />
                <div className="text-sm uppercase tracking-wider text-slate-500">
                  credits
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={String(p)}
                    type="button"
                    onClick={() => setTonnesStr(String(p))}
                    className="chip cursor-pointer hover:border-leaf-500/40 hover:text-leaf-200"
                  >
                    {String(p)} credits
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Whose name should the receipt be in? (yours by default)</label>
              <input
                type="text"
                value={beneficiaryStr}
                onChange={(e) => setBeneficiaryStr(e.target.value)}
                placeholder="0x… your wallet or someone else's"
                className="input font-mono text-xs"
              />
              {beneficiaryStr && !beneficiary && (
                <div className="mt-1 text-xs text-amber-300/80">
                  That doesn't look like a valid wallet address.
                </div>
              )}
            </div>

            <div>
              <label className="label">Add a note (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. my flight to Tokyo, March 2026"
                className="input"
                maxLength={120}
              />
            </div>
          </div>

          {/* Right — quote */}
          <div className="flex flex-col gap-4 rounded-xl border border-white/5 bg-slate-950/40 p-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Quote
                label="You pay"
                value={
                  route.totalCost > 0n ? `${formatEth(route.totalCost, 6)} ETH` : "—"
                }
              />
              <Quote
                label="Avg per credit"
                value={
                  route.avgPrice > 0n
                    ? `${formatEth(route.avgPrice, 6)} ETH`
                    : "—"
                }
              />
              <Quote
                label="Credits found"
                value={`${formatTonnes(route.totalTonnes)} / ${formatTonnes(tonnes)}`}
              />
              <Quote
                label="Sellers"
                value={String(route.steps.length)}
              />
            </div>

            {route.shortfall > 0n && tonnes > 0n && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span>
                  Only {formatTonnes(route.totalTonnes)} credits are for sale right
                  now. You're {formatTonnes(route.shortfall)} credits short. Try a
                  smaller amount or check back later.
                </span>
              </div>
            )}

            {route.steps.length > 0 && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02]">
                <div className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
                  Where your money goes ({route.steps.length} {route.steps.length === 1 ? "seller" : "sellers"})
                </div>
                <ul className="divide-y divide-white/5">
                  {route.steps.slice(0, 5).map((s) => (
                    <li
                      key={String(s.listing.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-slate-200">
                          {projectName(s.listing.tokenId)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">
                          Sale #{String(s.listing.id)} ·{" "}
                          {formatEth(s.listing.pricePerUnit, 6)} ETH each
                        </div>
                      </div>
                      <div className="text-right tabular-nums text-slate-300">
                        {formatTonnes(s.quantity)} credits
                      </div>
                    </li>
                  ))}
                  {route.steps.length > 5 && (
                    <li className="px-3 py-2 text-[11px] text-slate-500">
                      +{route.steps.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {!isConnected ? (
              <ConnectButton />
            ) : (
              <TxButton
                hash={hash}
                isWriting={isPending}
                disabled={!ready}
                onConfirmed={() => {
                  reset();
                  setTonnesStr("1");
                  setReason("");
                  toast.success(
                    `Spent ${formatTonnes(route.totalTonnes)} credits!`,
                  );
                  onOffset?.();
                }}
                onClick={() => {
                  if (!addresses || !beneficiary || route.steps.length === 0)
                    return;
                  const ids = route.steps.map((s) => s.listing.id);
                  const qty = route.steps.map((s) => s.quantity);
                  writeContract(
                    {
                      abi: offsetRouterAbi,
                      address: addresses.offsetRouter,
                      functionName: "offset",
                      args: [ids, qty, beneficiary, reason],
                      value: route.totalCost,
                    },
                    { onError: (e) => toast.error(e.message) },
                  );
                }}
              >
                <Recycle className="h-4 w-4" />
                Buy &amp; spend {tonnes > 0n ? `${formatTonnes(tonnes)} credits` : ""}
                <ArrowRight className="h-4 w-4" />
              </TxButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Quote({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-white tabular-nums">
        {value}
      </div>
    </div>
  );
}
