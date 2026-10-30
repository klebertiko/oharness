"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n/store";
import { cardSpan, nextCardIndex, pageTarget, parseInset, railState, revealTarget, wheelToScroll, type RailState } from "@/lib/scrollRail";

const IDLE: RailState = { canPrev: false, canNext: false, fadeStart: false, fadeEnd: false };
const TEXT_ENTRY = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const FOCUSABLE = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

const insetOf = (el: HTMLElement) => parseInset(getComputedStyle(el).getPropertyValue("--rail-fade"));
const spanOf = (rail: HTMLElement, card: HTMLElement) => {
  const r = card.getBoundingClientRect();
  return cardSpan({ left: r.left, width: r.width }, { left: rail.getBoundingClientRect().left }, rail.scrollLeft, rail.clientLeft);
};
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const sameState = (a: RailState, b: RailState) => a.canPrev === b.canPrev && a.canNext === b.canNext && a.fadeStart === b.fadeStart && a.fadeEnd === b.fadeEnd;

/**
 * A horizontal rail of equal-height cards: CSS scroll-snap, edge fades that appear only
 * where more content waits, previous/next buttons that disable at the ends, wheel and
 * arrow-key travel. The rail's direct children are the cards.
 *
 * The step buttons are absolutely positioned to the top-right of the nearest positioned
 * ancestor, so they sit on the section heading's row; give that ancestor `relative`.
 */
export function ScrollRail({ labelledBy, as: Tag = "div", className = "", children }: {
  /** id of the heading that names this rail. */
  labelledBy: string;
  as?: "div" | "ul";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<RailState>(IDLE);
  const prevId = useId();
  const nextId = useId();

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = railState({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
    setState((cur) => (sameState(cur, next) ? cur : next));
  }, []);

  // Cards come and go (examples load, a draft appears), so re-measure after every render;
  // setState bails out when nothing changed.
  useLayoutEffect(measure);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Not a React onWheel: React registers wheel as passive, so preventDefault would be ignored.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const move = wheelToScroll(e, { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
      if (!move) return;
      e.preventDefault();
      el.scrollBy({ left: move.left, behavior: move.smooth && !reducedMotion() ? "smooth" : "auto" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const page = (dir: "prev" | "next") => {
    const el = ref.current;
    if (!el) return;
    const spans = (Array.from(el.children) as HTMLElement[]).map((c) => spanOf(el, c));
    const left = pageTarget(spans, { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }, dir, insetOf(el));
    el.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  // Focus landing in a card (Tab, arrows, a click) brings the whole card clear of the fades.
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const card = (Array.from(el.children) as HTMLElement[]).find((c) => c.contains(e.target as Node));
    if (!card) return;
    const left = revealTarget(spanOf(el, card), { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }, insetOf(el));
    if (left !== null) el.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const el = ref.current;
    const target = e.target as HTMLElement;
    if (!el || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || target.closest(TEXT_ENTRY)) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const from = cards.findIndex((c) => c.contains(target));
    if (from === -1) return;
    const to = nextCardIndex(from, e.key, cards.length);
    if (to === null) return;
    e.preventDefault();
    if (to === from) return;
    // Land on the same control (Open, Delete…) in the neighbour; skip cards with nothing focusable.
    const slot = Math.max(0, Array.from(cards[from].querySelectorAll<HTMLElement>(FOCUSABLE)).indexOf(target));
    const step = e.key === "Home" ? 1 : e.key === "End" ? -1 : to > from ? 1 : -1;
    for (let i = to; i >= 0 && i < cards.length; i += step) {
      const stops = cards[i].querySelectorAll<HTMLElement>(FOCUSABLE);
      if (stops.length) { stops[Math.min(slot, stops.length - 1)].focus(); return; }
    }
  };

  const t = useT();
  const fades = `${state.fadeStart ? " oh-rail-fade-start" : ""}${state.fadeEnd ? " oh-rail-fade-end" : ""}`;
  const scrollable = state.canPrev || state.canNext;

  return (
    <>
      {scrollable && (
        <div className="absolute right-0 top-0 flex gap-1.5">
          <Button iconOnly size="sm" id={prevId} aria-label={t("studio.rail.prev")} aria-labelledby={`${prevId} ${labelledBy}`} disabled={!state.canPrev} onClick={() => page("prev")} icon={<ChevronLeft size={14} strokeWidth={1.8} aria-hidden />} />
          <Button iconOnly size="sm" id={nextId} aria-label={t("studio.rail.next")} aria-labelledby={`${nextId} ${labelledBy}`} disabled={!state.canNext} onClick={() => page("next")} icon={<ChevronRight size={14} strokeWidth={1.8} aria-hidden />} />
        </div>
      )}
      <Tag
        ref={ref as never}
        role={Tag === "div" ? "group" : undefined}
        aria-labelledby={labelledBy}
        onScroll={measure}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={`oh-rail${fades} ${className}`.trim()}
      >
        {children}
      </Tag>
    </>
  );
}
