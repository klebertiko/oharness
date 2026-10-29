import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Splits `code` on backticks so a command inside a translated sentence is set in the mono face (machine data), never in prose. */
export function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className="t-meta text-ink">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One labelled row of a panel: label, value and an optional action. Three columns when the pane is wide, stacked when it is not (container query, so it follows the pane and not the window). */
export function Row({ label, children, action, className }: { label: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-x-4 gap-y-1.5 border-t border-line-soft px-3 py-3 first:border-t-0 @md:grid-cols-[8rem_minmax(0,1fr)_auto]", className)}>
      <dt className="t-body text-ink-mute @md:pt-1">{label}</dt>
      <dd className="min-w-0">{children}</dd>
      {action && <dd className="flex flex-wrap items-center gap-2 @md:justify-end">{action}</dd>}
    </div>
  );
}

/** A panel's rows. */
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl aria-label={label} className="m-0">
      {children}
    </dl>
  );
}
