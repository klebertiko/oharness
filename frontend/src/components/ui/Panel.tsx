import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PanelVariant = "panel" | "float" | "inset";

const VARIANT: Record<PanelVariant, string> = {
  panel: "rounded-panel border border-line-soft bg-sub-100 shadow-[inset_0_1px_0_var(--surface-highlight)]",
  float: "rounded-float border border-line bg-sub-100 shadow-(--shadow-float)",
  inset: "rounded-control border border-line-soft bg-sub-200",
};

/**
 * A surface with an optional 32px header. Elevation is a value step plus a
 * hairline; only `float` carries a shadow. A titled panel is a labelled region.
 */
export function Panel({
  variant = "panel",
  title,
  titleId,
  level = 2,
  meta,
  actions,
  children,
  className,
  bodyClassName,
}: {
  variant?: PanelVariant;
  title?: string;
  /** Required with `title`, so the section is labelled. */
  titleId?: string;
  /** Heading level of the title, for a panel nested under another heading. */
  level?: 2 | 3;
  /** Machine detail pinned right in the header (counts, ids). */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cn("flex min-h-0 min-w-0 flex-col text-ink-dim", VARIANT[variant], className)}>
      {title && (
        <header className="flex min-h-panelhead flex-none items-center gap-2 border-b border-line-soft px-3">
          {level === 2 ? (
            <h2 id={titleId} className="t-title truncate text-ink">
              {title}
            </h2>
          ) : (
            <h3 id={titleId} className="t-title truncate text-ink">
              {title}
            </h3>
          )}
          <span className="flex-1" />
          {meta != null && <span className="t-meta flex-none text-ink-mute">{meta}</span>}
          {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 text-body", bodyClassName)}>{children}</div>
    </section>
  );
}
