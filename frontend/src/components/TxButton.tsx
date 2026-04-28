import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useWaitForTransactionReceipt } from "wagmi";
import { shortAddress } from "@/lib/format";

/// A submit button that listens for a tx hash and surfaces toast notifications
/// for pending / success / revert. Accepts either a hash + writing state from
/// a single wagmi `useWriteContract` call or a generic onClick for custom
/// flows. Fires `onConfirmed` once the receipt is mined successfully.
export function TxButton({
  hash,
  isWriting,
  disabled,
  onClick,
  onConfirmed,
  children,
  variant = "primary",
  type = "button",
}: {
  hash?: `0x${string}`;
  isWriting?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onConfirmed?: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  const { data: receipt, isLoading: isMining, isSuccess, isError, error } =
    useWaitForTransactionReceipt({
      hash,
      query: { enabled: Boolean(hash) },
    });

  useEffect(() => {
    if (!hash) return;
    toast.loading(`Transaction submitted: ${shortAddress(hash)}`, { id: hash });
  }, [hash]);

  useEffect(() => {
    if (!hash) return;
    if (isSuccess) {
      toast.success("Confirmed", { id: hash, duration: 4000 });
      onConfirmed?.();
    } else if (isError) {
      toast.error(error?.message ?? "Transaction failed", {
        id: hash,
        duration: 6000,
      });
    }
  }, [isSuccess, isError, hash, error, onConfirmed]);

  const busy = Boolean(isWriting || (hash && isMining && !receipt));
  const className = variant === "primary" ? "btn-primary" : "btn-secondary";

  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={onClick}
      className={className}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
