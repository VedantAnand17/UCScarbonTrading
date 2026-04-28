import { useMemo } from "react";
import { Recycle } from "lucide-react";
import { useRecentRetirements } from "@/hooks/useRetirements";
import { useAllProjects } from "@/hooks/useProjects";
import { formatTonnes, formatDate, shortAddress } from "@/lib/format";

export function RetirementFeed({ limit = 8 }: { limit?: number }) {
  const { retirements, isLoading } = useRecentRetirements(limit);
  const { projects } = useAllProjects();

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return (id: bigint) => map.get(String(id)) ?? `Project #${String(id)}`;
  }, [projects]);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf-500/10 ring-1 ring-leaf-500/20">
            <Recycle className="h-4 w-4 text-leaf-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Just spent</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              Live receipts
            </div>
          </div>
        </div>
      </div>

      {isLoading && retirements.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-slate-500">Loading…</div>
      ) : retirements.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-slate-500">
          No receipts yet. Be the first to spend a credit.
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {retirements.map((r) => (
            <li
              key={String(r.id)}
              className="flex items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-200">
                  {projectName(r.projectId)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Receipt #{String(r.id)} · for {shortAddress(r.beneficiary)}
                  {r.reason ? ` · ${r.reason}` : ""}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                  {formatDate(r.timestamp)}
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="text-sm font-semibold text-leaf-300 tabular-nums">
                  −{formatTonnes(r.amount)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  credits spent
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
