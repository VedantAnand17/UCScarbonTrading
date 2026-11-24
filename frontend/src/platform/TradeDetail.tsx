import { ArrowLeft, Coins, Scale, CalendarClock } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { AnchorProof } from "./AnchorProof";
import { useAuth, usePlatformQuery } from "./auth";
import { formatCarbon, formatDateTime, formatInr, shortId } from "./format";
import { TradeStatus } from "./TradeStatus";
import { Metrics, PageHeading, Panel, QueryContent } from "./ui";

export function TradeDetail() {
  const id = useParams().id ?? "";
  const { identity } = useAuth();
  const trade = usePlatformQuery(`trade:${id}`, (api, signal) => api.trade(id, signal));
  const roles = identity.data?.roles ?? [];
  const { state } = useLocation();
  const fallback = roles.includes("BUYER") ? "/buyer" : roles.includes("GENERATOR") ? "/generator" : "/admin";
  const workspace = (state as { workspace?: string } | null)?.workspace;
  const back = workspace === "/buyer" || workspace === "/generator" || workspace === "/admin" ? workspace : fallback;

  return (
    <div className="dashboard">
      <Link className="text-link back-link" to={back}><ArrowLeft aria-hidden="true" /> Back to workspace</Link>
      <PageHeading title={`Trade ${shortId(id)}`} description="Settlement details and the Sepolia audit proof for this trade." />
      <QueryContent query={trade}>{(data) => (
        <>
          <Metrics items={[
            { label: "Carbon units", value: formatCarbon(data.amountG), icon: Scale },
            { label: "Total paid", value: formatInr(data.totalInr), icon: Coins },
            { label: "Settled at (IST)", value: formatDateTime(data.settledAt), icon: CalendarClock },
          ]} />
          <Panel title="Trade progress">
            <TradeStatus status={data.status} />
          </Panel>
          <Panel title="Anchor proof" description="Compare the stored trade hash with the hash recorded on Sepolia.">
            <AnchorProof key={data.id} trade={data} full />
          </Panel>
        </>
      )}</QueryContent>
    </div>
  );
}
