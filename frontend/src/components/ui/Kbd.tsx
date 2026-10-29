import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One keycap: squared, hairline, mono. Shortcut hints always use it. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-control border border-line bg-sub-200 px-1 font-mono text-meta text-ink-mute",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A chord as a row of keycaps, from the caps `chordCaps()` returns. */
export function KbdChord({ caps, className }: { caps: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {caps.map((c, i) => (
        <Kbd key={`${c}-${i}`}>{c}</Kbd>
      ))}
    </span>
  );
}
