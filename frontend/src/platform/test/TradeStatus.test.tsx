import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TradeStatus } from "../TradeStatus";

describe("trade progress", () => {
  it("shows all five steps and marks the current step", () => {
    render(<TradeStatus status="SETTLED" />);
    const steps = within(screen.getByRole("list", { name: "Trade progress" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Listed", "Reserved", "Settled", "Anchor pending", "Anchored",
    ]);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
  });

  it("shows an anchor failure after settlement", () => {
    render(<TradeStatus status="ANCHOR_FAILED" />);
    expect(screen.getByText("Anchor failed")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Anchored")).not.toHaveAttribute("aria-current");
  });
});
