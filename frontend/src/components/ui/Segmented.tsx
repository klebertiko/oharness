"use client";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Tooltip with the consequence of this choice. */
  hint?: string;
  disabled?: boolean;
}

/**
 * A single-choice control as a radio group: one tab stop, arrow keys move the
 * choice, `aria-checked` says which is on. Replaces rows of plain buttons that
 * said nothing about which one was active.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Names the group for assistive tech. */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);

  const move = (from: number, step: number) => {
    const at = enabled.findIndex((o) => o.value === options[from].value);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current[options.findIndex((o) => o.value === next.value)]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i, -1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-control border border-line-strong bg-sub-100 p-px", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            disabled={o.disabled}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "h-control-sm rounded-control px-2 text-body font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 max-sm:h-control-lg",
              on ? "bg-sub-300 text-ink" : "text-ink-mute hover:bg-sub-200 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
