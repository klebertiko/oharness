import { cn } from "@/lib/utils";

export type StatusTone = "ok" | "warn" | "fault" | "busy" | "idle" | "off";

const TONE: Record<StatusTone, string> = {
  ok: "bg-signal",
  warn: "bg-warn",
  fault: "bg-fault",
  busy: "bg-ink-dim animate-pulse motion-reduce:animate-none",
  idle: "bg-ink-mute",
  off: "border border-ink-mute bg-transparent",
};

/**
 * The one state marker: an 8px square beside the word that names the state.
 * Decorative by construction (`aria-hidden`): the word carries the meaning, so
 * colour is never alone. `off` is hollow (nothing configured yet), the others
 * are filled; `busy` pulses and stops under reduced motion.
 */
export function StatusMark({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span aria-hidden className={cn("h-2 w-2 flex-none rounded-none", TONE[tone], className)} />;
}
