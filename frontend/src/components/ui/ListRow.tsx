"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { StatusMark, type StatusTone } from "./StatusMark";

export type Tone = "ok" | "warn" | "fault" | "idle";

/** The shell's dot, drawn with the one marker. `pulse` is the busy state. */
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  const mark: StatusTone = tone;
  return <StatusMark tone={mark} className={pulse ? "animate-pulse motion-reduce:animate-none" : undefined} />;
}

/**
 * A selectable row: title, optional prose, optional machine detail, leading
 * and trailing slots. The shell also passes `subtitle`, `onSelect`, `hint`
 * and `actions`; those wrap the row in a list item.
 */
export function ListRow({
  title,
  meta,
  description,
  subtitle,
  leading,
  trailing,
  actions,
  hint,
  selected = false,
  disabled = false,
  onClick,
  onSelect,
  className,
  ...rest
}: {
  title: ReactNode;
  /** Machine detail (ids, models, paths), set in the mono face. */
  meta?: ReactNode;
  /** One line of prose under the title. */
  description?: ReactNode;
  /** Shell name for the prose line. */
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shown on hover and focus. Shell rows only. */
  actions?: ReactNode;
  hint?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onSelect?: () => void;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title" | "onClick" | "className" | "disabled">) {
  const prose = description ?? subtitle;
  const activate = onClick ?? onSelect;
  const item = subtitle !== undefined || onSelect !== undefined || actions !== undefined || hint !== undefined;
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={activate}
      title={hint}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-h-control-lg w-full items-center gap-(--gap-2) rounded-control px-(--pad-3) py-(--pad-1) text-left text-fg-2 transition-colors pointer-coarse:min-h-control-touch",
        "hover:bg-bg-hover active:bg-bg-active disabled:cursor-not-allowed disabled:opacity-45",
        selected && "bg-bg-hover text-fg-1 shadow-selected",
        className,
      )}
      {...rest}
    >
      {leading && <span className="inline-flex flex-none text-fg-3">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="t-title truncate text-inherit">{title}</span>
        {prose && <span className="t-body truncate text-fg-3">{prose}</span>}
        {meta && <span className="t-code truncate text-fg-3">{meta}</span>}
      </span>
      {trailing && (
        <span className={cn("inline-flex flex-none items-center gap-(--gap-2)", actions && "group-focus-within:opacity-0 group-hover:opacity-0")}>
          {trailing}
        </span>
      )}
    </button>
  );
  if (!item) return button;
  return (
    <li className="group relative">
      {button}
      {actions && (
        <span className="absolute inset-y-0 right-(--pad-2) flex items-center gap-(--gap-1) opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </span>
      )}
    </li>
  );
}

/** Rows under an optional quiet label. */
export function ListGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="px-(--pad-2) pt-(--pad-2)">
      {label && <h3 className="px-(--pad-2) pt-(--pad-2) pb-(--pad-1) t-caption text-fg-3">{label}</h3>}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

/** A ghost action on a row. The name is required; the visible child can be an icon. */
export function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}
