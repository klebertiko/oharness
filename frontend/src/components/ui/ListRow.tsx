"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A selectable row: title, optional machine detail under it, leading and
 * trailing slots. The current row carries `aria-current` plus a 2px signal
 * bar, so selection is never colour alone. Rows are 36px tall, which is also
 * the touch target.
 */
export function ListRow({
  title,
  meta,
  leading,
  trailing,
  selected = false,
  disabled = false,
  onClick,
  className,
  ...rest
}: {
  title: ReactNode;
  /** Machine detail (ids, models, paths), set in IBM Plex Mono. */
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title" | "onClick" | "className" | "disabled">) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-h-control-lg pointer-coarse:min-h-control-touch w-full items-center gap-2 rounded-control px-3 py-1 text-left text-ink-dim transition-colors",
        "hover:bg-sub-200 active:bg-sub-300 disabled:cursor-not-allowed disabled:opacity-45",
        selected && "bg-sub-200 text-ink shadow-[inset_2px_0_0_var(--signal)]",
        className,
      )}
      {...rest}
    >
      {leading && <span className="inline-flex flex-none text-ink-mute">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-title truncate text-inherit">{title}</span>
        {meta && <span className="t-meta truncate text-ink-mute">{meta}</span>}
      </span>
      {trailing && <span className="inline-flex flex-none items-center gap-2">{trailing}</span>}
    </button>
  );
}
