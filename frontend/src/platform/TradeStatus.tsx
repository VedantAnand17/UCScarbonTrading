import { Check, X } from "lucide-react";
import type { TradeStatusValue } from "./types";

const steps = [
  ["LISTED", "Listed"],
  ["RESERVED", "Reserved"],
  ["SETTLED", "Settled"],
  ["ANCHOR_PENDING", "Anchor pending"],
  ["ANCHORED", "Anchored"],
] as const;

export function TradeStatus({ status }: { status: TradeStatusValue }) {
  const failed = status === "ANCHOR_FAILED";
  const cancelled = status === "CANCELLED";
  const current = failed ? 3 : cancelled ? 1 : steps.findIndex(([value]) => value === status);

  return (
    <ol className="trade-progress" aria-label="Trade progress" role="list">
      {steps.map(([value, label], index) => {
        const atStep = index === current;
        const stopped = atStep && (failed || cancelled);
        const state = stopped ? "error" : index < current || status === "ANCHORED" ? "done" : atStep ? "current" : "next";
        return (
          <li key={value} data-state={state} aria-current={atStep ? "step" : undefined}>
            <span className="trade-step-dot" aria-hidden="true">
              {stopped ? <X /> : state === "done" ? <Check /> : null}
            </span>
            {stopped ? (failed ? "Anchor failed" : "Cancelled") : label}
          </li>
        );
      })}
    </ol>
  );
}
