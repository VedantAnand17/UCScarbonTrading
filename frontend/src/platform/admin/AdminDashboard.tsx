import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Clock3, Radio, RefreshCw, Repeat2, Timer, Wallet } from "lucide-react";
import { useAuth, usePlatformQuery, useRefresh } from "../auth";
import { formatDateTime, formatFlagReason, formatNumber } from "../format";
import type { AdminOverview, Trade } from "../types";
import { Empty, InlineError, Metrics, PageHeading, Panel, QueryContent, TradeList } from "../ui";
import { AdminDevices } from "./Devices";
import { EmissionFactors } from "./EmissionFactors";

const lowWalletThreshold = 0.01;

function AnchorHealth({ health }: { health: AdminOverview["anchorHealth"] }) {
  const balance = health.walletBalanceEth;
  const low = balance !== null && Number(balance) < lowWalletThreshold;
  const walletFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 });
  return (
    <div className="anchor-health">
      <Metrics items={[
        { label: "Pending", value: formatNumber(health.pending), icon: Clock3 },
        { label: "In flight", value: formatNumber(health.inflight), icon: Timer },
        { label: "Confirmed", value: formatNumber(health.confirmed), icon: CircleCheck },
        { label: "Failed", value: formatNumber(health.failed), icon: CircleAlert },
      ]} />
      <div className="wallet-health">
        <span className="record-icon"><Wallet aria-hidden="true" /></span>
        <div><span className="record-meta">Sepolia wallet balance</span>
          <strong>{balance === null ? "Unavailable" : `${walletFormat.format(Number(balance))} ETH`}</strong>
        </div>
        {low && (
          <div className="notice notice-warn" role="status">
            <CircleAlert aria-hidden="true" />
            <span>Low wallet balance. Add Sepolia ETH to keep anchoring trades.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AnchorRetry({ trade }: { trade: Trade }) {
  const { api } = useAuth();
  const refresh = useRefresh();
  const retry = useMutation({
    mutationFn: () => api.retryAnchor(trade.id),
    onSuccess: () => refresh("admin-trades", "admin-overview", "my-trades", `trade:${trade.id}`),
  });
  const failed = trade.status === "ANCHOR_FAILED" || trade.anchor?.status === "FAILED";

  return (
    <>
      {failed && (
        <div className="record-actions retry-action">
          {trade.anchor?.lastError && <span className="quiet">{trade.anchor.lastError}</span>}
          <button className="p-button secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RefreshCw aria-hidden="true" />{retry.isPending ? "Queuing…" : "Retry anchor"}
          </button>
        </div>
      )}
      {retry.isError && <InlineError error={retry.error} />}
      {retry.isSuccess && !failed && <p className="quiet" role="status">Anchor retry queued.</p>}
    </>
  );
}

function FlaggedReadings() {
  const flagged = usePlatformQuery("flagged-readings", (api, signal) => api.flaggedReadings(signal));
  return (
    <Panel title="Flagged readings" description="Meter readings held back by validation checks.">
      <QueryContent query={flagged}>{(readings) => readings.length ? (
        <ul className="listing-list" role="list">
          {readings.map((reading) => (
            <li key={reading.id}>
              <div>
                <strong>{formatFlagReason(reading.flagReason)}</strong>
                <span className="record-meta">{reading.deviceId} · Reading {reading.seq}</span>
                <span className="record-meta">{formatDateTime(reading.receivedAt)}</span>
              </div>
              <span className="numeric">{formatNumber(reading.kwhInterval)} kWh</span>
            </li>
          ))}
        </ul>
      ) : <Empty>No readings are flagged for review.</Empty>}</QueryContent>
    </Panel>
  );
}

export function AdminDashboard() {
  const overview = usePlatformQuery("admin-overview", (api, signal) => api.overview(signal));
  const trades = usePlatformQuery("admin-trades", (api, signal) => api.allTrades(signal));
  return (
    <div className="dashboard">
      <PageHeading title="Platform administration" description="Monitor metering, settlements and the Sepolia anchoring service." />
      <QueryContent query={overview}>{(data) => (
        <Metrics items={[
          { label: "Devices", value: formatNumber(data.devices), icon: Radio },
          { label: "Flagged readings", value: formatNumber(data.flaggedReadings), icon: CircleAlert },
          { label: "Settled trades", value: formatNumber(data.trades), icon: Repeat2 },
        ]} />
      )}</QueryContent>
      <Panel title="Anchor health" description="Worker queue and wallet balance on Ethereum Sepolia.">
        <QueryContent query={overview}>{(data) => <AnchorHealth health={data.anchorHealth} />}</QueryContent>
      </Panel>
      <div className="dashboard-columns">
        <AdminDevices />
        <FlaggedReadings />
      </div>
      <Panel title="All trades" description="Inspect settlement progress and retry failed anchors.">
        <QueryContent query={trades}>{(data) => (
          <TradeList trades={data} empty="Trades will appear here after buyers settle a listing."
            action={(trade) => <AnchorRetry trade={trade} />} />
        )}</QueryContent>
      </Panel>
      <EmissionFactors />
    </div>
  );
}
