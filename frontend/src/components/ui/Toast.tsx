"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
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
 * A polite live region. A fault is an alert. Hovering a toast holds it;
 * leaving restarts the timer. Motion is the shared sheet entrance.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
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

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-(--pad-4) right-(--pad-4) z-50 flex w-[min(var(--sheet-max),calc(100vw-var(--sheet-inset)))] flex-col gap-(--gap-2)">
        {items.map((item) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hovering pauses the timer; the role stays status or alert
          <div
            key={item.id}
            role={item.tone === "fault" ? "alert" : "status"}
            onMouseEnter={() => {
              const timer = timers.current.get(item.id);
              if (timer) window.clearTimeout(timer);
            }}
            onMouseLeave={() => arm(item.id)}
            className={cn(
              "oh-sheet pointer-events-auto rounded-md border px-(--pad-3) py-(--pad-3)",
              item.tone === "fault" && "border-fault-border bg-fault-bg",
              item.tone === "warn" && "border-warn-border bg-warn-bg",
              (!item.tone || item.tone === "info") && "border-border-1 bg-bg-elevated",
            )}
          >
            <p className={cn("t-ui font-medium", item.tone === "fault" ? "text-fault-fg" : item.tone === "warn" ? "text-warn-fg" : "text-fg-1")}>{item.title}</p>
            {item.body && <p className="t-meta text-fg-2">{item.body}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
