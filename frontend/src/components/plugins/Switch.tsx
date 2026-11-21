"use client";
import { cn } from "@/lib/utils";

/**
 * An on/off control that acts at once: `role="switch"` with the state in `aria-checked`, named by `label`.
 * The thumb sits left (off) or right (on) and the track fills with the signal colour, so the state is never colour alone.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  busy = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Names the switch for assistive tech. */
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="inline-flex h-control-md w-control-md flex-none items-center justify-center rounded-control disabled:cursor-not-allowed disabled:opacity-45 max-sm:h-control-lg pointer-coarse:h-control-touch pointer-coarse:w-control-touch"
    >
      <span aria-hidden className={cn("relative h-4 w-8 rounded-control border transition-colors motion-reduce:transition-none", checked ? "border-signal bg-signal" : "border-line-strong bg-sub-200")}>
        <span className={cn("absolute top-px h-3 w-3 rounded-control transition-[left] motion-reduce:transition-none", checked ? "left-[calc(100%-0.8125rem)] bg-signal-ink" : "left-px bg-ink-dim")} />
      </span>
    </button>
  );
}
