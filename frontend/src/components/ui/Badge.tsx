import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "signal" | "warn" | "fault";
export type BadgeRole = "agent" | "gate" | "hitl" | "skill" | "mcp" | "tool" | "decision";

const TONE: Record<BadgeTone, { text: string; dot: string }> = {
  neutral: { text: "text-ink-dim", dot: "bg-ink-mute" },
  signal: { text: "text-ink-dim", dot: "bg-signal" },
  warn: { text: "text-warn-text", dot: "bg-warn" },
  fault: { text: "text-fault-text", dot: "bg-fault" },
};

/** A status or role as a word with a marker. Never colour alone: it always carries text. */
export function Badge({
  tone = "neutral",
  role,
  children,
  className,
}: {
  tone?: BadgeTone;
  /** Graph node role; colours the marker with `--role-<name>`. */
  role?: BadgeRole;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-control border border-line-strong px-2 font-mono text-meta",
        t.text,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-2 w-2 flex-none rounded-none", role ? "bg-[var(--role)]" : t.dot)}
        style={role ? ({ "--role": `var(--role-${role})` } as CSSProperties) : undefined}
      />
      {children}
    </span>
  );
}
