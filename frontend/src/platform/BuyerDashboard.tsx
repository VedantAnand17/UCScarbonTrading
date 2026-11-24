import { useMutation } from "@tanstack/react-query";
import { Check, Store } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AnchorProof } from "./AnchorProof";
import { ApiError } from "./api";
import { useAuth, usePlatformQuery, useRefresh } from "./auth";
import { Dialog } from "./Dialog";
import { formatCarbon, formatDate, formatInr, kilogramsToGrams } from "./format";
import type { OpenListing, Trade } from "./types";
import { Empty, InlineError, PageHeading, Panel, QueryContent, TradeList } from "./ui";

function Purchase({ listing, available, close, onPurchase }: {
  listing: OpenListing; available: OpenListing | undefined; close: () => void; onPurchase: (trade: Trade) => void;
}) {
  const { api } = useAuth();
  const refresh = useRefresh();
  const [amount, setAmount] = useState("");
  const grams = kilogramsToGrams(amount);
  const remaining = available?.remainingG ?? 0;
  const price = available?.priceInrPerKg ?? listing.priceInrPerKg;
  const canBuy = grams !== null && BigInt(grams) <= BigInt(remaining);
  const buy = useMutation({
    mutationFn: (amountG: number) => api.buy(listing.id, amountG),
    onSuccess: (trade) => {
      void refresh("market", "my-trades", "generator-summary", "my-listings", "admin-overview", "admin-trades");
      onPurchase(trade);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await refresh("market");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canBuy && !buy.isPending) buy.mutate(grams);
  }

  return (
    <Dialog title="Buy carbon units" close={close} busy={buy.isPending}>
      <form className="platform-form" onSubmit={submit}>
        <div className="form-summary">
          <strong>{listing.sellerOrgName}</strong>
          <span>{formatCarbon(remaining)} available · {formatInr(price)} per kg</span>
        </div>
        <label>Amount (kgCO₂e)
          <input type="number" inputMode="decimal" min="0.001" step="0.001" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        {grams !== null && !canBuy && <p className="quiet">{formatCarbon(remaining)} available</p>}
        <div className="purchase-total"><span>Estimated total</span><strong>{formatInr((grams ?? 0) / 1000 * Number(price))}</strong></div>
        {buy.error && (buy.error instanceof ApiError && buy.error.status === 409
          ? <InlineError>Availability changed before your purchase could settle. Check the remaining amount and try again.</InlineError>
          : <InlineError error={buy.error} />)}
        <div className="dialog-actions">
          <button className="p-button secondary" type="button" onClick={close} disabled={buy.isPending}>Cancel</button>
          <button className="p-button primary" type="submit" disabled={!canBuy || buy.isPending}>
            {buy.isPending ? "Purchasing…" : "Confirm purchase"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function BuyerDashboard() {
  const { identity } = useAuth();
  const organisation = identity.data?.organisationId;
  const market = usePlatformQuery("market", (api, signal) => api.listings(signal));
  const trades = usePlatformQuery("my-trades", (api, signal) => api.myTrades(signal));
  const [selected, select] = useState<OpenListing>();
  const [receipt, setReceipt] = useState<Trade>();

  return (
    <div className="dashboard">
      <PageHeading title="Carbon marketplace" description="Buy carbon units from verified meter readings and track the settlement on Sepolia." />
      {receipt && (
        <div className="notice notice-good" role="status">
          <Check aria-hidden="true" /><div><strong>Purchase settled.</strong> <Link className="text-link" to={`/trades/${encodeURIComponent(receipt.id)}`} state={{ workspace: "/buyer" }}>View trade</Link></div>
        </div>
      )}
      <Panel title="Open listings" description="Prices are quoted per kilogram of carbon dioxide equivalent.">
        <QueryContent query={market}>{(listings) => listings.length ? (
          <ul className="market-list" role="list">
            {listings.map((listing) => (
              <li key={listing.id} className="market-row">
                <div className="record-name">
                  <span className="record-icon"><Store aria-hidden="true" /></span>
                  <div><strong>{listing.sellerOrgName}</strong><span className="record-meta">Listed {formatDate(listing.createdAt)}</span></div>
                </div>
                <div className="market-volume"><span>Available</span><strong>{formatCarbon(listing.remainingG)}</strong></div>
                <div className="market-price"><span>Price per kg</span><strong>{formatInr(listing.priceInrPerKg)}</strong></div>
                <button className="p-button primary" onClick={() => { setReceipt(undefined); select(listing); }}>Buy units</button>
              </li>
            ))}
          </ul>
        ) : <Empty>There are no open listings. Check back as generators list new units.</Empty>}</QueryContent>
      </Panel>
      <Panel title="My purchases" description="Review settlements and verify the hash of each anchored trade.">
        <QueryContent query={trades}>{(items) => (
          <TradeList trades={items.filter((trade) => trade.buyerOrgId === organisation)} organisationId={organisation}
            empty="Your purchases will appear here after settlement." action={(trade) => <AnchorProof trade={trade} />} />
        )}</QueryContent>
      </Panel>
      {selected && <Purchase
        listing={selected}
        available={market.data?.find((listing) => listing.id === selected.id)}
        close={() => select(undefined)}
        onPurchase={(trade) => { select(undefined); setReceipt(trade); }}
      />}
    </div>
  );
}
