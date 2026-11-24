import { AlertCircle, ArrowUpRight, ArrowDownRight, Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "./api";
import { formatCarbon, formatDateTime, formatInr, shortId } from "./format";
import { TradeStatus } from "./TradeStatus";
import type { Trade } from "./types";
import { Link, useLocation } from "react-router-dom";

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
  );
}

export function Panel({ title, description, action, children }: {
  title: string; description?: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="platform-panel">
      <header className="panel-head">
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Metrics({ items }: { items: { label: string; value: ReactNode; icon: LucideIcon }[] }) {
  return (
    <dl className="metric-strip">
      {items.map(({ label, value, icon: Icon }) => (
        <div className="metric" key={label}>
          <dt><Icon aria-hidden="true" />{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineError({ error, children }: { error?: unknown; children?: ReactNode }) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{children ?? errorMessage(error)}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="platform-empty"><Inbox aria-hidden="true" /><p>{children}</p></div>;
}

export function Loading({ label = "Loading data" }: { label?: string }) {
  return (
    <div className="platform-loading" role="status">
      <span className="sr-only">{label}</span>
      <span /><span /><span />
    </div>
  );
}

export function QueryContent<T>({ query, children }: {
  query: { data?: T; isPending: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  return (
    <>
      {query.error ? (
        <div className="query-error">
          <InlineError error={query.error} />
          <button className="p-button secondary" onClick={() => { void query.refetch(); }}>Try again</button>
        </div>
      ) : null}
      {query.data === undefined ? null : children(query.data)}
    </>
  );
}

export function StatusPill({ children, tone = "neutral" }: {
  children: ReactNode; tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

export function DevicePill({ status }: { status: string }) {
  const value = status.toLowerCase();
  const tone = ["online", "active"].includes(value) ? "good" : value === "revoked" ? "bad" : "neutral";
  return <StatusPill tone={tone}>{status.replaceAll("_", " ").toLowerCase()}</StatusPill>;
}

export function TradeList({ trades, empty, organisationId, action }: {
  trades: Trade[]; empty: string; organisationId?: string; action?: (trade: Trade) => ReactNode;
}) {
  const { pathname } = useLocation();
  if (!trades.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="trade-list" role="list">
      {trades.map((trade) => {
        const sale = trade.sellerOrgId === organisationId;
        const Icon = sale ? ArrowUpRight : ArrowDownRight;
        return (
          <li className="trade-row" key={trade.id}>
            <div className="trade-row-head">
              <div className="record-name">
                <span className="record-icon"><Icon aria-hidden="true" /></span>
                <div>
                  <Link className="text-link" to={`/trades/${encodeURIComponent(trade.id)}`} state={{ workspace: pathname }}>
                    {organisationId ? (sale ? "Sale" : "Purchase") : "Trade"} <span className="numeric">{shortId(trade.id)}</span>
                  </Link>
                  <span className="record-meta">{formatDateTime(trade.settledAt)}</span>
                </div>
              </div>
              <div className="trade-amount">
                <strong>{formatCarbon(trade.amountG)}</strong>
                <span>{formatInr(trade.totalInr)}</span>
              </div>
            </div>
            <TradeStatus status={trade.status} />
            {action?.(trade)}
          </li>
        );
      })}
    </ul>
  );
}
