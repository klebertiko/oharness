"use client";

/**
 * Panel chrome. Every dockable region wears the same 30px header: a signal
 * tick, a title, an optional mono subtitle pinned right. Uniform headers are
 * what let a person stop reading the frame and start reading the content.
 */
export function Panel({
  title,
  meta,
  actions,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col bg-sub-100 shadow-[inset_0_1px_0_var(--surface-highlight)] ${className}`}>
      <header className="flex h-panelhead flex-none items-center gap-2 border-b border-line-soft px-3">
        <h2 className="t-title truncate text-ink">{title}</h2>
        <span className="flex-1" />
        {meta && <span className="t-meta flex-none text-ink-mute">{meta}</span>}
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
