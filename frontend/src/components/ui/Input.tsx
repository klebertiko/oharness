"use client";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Helper text under the field. Replaced by `error` when both are set. */
  hint?: string;
  /** Error message; sets aria-invalid and is announced. */
  error?: string;
  /** Machine data (keys, ids, paths): set in IBM Plex Mono. */
  mono?: boolean;
  /** A standalone filter or search field: no reserved message row. Forms keep the row so an error never shifts the layout. */
  compact?: boolean;
  /** Class for the wrapper; the field itself is styled by the system. */
  className?: string;
}

/**
 * A labelled field. The message row always reserves one line, so an error never
 * shifts the layout (experience.md: cumulative layout shift stays at 0).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono = false, compact = false, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const msgId = `${fieldId}-msg`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {label && (
        <label htmlFor={fieldId} className="text-body font-medium text-ink-dim">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={compact ? undefined : msgId}
        className={cn(
          "h-control-md w-full rounded-control border border-line-strong bg-sub-100 px-2 text-ink transition-colors max-sm:h-control-lg",
          "placeholder:text-ink-mute hover:bg-sub-200 focus-visible:border-signal disabled:cursor-not-allowed disabled:opacity-45",
          "aria-invalid:border-fault",
          mono ? "font-mono text-code" : "text-body",
        )}
        {...rest}
      />
      {!compact && (
        <div
          id={msgId}
          role={error ? "alert" : undefined}
          className={cn("min-h-4 text-meta leading-4", error ? "text-fault-text" : "text-ink-mute")}
        >
          {error ?? hint ?? ""}
        </div>
      )}
    </div>
  );
});
