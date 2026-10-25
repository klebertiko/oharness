"use client";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "fault" | "idle";

const TONE: Record<Tone, string> = {
  ok: "var(--signal)",
  warn: "var(--warn)",
  fault: "var(--fault)",
  idle: "var(--ink-mute)",
};

/** A single state signal: one small dot, coloured only when it carries news. */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-[7px] w-[7px] flex-none rounded-full ${pulse ? "animate-pulse" : ""}`}
      style={{ background: TONE[tone] }}
    />
  );
}

/**
 * The one list row: a title, one plain-language line under it, and at most one
 * state signal. Actions stay hidden until the row is hovered or focused.
 * Machine ids, chips and counters belong in the detail view, not here.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  actions,
  selected = false,
  onSelect,
  hint,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  hint?: string;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        title={hint}
        aria-current={selected || undefined}
        className={[
          "oh-focus-inner flex min-h-control-lg w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors",
          selected ? "bg-sub-200 shadow-[inset_2px_0_0_var(--signal)]" : "hover:bg-sub-200",
        ].join(" ")}
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="t-title block truncate text-ink">{title}</span>
          {subtitle && <span className="block truncate text-body text-ink-mute">{subtitle}</span>}
        </span>
        {trailing && (
          <span className={`flex-none transition-opacity ${actions ? "group-focus-within:opacity-0 group-hover:opacity-0" : ""}`}>
            {trailing}
          </span>
        )}
      </button>
      {actions && (
        <span className="absolute inset-y-0 right-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </span>
      )}
    </li>
  );
}

/** Rows under an optional quiet label. */
export function ListGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="px-1.5 pt-2">
      {label && <h3 className="px-2.5 pb-1 pt-2 text-meta font-medium text-ink-mute">{label}</h3>}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

/** Small ghost button for a row action. */
export function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-control-md min-w-control-md items-center justify-center gap-1 rounded-control px-2 text-body font-medium text-ink-mute transition-colors hover:bg-sub-300 hover:text-ink"
    >
      {children}
    </button>
  );
}
