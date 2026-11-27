"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/store";
import { cn } from "@/lib/utils";

export type ToastTone = "info" | "warn" | "fault";
export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
}

interface ToastRecord extends ToastInput {
  id: number;
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

/** Push a toast from anywhere under the provider. */
export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}

const HOLD = 5000;

/**
 * A labelled region that is in the page before the first toast, so assistive
 * tech already watches it: info and warnings go to a polite status list,
 * faults to an alert list. Hovering or focusing a toast holds it (WCAG 2.2.1);
 * leaving restarts the timer. Each toast has a dismiss button. Motion is the
 * shared sheet entrance.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastRecord[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const arm = useCallback(
    (id: number) => {
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      timers.current.set(id, window.setTimeout(() => dismiss(id), HOLD));
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: ToastInput) => {
      const id = next.current++;
      setItems((current) => [...current, { ...toast, id }]);
      arm(id);
    },
    [arm],
  );

  const value = useMemo(() => push, [push]);
  const hold = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
  };

  const render = (item: ToastRecord) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering pauses the timer; the live list around it announces it
    <div
      key={item.id}
      onMouseEnter={() => hold(item.id)}
      onMouseLeave={() => arm(item.id)}
      onFocus={() => hold(item.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) arm(item.id);
      }}
      className={cn(
        "oh-sheet pointer-events-auto flex items-start gap-(--gap-2) rounded-md border px-(--pad-3) py-(--pad-3)",
        item.tone === "fault" && "border-fault-border bg-fault-bg",
        item.tone === "warn" && "border-warn-border bg-warn-bg",
        (!item.tone || item.tone === "info") && "border-border-1 bg-bg-elevated",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("t-ui font-medium", item.tone === "fault" ? "text-fault-fg" : item.tone === "warn" ? "text-warn-fg" : "text-fg-1")}>{item.title}</p>
        {item.body && <p className="t-meta text-fg-2">{item.body}</p>}
      </div>
      <button
        type="button"
        aria-label={t("ui.dismissNotification")}
        title={t("ui.dismissNotification")}
        onClick={() => dismiss(item.id)}
        className="-m-(--pad-1) inline-flex size-control-sm flex-none items-center justify-center rounded-sm text-fg-3 hover:bg-bg-hover hover:text-fg-1"
      >
        <X aria-hidden className="size-(--icon)" />
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label={t("ui.notifications")}
        className="pointer-events-none fixed bottom-(--pad-4) right-(--pad-4) z-50 flex w-[min(var(--sheet-max),calc(100vw-var(--sheet-inset)))] flex-col gap-(--gap-2)"
      >
        <div role="alert" aria-live="assertive" className="flex flex-col gap-(--gap-2)">
          {items.filter((item) => item.tone === "fault").map(render)}
        </div>
        <div role="status" aria-live="polite" className="flex flex-col gap-(--gap-2)">
          {items.filter((item) => item.tone !== "fault").map(render)}
        </div>
      </section>
    </ToastContext.Provider>
  );
}
