"use client";

import { useRef } from "react";
import { useT } from "@/i18n/store";

/**
 * 8px hit target over a 1px rule. The rule only takes colour while dragging,
 * so a pointer crossing the window does not light the frame. Arrow keys move
 * 16px; dragging past the snap point collapses; a double click restores the
 * default width.
 */
export function Resizer({
  side,
  value,
  min,
  max,
  label,
  onChange,
  onReset,
}: {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (px: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const dragging = useRef(false);
  const el = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.detail > 1) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    el.current?.setAttribute("data-dragging", "true");
    document.documentElement.setAttribute("data-resizing", "true");
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    onChange(side === "left" ? e.clientX - rect.left : rect.right - e.clientX);
  };
  const end = () => {
    dragging.current = false;
    el.current?.removeAttribute("data-dragging");
    document.documentElement.removeAttribute("data-resizing");
  };

  return (
    <div
      ref={el}
      role="separator"
      aria-orientation="vertical"
      aria-label={label || (side === "left" ? t("shell.resize.nav") : t("shell.resize.dock"))}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={(e) => {
        e.preventDefault();
        onReset();
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (side === "left" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (side === "left" ? step : -step));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(min);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(max);
        }
      }}
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize bg-transparent ${side === "left" ? "right-[-4px]" : "left-[-4px]"}`}
    >
      <span className="pointer-events-none absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors duration-base group-hover:bg-line-strong group-focus-visible:bg-line-strong group-data-dragging:bg-signal motion-reduce:transition-none" />
    </div>
  );
}
