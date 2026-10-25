import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warn" | "fault";

const TONE: Record<NoticeTone, { Icon: typeof Info; box: string; text: string }> = {
  info: { Icon: Info, box: "border-line bg-sub-200", text: "text-ink-dim" },
  warn: { Icon: AlertTriangle, box: "border-warn bg-[color-mix(in_oklab,var(--warn)_10%,transparent)]", text: "text-warn-text" },
  fault: { Icon: CircleAlert, box: "border-fault bg-[color-mix(in_oklab,var(--fault)_10%,transparent)]", text: "text-fault-text" },
};

/**
 * A message with an icon and a word, never colour alone. Say what happened and
 * what the person can do next; put the fix in `action`. Faults are announced
 * (`role="alert"`), the rest politely (`role="status"`).
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  role,
  className,
}: {
  /** Override the announcement: faults are `alert` by default, the rest `status`. */
  role?: "alert" | "status";
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { Icon, box, text } = TONE[tone];
  return (
    <div role={role ?? (tone === "fault" ? "alert" : "status")} className={cn("flex items-start gap-2 rounded-control border px-3 py-2 text-body", box, className)}>
      <Icon aria-hidden size={14} className={cn("mt-0.5 flex-none", text)} />
      <div className="min-w-0 flex-1">
        {title && <p className={cn("font-medium", tone === "info" ? "text-ink" : text)}>{title}</p>}
        {children && <div className="text-ink-dim">{children}</div>}
      </div>
      {action && <div className="flex flex-none items-center">{action}</div>}
    </div>
  );
}
