import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The designed empty state of a list or panel: says what is true and what to do
 * next. Pass the fix as `action`. No mascot here: Nilo appears only on the
 * surfaces `brand.md` names.
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-panel border border-dashed border-line-strong px-4 py-4", className)}>
      <p className="t-title text-ink">{title}</p>
      {children && <p className="max-w-[56ch] text-body text-ink-mute">{children}</p>}
      {action}
    </div>
  );
}
