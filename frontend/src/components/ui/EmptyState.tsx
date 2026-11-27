import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The designed empty state of a list or panel: says what is true and what to do
 * next. Pass the fix as `action`. No mascot here: Nilo appears only on the
 * surfaces `brand.md` names.
 */
export function EmptyState({
  title,
  icon,
  children,
  action,
  className,
}: {
  title: string;
  /** A line icon that names the missing thing. The sentence under it teaches the trigger. */
  icon?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-(--gap-2) rounded-panel border border-dashed border-border-2 px-(--pad-4) py-(--pad-4)", className)}>
      {icon && <span className="text-fg-3">{icon}</span>}
      <p className="t-title text-fg-1">{title}</p>
      {children && <p className="max-w-[56ch] t-body text-fg-3">{children}</p>}
      {action}
    </div>
  );
}
