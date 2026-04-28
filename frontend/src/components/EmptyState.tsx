import type { ReactNode } from "react";
import { Leaf } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-leaf-500/10 ring-1 ring-leaf-500/20">
        <Leaf className="h-5 w-5 text-leaf-400" />
      </div>
      <div className="text-base font-medium text-white">{title}</div>
      {description && (
        <div className="max-w-md text-sm text-slate-400">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
