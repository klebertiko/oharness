"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKey } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
  onSelect?: () => void;
  items?: MenuItem[];
}

function nextEnabled(items: MenuItem[], from: number, step: number): number {
  const count = items.length;
  for (let hop = 1; hop <= count; hop++) {
    const index = (from + step * hop + count * hop) % count;
    if (!items[index]?.disabled) return index;
  }
  return from;
}

function MenuList({
  items,
  labelledBy,
  onClose,
  submenu,
}: {
  items: MenuItem[];
  labelledBy?: string;
  onClose: () => void;
  submenu?: boolean;
}) {
  const [index, setIndex] = useState(() => items.findIndex((item) => !item.disabled));
  const [openChild, setOpenChild] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const typed = useRef("");
  const typedAt = useRef(0);

  useEffect(() => {
    if (openChild) return;
    refs.current[index]?.focus();
  }, [index, openChild]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.items?.length) {
      setOpenChild(item.id);
      return;
    }
    item.onSelect?.();
    onClose();
  };

  const onKeyDown = (event: ReactKey<HTMLDivElement>) => {
    const item = items[index];
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex(nextEnabled(items, index, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex(nextEnabled(items, index, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setIndex(nextEnabled(items, -1, 1));
    } else if (event.key === "End") {
      event.preventDefault();
      setIndex(nextEnabled(items, 0, -1));
    } else if (event.key === "ArrowRight" && item?.items?.length) {
      event.preventDefault();
      setOpenChild(item.id);
    } else if (event.key === "ArrowLeft" && submenu) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (item) choose(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key.length === 1 && event.key !== " ") {
      const now = Date.now();
      typed.current = now - typedAt.current > 500 ? event.key : typed.current + event.key;
      typedAt.current = now;
      const query = typed.current.toLowerCase();
      const found = items.findIndex((entry, at) => !entry.disabled && at !== index && entry.label.toLowerCase().startsWith(query));
      if (found >= 0) setIndex(found);
    }
  };

  return (
    <div
      role="menu"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="min-w-44 rounded-md border border-border-1 bg-bg-elevated p-(--pad-1) shadow-(--shadow-float)"
    >
      {items.map((item, at) => (
        <div key={item.id} className="relative">
          <button
            type="button"
            role="menuitem"
            ref={(node) => {
              refs.current[at] = node;
            }}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.items?.length ? "menu" : undefined}
            aria-expanded={item.items?.length ? openChild === item.id : undefined}
            tabIndex={at === index ? 0 : -1}
            disabled={item.disabled}
            onMouseEnter={() => {
              if (!item.disabled) setIndex(at);
            }}
            onClick={() => choose(item)}
            className={cn(
              "flex w-full items-center gap-(--gap-2) rounded-xs px-(--pad-2) py-(--pad-1) text-left t-ui text-fg-1",
              "disabled:cursor-not-allowed disabled:opacity-45",
              at === index && "bg-bg-hover",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="t-meta text-fg-3">{item.shortcut}</span>}
            {item.items?.length ? <ChevronRight aria-hidden className="size-(--icon) text-fg-3" /> : null}
          </button>
          {item.items?.length && openChild === item.id && (
            <div className="absolute top-0 left-full z-10 ps-(--pad-1)">
              <MenuList items={item.items} submenu onClose={() => setOpenChild(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** A menu with optional submenus. Arrows move, Right opens, Left and Escape close. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const auto = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState({ top: 0, left: 0 });
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (triggerRef.current?.contains(node)) return;
      if ((event.target as Element | null)?.closest?.("[role='menu']")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={auto}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setBox({ top: rect.bottom + 4, left: rect.left });
          }
          setOpen((value) => !value);
        }}
        className="inline-flex h-control-md items-center rounded-md border border-border-2 bg-bg-pane px-(--pad-3) t-ui text-fg-1 pointer-coarse:h-control-touch"
      >
        {label}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div style={{ top: box.top, left: box.left }} className="fixed z-50">
              <MenuList items={items} labelledBy={auto} onClose={close} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
