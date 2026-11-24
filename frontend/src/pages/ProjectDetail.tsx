import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ExternalLink, MapPin } from "lucide-react";
import { useProject } from "@/hooks/useProjects";
import { useDeployment } from "@/hooks/useDeployment";
import { NotDeployed } from "@/components/NotDeployed";
import { formatTonnes, shortAddress } from "@/lib/format";

export default function ProjectDetail() {
  const { id } = useParams();
  const { addresses } = useDeployment();
  const projectId = id ? BigInt(id) : undefined;
  const { data, isLoading, error } = useProject(projectId);

  if (!addresses) return <NotDeployed />;

  const project = data as
    | {
        id: bigint;
        developer: `0x${string}`;
        name: string;
        location: string;
        methodology: string;
        vintageYear: number;
        totalIssued: bigint;
        totalRetired: bigint;
        metadataURI: string;
        active: boolean;
      }
    | undefined;

  return (
    <div className="space-y-6">
      <Link to="/on-chain/projects" className="btn-ghost -ml-2 text-sm">
        <ArrowLeft className="h-4 w-4" /> Back to projects
      </Link>

      {isLoading && (
        <div className="card p-12 text-center text-sm text-slate-400">Loading…</div>
      )}
      {error && (
        <div className="card border-red-500/30 bg-red-500/5 p-6 text-sm text-red-200">
          Couldn't load this project: {error.message}
        </div>
      )}

      {project && (
        <>
          <div className="card space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  Project #{String(project.id)}
                </div>
                <h1 className="mt-1 text-2xl font-semibold text-white">{project.name}</h1>
              </div>
              {project.active && (
                <span className="chip border-leaf-500/30 bg-leaf-500/10 text-leaf-300">
                  <BadgeCheck className="h-3 w-3" /> active
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="chip">
                <MapPin className="h-3 w-3" /> {project.location}
              </span>
              <span className="chip">Year {project.vintageYear}</span>
              <span className="chip">{project.methodology}</span>
              <span className="chip">Owner {shortAddress(project.developer)}</span>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4 md:grid-cols-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Total made
                </div>
                <div className="mt-1 text-xl font-semibold text-white">
                  {formatTonnes(project.totalIssued)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Total spent
                </div>
                <div className="mt-1 text-xl font-semibold text-white">
                  {formatTonnes(project.totalRetired)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  In circulation
                </div>
                <div className="mt-1 text-xl font-semibold text-white">
                  {formatTonnes(project.totalIssued - project.totalRetired)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Token
                </div>
                <div className="mt-1 font-mono text-sm text-slate-200">
                  ERC1155 · id {String(project.id)}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">More info</div>
            <div className="mt-2 break-all font-mono text-sm text-slate-200">
              {project.metadataURI || "—"}
            </div>
            {project.metadataURI?.startsWith("http") && (
              <a
                href={project.metadataURI}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary mt-4"
              >
                See details <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
