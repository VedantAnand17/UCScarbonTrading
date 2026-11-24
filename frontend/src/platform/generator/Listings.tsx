import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError } from "../api";
import { useAuth, usePlatformQuery, useRefresh } from "../auth";
import { Dialog } from "../Dialog";
import { formatCarbon, formatDate, formatInr, kilogramsToGrams } from "../format";
import type { Listing, Measurement } from "../types";
import { Empty, InlineError, QueryContent, StatusPill } from "../ui";

export function ListingControls({ availableG, onCreated, close }: {
  availableG: Measurement; onCreated: () => void; close: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const { api } = useAuth();
  const refresh = useRefresh();
  const create = useMutation({
    mutationFn: ({ grams, priceInrPerKg }: { grams: number; priceInrPerKg: number }) =>
      api.createListing(grams, priceInrPerKg),
    onSuccess: () => {
      void refresh("generator-summary", "my-listings", "market");
      onCreated();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) await refresh("generator-summary");
    },
  });
  const grams = kilogramsToGrams(amount);
  const priceInrPerKg = Number(price);
  const canSubmit = grams !== null && BigInt(grams) <= BigInt(availableG) && Number.isFinite(priceInrPerKg) && priceInrPerKg > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit && !create.isPending) create.mutate({ grams, priceInrPerKg });
  }

  return (
    <Dialog title="Create listing" close={close} busy={create.isPending}>
      <form className="platform-form" onSubmit={submit}>
        <div className="form-summary"><strong>{formatCarbon(availableG)} available</strong><span>Listed units stay reserved until they sell or you cancel.</span></div>
        <label>Amount (kgCO₂e)<input type="number" inputMode="decimal" min="0.001" step="0.001" required
          value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Price per kg (₹)<input type="number" inputMode="decimal" min="0.01" step="0.01" required
          value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        {grams !== null && BigInt(grams) > BigInt(availableG) && <p className="quiet">Enter an amount up to {formatCarbon(availableG)}.</p>}
        {create.error && <InlineError error={create.error} />}
        <div className="dialog-actions">
          <button type="button" className="p-button secondary" onClick={close} disabled={create.isPending}>Cancel</button>
          <button type="submit" className="p-button primary" disabled={!canSubmit || create.isPending}>
            {create.isPending ? "Creating…" : "Create listing"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MyListings() {
  const { api } = useAuth();
  const refresh = useRefresh();
  const listings = usePlatformQuery("my-listings", (client, signal) => client.myListings(signal));
  const [selection, select] = useState<Listing>();
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelListing(id),
    onSuccess: async () => { await refresh("my-listings", "generator-summary", "market"); select(undefined); },
  });

  return (
    <>
      <QueryContent query={listings}>{(data) => data.length ? (
        <ul className="listing-list" role="list">
          {data.map((listing) => (
            <li key={listing.id}>
              <div><strong>{formatCarbon(listing.amountG)}</strong> <StatusPill tone={listing.status === "LISTED" ? "good" : "neutral"}>
                {listing.status.toLowerCase()}
              </StatusPill>
                <span className="record-meta">{formatInr(listing.priceInrPerKg)} per kg · {formatDate(listing.createdAt)}</span>
                {listing.status === "LISTED" && <span className="record-meta">{formatCarbon(listing.remainingG)} remaining</span>}
              </div>
              {listing.status === "LISTED" && <button className="p-button secondary" onClick={() => {
                cancel.reset(); select(listing);
              }}>Cancel listing</button>}
            </li>
          ))}
        </ul>
      ) : <Empty>Use Create listing to offer available units to buyers.</Empty>}</QueryContent>
      {selection && (
        <Dialog title="Cancel listing?" close={() => select(undefined)} busy={cancel.isPending}>
          <div className="platform-form">
            <p>The remaining {formatCarbon(selection.remainingG)} will return to your available balance.</p>
            {cancel.error && <InlineError error={cancel.error} />}
            <div className="dialog-actions">
              <button className="p-button secondary" onClick={() => select(undefined)} disabled={cancel.isPending}>Keep listing</button>
              <button className="p-button danger" onClick={() => cancel.mutate(selection.id)} disabled={cancel.isPending}>
                {cancel.isPending ? "Cancelling…" : "Cancel listing"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
