import { useMutation } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useAuth } from "./auth";
import { shortId } from "./format";
import type { Trade } from "./types";
import { InlineError } from "./ui";

export function AnchorProof({ trade, full = false }: { trade: Trade; full?: boolean }) {
  const { api } = useAuth();
  const verification = useMutation({ mutationFn: () => api.verify(trade.id) });
  const anchored = trade.status === "ANCHORED" || trade.anchor?.status === "CONFIRMED";
  const explorerUrl = trade.explorerUrl || (anchored && trade.anchor?.txHash
    ? `https://sepolia.etherscan.io/tx/${encodeURIComponent(trade.anchor.txHash)}`
    : null);

  return (
    <div className="anchor-proof">
      <dl className="hash-list">
        <div><dt>Trade hash</dt><dd><code title={trade.tradeHash}>{full ? trade.tradeHash : shortId(trade.tradeHash)}</code></dd></div>
        {full && trade.anchor?.txHash && <div><dt>Transaction hash</dt><dd><code>{trade.anchor.txHash}</code></dd></div>}
        {full && trade.anchor?.blockNumber != null && <div><dt>Sepolia block</dt><dd>{trade.anchor.blockNumber}</dd></div>}
      </dl>
      {anchored ? (
        <div className="record-actions">
          {explorerUrl && <a className="text-link" href={explorerUrl} target="_blank" rel="noreferrer">Sepolia explorer <ExternalLink aria-hidden="true" /></a>}
          <button
            className="p-button secondary"
            disabled={verification.isPending}
            onClick={() => verification.mutate()}
          >
            <ShieldCheck aria-hidden="true" />{verification.isPending ? "Verifying…" : "Verify on-chain"}
          </button>
        </div>
      ) : (
        <p className="quiet">{trade.status === "ANCHOR_FAILED" ? "The anchor failed and can be retried by an administrator." : "Proof will be available once the anchor is confirmed."}</p>
      )}
      {verification.isError && <InlineError error={verification.error} />}
      {verification.data && (
        <div className={`notice ${verification.data.match ? "notice-good" : "notice-error"}`} role="status">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>{verification.data.match ? "Match" : "Mismatch"}</strong>
            <p>{verification.data.match ? "The stored trade hash matches the Sepolia record." : "The stored trade hash differs from the Sepolia record."}</p>
            {full && (
              <dl className="hash-list">
                <div><dt>Stored hash</dt><dd><code>{verification.data.storedHash}</code></dd></div>
                <div><dt>On-chain hash</dt><dd><code>{verification.data.onChainHash}</code></dd></div>
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
