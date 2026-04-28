import { formatEther } from "viem";

export function shortAddress(addr: string | undefined): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatEth(wei: bigint | undefined, precision = 4): string {
  if (wei === undefined) return "—";
  const s = formatEther(wei);
  const [whole, frac = ""] = s.split(".");
  if (!frac) return whole;
  return `${whole}.${frac.slice(0, precision).replace(/0+$/, "") || "0"}`;
}

export function formatTonnes(n: bigint | undefined): string {
  if (n === undefined) return "—";
  return n.toLocaleString();
}

export function formatDate(unix: bigint | number | undefined): string {
  if (unix === undefined) return "—";
  const d = new Date(Number(unix) * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
