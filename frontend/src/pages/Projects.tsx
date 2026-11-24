import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search, MapPin, BadgeCheck } from "lucide-react";
import { useAllProjects } from "@/hooks/useProjects";
import { useDeployment } from "@/hooks/useDeployment";
import { NotDeployed } from "@/components/NotDeployed";
import { EmptyState } from "@/components/EmptyState";
import { formatTonnes, shortAddress } from "@/lib/format";

export default function Projects() {
  const { addresses } = useDeployment();
  const { projects, isLoading } = useAllProjects();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) =>
      [p.name, p.location, p.methodology, String(p.vintageYear)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [q, projects]);

  if (!addresses) return <NotDeployed />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-world projects that capture or stop CO₂. Each one creates
            the carbon credits sold on this site.
          </p>
        </div>
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="input pl-9"
          />
        </div>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="card p-12 text-center text-sm text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={projects.length === 0 ? "No projects yet" : "Nothing matches your search"}
          description={
            projects.length === 0
              ? "Projects will show up here once the team adds them."
              : "Try clearing the search or using fewer words."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link
              key={String(p.id)}
              to={`/on-chain/projects/${p.id}`}
              className="card group flex flex-col gap-4 p-5 transition-colors hover:border-leaf-500/30 hover:bg-leaf-500/[0.04]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">
                    Project #{String(p.id)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-base font-semibold text-white">
                    {p.name}
                  </div>
                </div>
                {p.active ? (
                  <span className="chip border-leaf-500/30 bg-leaf-500/10 text-leaf-300">
                    <BadgeCheck className="h-3 w-3" /> active
                  </span>
                ) : (
                  <span className="chip text-slate-400">closed</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="chip">
                  <MapPin className="h-3 w-3" /> {p.location}
                </span>
                <span className="chip">Year {p.vintageYear}</span>
                <span className="chip">{p.methodology}</span>
              </div>
              <div className="mt-auto grid grid-cols-3 gap-2 border-t border-white/5 pt-4 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Made
                  </div>
                  <div className="mt-0.5 text-slate-200">{formatTonnes(p.totalIssued)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Spent
                  </div>
                  <div className="mt-0.5 text-slate-200">{formatTonnes(p.totalRetired)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Owner
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-200">
                    {shortAddress(p.developer)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
