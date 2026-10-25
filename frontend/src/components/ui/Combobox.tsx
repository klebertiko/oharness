"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one picker every provider, model, harness and folder choice uses.
 *
 * Pattern: a trigger `<button aria-haspopup="listbox">` that opens a
 * portalled popover. Focus moves into the popover — onto the filter input
 * (`role="combobox"`) when `searchable`, otherwise onto the `role="listbox"`
 * itself — and whichever holds focus carries `aria-activedescendant`, so
 * assistive tech hears every arrow move. Escape closes and returns focus to
 * the trigger; a pointer press outside closes; Tab leaves naturally.
 *
 * The popover is `position: fixed` on `document.body` (no ancestor overflow
 * can clip it), clamped to the viewport horizontally, opened on whichever side
 * of the trigger has more room, and re-measured on resize/scroll rather than
 * slammed shut. Coordinates are computed, so they are the one inline style.
 */

export type ComboOption = {
  /** Stable id passed to `onChange`. */
  id: string;
  label: string;
  detail?: string;
  /** Options sharing a group render under one heading, in first-seen order. */
  group?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
};

export type ComboApi = {
  close: (refocus?: boolean) => void;
  focusList: () => void;
};

export type ComboboxProps = {
  /** Accessible name of the list ("Chat provider", "Model", …). */
  label: string;
  /** Accessible name of the trigger — include the current value. */
  triggerLabel: string;
  /** Visible trigger content. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Tooltip; defaults to the trigger label. */
  title?: string;
  /** Extra description on the trigger (e.g. a hint paragraph id). */
  describedBy?: string;
  value: string | null;
  options: ComboOption[];
  onChange: (id: string) => void;
  /** Keep the popover open after choosing this id (e.g. to set it up in place). */
  keepOpen?: (id: string) => boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Offer the typed text as a choice when nothing matches it exactly. */
  allowCustom?: boolean;
  status?: "ready" | "loading" | "error";
  loadingText?: string;
  errorText?: string;
  emptyText?: string;
  /** Short line above the list. */
  header?: ReactNode;
  /** Rendered between the list and the footer (outside the listbox). */
  panel?: ReactNode | ((api: ComboApi) => ReactNode);
  footer?: ReactNode | ((api: ComboApi) => ReactNode);
  /** Return true to consume Escape (e.g. collapse an inner panel first). */
  onEscape?: (api: ComboApi) => boolean;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Popover width in px; clamped to the viewport. */
  width?: number;
  disabled?: boolean;
};

const GAP = 6;
const MARGIN = 8;

type Pos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/** Is `node` inside a popover opened after (so nested inside) `own`? A
    model picker inside the chat picker's setup panel portals its own popover
    to the end of <body>; pressing or focusing in it must not close the outer one. */
function inNestedPopover(own: HTMLElement | null, node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  const pop = el?.closest("[data-combobox-popover]");
  return Boolean(own && pop && pop !== own && own.compareDocumentPosition(pop) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function measure(trigger: HTMLElement, width: number): Pos {
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - MARGIN * 2);
  const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN));
  const below = vh - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  if (below >= Math.min(320, above)) {
    return { left, width: w, top: r.bottom + GAP, maxHeight: Math.max(120, below) };
  }
  return { left, width: w, bottom: vh - r.top + GAP, maxHeight: Math.max(120, above) };
}

export function Combobox({
  label,
  triggerLabel,
  trigger,
  triggerClassName,
  title,
  describedBy,
  value,
  options,
  onChange,
  keepOpen,
  searchable = false,
  searchPlaceholder,
  allowCustom = false,
  status = "ready",
  loadingText = "Loading…",
  errorText = "Couldn't load the list.",
  emptyText = "Nothing to choose yet.",
  header,
  panel,
  footer,
  onEscape,
  open: openProp,
  onOpenChange,
  width = 300,
  disabled = false,
}: ComboboxProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = baseId + "-list";
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const visible = useMemo(() => {
    const needle = searchable ? query.trim().toLowerCase() : "";
    const rows = needle
      ? options.filter((o) => [o.label, o.detail ?? "", o.id].some((t) => t.toLowerCase().includes(needle)))
      : options;
    const typed = query.trim();
    if (searchable && allowCustom && typed && !options.some((o) => o.id === typed)) {
      return [...rows, { id: typed, label: `Use “${typed}”`, detail: "Not in the list — sent as typed" }];
    }
    return rows;
  }, [options, query, searchable, allowCustom]);

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = from; i >= 0 && i < visible.length; i += dir) if (!visible[i].disabled) return i;
      return -1;
    },
    [visible],
  );

  const focusList = useCallback(() => {
    (searchable ? inputRef.current : listRef.current)?.focus();
  }, [searchable]);

  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) triggerRef.current?.focus();
    },
    [setOpen],
  );
  const api: ComboApi = useMemo(() => ({ close, focusList }), [close, focusList]);

  const openMenu = () => {
    if (disabled) return;
    setQuery("");
    setOpen(true);
  };

  // Each time it opens: measure, start the cursor on the current value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only on the open transition
  useLayoutEffect(() => {
    if (!open) return;
    if (triggerRef.current) setPos(measure(triggerRef.current, width));
    const selected = options.findIndex((o) => o.id === value && !o.disabled);
    setCursor(selected >= 0 ? selected : Math.max(0, options.findIndex((o) => !o.disabled)));
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus once the popover exists, not on every re-measure
  useEffect(() => {
    if (open && pos) focusList();
  }, [open, pos === null]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t) || inNestedPopover(popRef.current, t)) return;
      close(false);
    };
    const remeasure = () => triggerRef.current && setPos(measure(triggerRef.current, width));
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [open, close, width]);

  // Filtering can shrink the list under the cursor.
  useEffect(() => {
    if (!open) return;
    setCursor((c) => (c < visible.length && !visible[c]?.disabled ? c : Math.max(0, firstEnabled(0, 1))));
  }, [open, visible, firstEnabled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll when the cursor moves while open; optionId is derived from a stable id
  useEffect(() => {
    if (open) document.getElementById(optionId(cursor))?.scrollIntoView?.({ block: "nearest" });
  }, [open, cursor]);

  const choose = (i: number) => {
    const o = visible[i];
    if (!o || o.disabled) return;
    onChange(o.id);
    if (!keepOpen?.(o.id)) close();
  };

  const move = (dir: 1 | -1) => {
    const next = firstEnabled(cursor + dir, dir);
    if (next >= 0) setCursor(next);
  };

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    const onList = e.currentTarget === listRef.current;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (onList && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      const i = e.key === "Home" ? firstEnabled(0, 1) : firstEnabled(visible.length - 1, -1);
      if (i >= 0) setCursor(i);
    } else if (e.key === "Enter" || (onList && e.key === " ")) {
      e.preventDefault();
      choose(cursor);
    } else if (onList && e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: jump to the next option starting with that character.
      const ch = e.key.toLowerCase();
      for (let step = 1; step <= visible.length; step++) {
        const i = (cursor + step) % visible.length;
        if (!visible[i].disabled && visible[i].label.toLowerCase().startsWith(ch)) {
          setCursor(i);
          break;
        }
      }
    }
  };

  const onPopKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (onEscape?.(api)) return;
    close();
  };

  const activeId = visible.length && visible[cursor] ? optionId(cursor) : undefined;
  const groups = visible.some((o) => o.group);

  const optionRow = (o: ComboOption, i: number) => (
    // biome-ignore lint/a11y/useFocusableInteractive: options stay out of the tab order; focus remains on the input/trigger and aria-activedescendant points at the active option
    // biome-ignore lint/a11y/useKeyWithClickEvents: options are driven by the listbox (aria-activedescendant); keys are handled on the list, not per option
    <div
      key={o.id + ":" + i}
      id={optionId(i)}
      role="option"
      aria-selected={o.id === value}
      aria-disabled={o.disabled || undefined}
      onPointerMove={() => !o.disabled && setCursor(i)}
      onClick={() => {
        setCursor(i);
        choose(i);
      }}
      className={cn(
        "mx-1 flex min-h-control-lg items-center gap-2.5 rounded-control px-2.5 py-1.5",
        o.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer active:bg-sub-300",
        i === cursor && !o.disabled && "bg-sub-300",
      )}
    >
      {o.leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-title font-medium leading-5 text-ink">{o.label}</span>
        {o.detail && <span className="t-meta block truncate text-ink-mute">{o.detail}</span>}
      </span>
      {o.trailing}
      {o.id === value && <Check size={14} strokeWidth={2} className="flex-none text-signal-text" aria-hidden />}
    </div>
  );

  const rows: ReactNode[] = [];
  if (groups) {
    const order: string[] = [];
    visible.forEach((o) => {
      const g = o.group ?? "";
      if (!order.includes(g)) order.push(g);
    });
    order.forEach((g) => {
      const headingId = `${baseId}-g-${order.indexOf(g)}`;
      rows.push(
        <div key={"g:" + g} role="group" aria-labelledby={g ? headingId : undefined}>
          {g && (
            <div id={headingId} role="presentation" className="px-3 pb-1 pt-2 text-meta font-medium text-ink-mute">
              {g}
            </div>
          )}
          {visible.map((o, i) => ((o.group ?? "") === g ? optionRow(o, i) : null))}
        </div>,
      );
    });
  } else {
    visible.forEach((o, i) => {
      rows.push(optionRow(o, i));
    });
  }

  const message =
    status === "loading" ? (
      <p role="status" className="px-3 py-2 text-body text-ink-mute">{loadingText}</p>
    ) : status === "error" ? (
      <p role="alert" className="px-3 py-2 text-body text-fault-text">{errorText}</p>
    ) : visible.length === 0 ? (
      <p className="px-3 py-2 text-body text-ink-mute">{emptyText}</p>
    ) : null;

  const popover =
    open &&
    pos &&
    createPortal(
      // biome-ignore lint/a11y/noStaticElementInteractions: delegates keydown/blur from the focusable controls inside (input, trigger, options) to close and trap focus; the container itself is not a control
      <div
        ref={popRef}
        data-combobox-popover=""
        onKeyDown={onPopKeyDown}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && !e.currentTarget.contains(next) && next !== triggerRef.current && !inNestedPopover(popRef.current, next)) close(false);
        }}
        className="oh-float fixed z-60 flex flex-col py-1"
        style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
      >
        {header && <div className="flex-none px-3 py-2 text-meta leading-4 text-ink-mute">{header}</div>}
        {searchable && (
          <div className="mx-1 mb-1 flex h-8 flex-none items-center gap-2 rounded-control border border-line-strong bg-sub-200 px-2 focus-within:border-signal">
            <Search size={12} strokeWidth={1.8} className="flex-none text-ink-mute" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-label={`Filter ${label}`}
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query}
              placeholder={searchPlaceholder ?? (allowCustom ? "Filter or type a name" : "Filter")}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onNavKeyDown}
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-hidden placeholder:text-ink-mute"
            />
          </div>
        )}
        {message}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={searchable ? -1 : 0}
          aria-activedescendant={searchable ? undefined : activeId}
          onKeyDown={searchable ? undefined : onNavKeyDown}
          className="oh-focus-inner min-h-0 flex-1 overflow-y-auto rounded-control"
        >
          {rows.map((r, i) => (
            <Fragment key={i}>{r}</Fragment>
          ))}
        </div>
        {panel && <div className="flex-none">{typeof panel === "function" ? panel(api) : panel}</div>}
        {footer && (
          <div className="mt-1 flex-none border-t border-line-soft px-1 pt-1">
            {typeof footer === "function" ? footer(api) : footer}
          </div>
        )}
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={triggerLabel}
        aria-describedby={describedBy}
        title={title ?? triggerLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-control transition-colors hover:bg-sub-200 active:bg-sub-300 aria-expanded:bg-sub-200 disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName,
        )}
      >
        {trigger}
      </button>
      {popover}
    </>
  );
}

/** A full-width row action for a Combobox footer. */
export function ComboAction({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="oh-focus-inner flex h-control-md w-full items-center gap-2 rounded-control px-2 text-left text-body font-medium text-ink-dim max-sm:h-control-lg transition-colors hover:bg-sub-200 hover:text-ink active:bg-sub-300 disabled:cursor-wait disabled:opacity-60"
    >
      {children}
    </button>
  );
}
