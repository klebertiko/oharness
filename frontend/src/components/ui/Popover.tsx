"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A non-modal popup anchored to its trigger. Escape and a press outside close
 * it, and focus returns to the trigger.
 */
export function Popover({
  label,
  trigger,
  children,
  open,
  onOpenChange,
  className,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const auto = useId();
  const panelId = `${auto}-panel`;
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (open === undefined) setUncontrolled(next);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const [box, setBox] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setBox({ top: rect.bottom + 6, left: rect.left });
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    (focusable ?? panel)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenRef.current(false);
      triggerRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (panelRef.current?.contains(node) || triggerRef.current?.contains(node)) return;
      setOpenRef.current(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen(!isOpen)}
        className="inline-flex"
      >
        {trigger}
      </button>
      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              style={{ top: box.top, left: box.left }}
              className={cn(
                "oh-sheet fixed z-50 min-w-48 rounded-md border border-border-1 bg-bg-elevated p-(--pad-3) shadow-(--shadow-float)",
                className,
              )}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
