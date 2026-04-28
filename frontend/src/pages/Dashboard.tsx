import { Link } from "react-router-dom";
import { ArrowRight, Leaf, Store, FolderKanban, Recycle } from "lucide-react";
import { useAllProjects } from "@/hooks/useProjects";
import { useActiveListings } from "@/hooks/useListings";
import { useDeployment } from "@/hooks/useDeployment";
import { NotDeployed } from "@/components/NotDeployed";
import { OffsetWidget } from "@/components/OffsetWidget";
import { RetirementFeed } from "@/components/RetirementFeed";
import { formatTonnes } from "@/lib/format";

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="card flex items-start justify-between gap-4 p-5">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="stat mt-2">{value}</div>
      </div>
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-leaf-500/10 ring-1 ring-leaf-500/20">
        <Icon className="h-5 w-5 text-leaf-400" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { addresses } = useDeployment();
  const { projects, isLoading, refetch: refetchProjects } = useAllProjects();
  const { listings, refetch: refetchListings } = useActiveListings();

  const totalIssued = projects.reduce((s, p) => s + p.totalIssued, 0n);
  const totalRetired = projects.reduce((s, p) => s + p.totalRetired, 0n);
  const circulating = totalIssued - totalRetired;

  if (!addresses) {
    return (
      <div className="space-y-6">
        <NotDeployed />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <OffsetWidget
        onOffset={async () => {
          await Promise.all([refetchProjects(), refetchListings()]);
        }}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Projects" value={isLoading ? "…" : String(projects.length)} icon={FolderKanban} />
        <Stat label="Credits made" value={formatTonnes(totalIssued)} icon={Leaf} />
        <Stat label="Credits spent" value={formatTonnes(totalRetired)} icon={Recycle} />
        <Stat label="On sale now" value={String(listings.length)} icon={Store} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-white">Latest projects</h2>
            <Link to="/projects" className="text-sm text-slate-400 hover:text-white">
              See all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {projects
              .slice()
              .reverse()
              .slice(0, 4)
              .map((p) => (
                <Link
                  key={String(p.id)}
                  to={`/projects/${p.id}`}
                  className="card group p-5 transition-colors hover:border-leaf-500/30 hover:bg-leaf-500/[0.04]"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-wider text-slate-500">
                      Project #{String(p.id)} · {p.vintageYear}
                    </div>
                    {p.active && (
                      <span className="chip border-leaf-500/30 bg-leaf-500/10 text-leaf-300">
                        active
                      </span>
                    )}
                  </div>
                  <div className="mt-2 line-clamp-2 text-base font-semibold text-white">
                    {p.name}
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{p.location}</div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
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
                  </div>
                </Link>
              ))}
          </div>
          {!isLoading && projects.length === 0 && (
            <div className="card mt-2 p-8 text-center text-sm text-slate-400">
              No projects added yet.
            </div>
          )}
        </div>

        <RetirementFeed limit={8} />
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Credits in circulation
          </div>
        </div>
        <div className="mt-2 text-3xl font-semibold text-white tabular-nums">
          {formatTonnes(circulating)} credits
        </div>
        <div className="mt-1 text-sm text-slate-400">
          Credits sitting in users' wallets right now — ready to be sold or
          spent. Each one is worth 1 tonne of CO₂.
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/marketplace" className="btn-secondary">
            Browse the market <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/portfolio" className="btn-secondary">
            My credits
          </Link>
        </div>
      </section>
    </div>
  );
}
