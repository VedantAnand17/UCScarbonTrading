import { useState } from "react";
import { useWriteContract } from "wagmi";
import { type Address } from "viem";
import toast from "react-hot-toast";
import { Shield, PlusCircle, Coins } from "lucide-react";
import { carbonCreditAbi, projectRegistryAbi } from "@/contracts";
import { useDeployment } from "@/hooks/useDeployment";
import { useAllProjects } from "@/hooks/useProjects";
import { useIsOwner } from "@/hooks/useIsOwner";
import { NotDeployed } from "@/components/NotDeployed";
import { ConnectGate } from "@/components/ConnectGate";
import { EmptyState } from "@/components/EmptyState";
import { TxButton } from "@/components/TxButton";
import { formatTonnes, shortAddress } from "@/lib/format";

function RegisterProjectForm({ onCreated }: { onCreated: () => void }) {
  const { addresses } = useDeployment();
  const { writeContract, data: hash, isPending, reset } = useWriteContract();

  const [developer, setDeveloper] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [methodology, setMethodology] = useState("");
  const [vintageYear, setVintageYear] = useState<string>(String(new Date().getFullYear()));
  const [metadataURI, setMetadataURI] = useState("");

  const valid =
    developer.startsWith("0x") &&
    developer.length === 42 &&
    name.trim().length > 0 &&
    location.trim().length > 0 &&
    methodology.trim().length > 0 &&
    Number(vintageYear) > 0;

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <PlusCircle className="h-4 w-4 text-leaf-400" />
        <h2 className="text-base font-semibold text-white">Add a new project</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Project owner address</label>
          <input
            className="input font-mono"
            placeholder="0x…"
            value={developer}
            onChange={(e) => setDeveloper(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kasigau Corridor REDD+"
          />
        </div>
        <div>
          <label className="label">Location</label>
          <input
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Kenya"
          />
        </div>
        <div>
          <label className="label">Method</label>
          <input
            className="input"
            value={methodology}
            onChange={(e) => setMethodology(e.target.value)}
            placeholder="VCS VM0009"
          />
        </div>
        <div>
          <label className="label">Year</label>
          <input
            className="input"
            type="number"
            value={vintageYear}
            onChange={(e) => setVintageYear(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Info link (IPFS or URL)</label>
          <input
            className="input font-mono"
            value={metadataURI}
            onChange={(e) => setMetadataURI(e.target.value)}
            placeholder="ipfs://…"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <TxButton
          hash={hash}
          isWriting={isPending}
          disabled={!addresses || !valid}
          onConfirmed={() => {
            reset();
            setDeveloper("");
            setName("");
            setLocation("");
            setMethodology("");
            setMetadataURI("");
            onCreated();
          }}
          onClick={() => {
            if (!addresses) return;
            writeContract(
              {
                abi: projectRegistryAbi,
                address: addresses.projectRegistry,
                functionName: "registerProject",
                args: [
                  developer as Address,
                  name,
                  location,
                  methodology,
                  Number(vintageYear),
                  metadataURI,
                ],
              },
              { onError: (e) => toast.error(e.message) },
            );
          }}
        >
          Add project
        </TxButton>
      </div>
    </div>
  );
}

function IssueCreditsRow({
  id,
  name,
  defaultTo,
  onIssued,
}: {
  id: bigint;
  name: string;
  defaultTo: Address | undefined;
  onIssued: () => void;
}) {
  const { addresses } = useDeployment();
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const [to, setTo] = useState<string>(defaultTo ?? "");
  const [amount, setAmount] = useState("");

  const parsedAmount = (() => {
    try {
      const n = BigInt(amount || "0");
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  })();
  const validTo = to.startsWith("0x") && to.length === 42;

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-white/5 px-5 py-4 last:border-0">
      <div className="flex-1">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">
          Project #{String(id)}
        </div>
        <div className="text-sm font-medium text-white">{name}</div>
      </div>
      <div>
        <label className="label">Send to</label>
        <input
          className="input w-80 font-mono"
          placeholder="0x…"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <div>
        <label className="label">How many</label>
        <input
          className="input w-32"
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <TxButton
        hash={hash}
        isWriting={isPending}
        disabled={!addresses || !parsedAmount || !validTo}
        onConfirmed={() => {
          reset();
          setAmount("");
          onIssued();
        }}
        onClick={() => {
          if (!addresses || !parsedAmount) return;
          writeContract(
            {
              abi: carbonCreditAbi,
              address: addresses.carbonCredit,
              functionName: "issue",
              args: [id, to as Address, parsedAmount],
            },
            { onError: (e) => toast.error(e.message) },
          );
        }}
      >
        <Coins className="h-4 w-4" /> Create
      </TxButton>
    </div>
  );
}

export default function Admin() {
  const { addresses } = useDeployment();
  const { isOwner, owner, isLoading: checkingOwner } = useIsOwner();
  const { projects, refetch } = useAllProjects();

  if (!addresses) return <NotDeployed />;

  return (
    <ConnectGate title="Connect the owner wallet to use admin">
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
              <Shield className="h-5 w-5 text-leaf-400" /> Admin
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Owner only. Add new projects and create new carbon credits.
            </p>
          </div>
          {owner && (
            <div className="text-right text-xs text-slate-400">
              <div>Owner wallet</div>
              <div className="font-mono text-slate-200">{shortAddress(owner)}</div>
            </div>
          )}
        </div>

        {checkingOwner ? (
          <div className="card p-10 text-center text-sm text-slate-400">Checking…</div>
        ) : !isOwner ? (
          <EmptyState
            title="You can't use this page"
            description="Only the team's owner wallet can use admin. Switch to that wallet to continue."
          />
        ) : (
          <>
            <RegisterProjectForm onCreated={refetch} />

            <div className="card overflow-hidden">
              <div className="border-b border-white/5 px-5 py-4">
                <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                  <Coins className="h-4 w-4 text-leaf-400" /> Create credits
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Mint new credits for a project. 1 credit = 1 tonne of CO₂.
                </p>
              </div>
              {projects.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-slate-400">
                  Add a project first.
                </div>
              ) : (
                <div className="text-sm">
                  <div className="grid grid-cols-[1fr_auto] gap-4 px-5 pt-4 text-xs font-medium uppercase tracking-wider text-slate-500">
                    <div>Project</div>
                    <div className="text-right">Made / Spent</div>
                  </div>
                  {projects.map((p) => (
                    <div key={String(p.id)}>
                      <IssueCreditsRow
                        id={p.id}
                        name={p.name}
                        defaultTo={p.developer}
                        onIssued={refetch}
                      />
                      <div className="-mt-2 px-5 pb-2 text-right text-xs text-slate-400">
                        {formatTonnes(p.totalIssued)} / {formatTonnes(p.totalRetired)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ConnectGate>
  );
}
