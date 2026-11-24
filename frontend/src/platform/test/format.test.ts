import { describe, expect, it } from "vitest";
import { formatCarbon, formatFlagReason, formatInr, kilogramsToGrams } from "../format";

describe("carbon units", () => {
  it.each([
    [0, "0 kgCO₂e"],
    ["1", "0.001 kgCO₂e"],
    ["1250", "1.25 kgCO₂e"],
    ["1250000", "1.25 tCO₂e"],
    ["3482650", "3.483 tCO₂e"],
    ["1636017", "1.636 tCO₂e"],
    ["-400", "-0.4 kgCO₂e"],
  ])("displays %s integer grams as %s", (grams, expected) => {
    expect(formatCarbon(grams)).toBe(expected);
  });

  it("converts purchase input exactly to integer grams", () => {
    expect(kilogramsToGrams("1.001")).toBe(1001);
    expect(kilogramsToGrams("0.0001")).toBeNull();
    expect(kilogramsToGrams("0")).toBeNull();
  });

  it("uses INR with Indian digit grouping", () => {
    expect(formatInr("123456.50")).toBe("₹1,23,456.50");
  });
});

describe("flag reasons", () => {
  it.each([
    ["kwh_interval exceeds plausible maximum of 0.125000 kWh", "Energy interval exceeds plausible maximum of 0.125 kWh"],
    ["cumulative meter value decreased", "Cumulative meter value decreased"],
    [null, "Validation flagged"],
  ])("formats %s", (reason, expected) => {
    expect(formatFlagReason(reason)).toBe(expected);
  });
});
