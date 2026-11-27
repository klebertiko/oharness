"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A spinner waits `ms` before it appears, then stays at least `ms`. A fast
 * success never flashes one; a failure that arrives after it appeared does
 * not blink it away.
 */
export function useSpinner(active: boolean, ms = 400): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      if (visible) return;
      const id = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, ms);
      return () => window.clearTimeout(id);
    }
    if (!visible) return;
    const remain = Math.max(0, ms - (Date.now() - shownAt.current));
    const id = window.setTimeout(() => setVisible(false), remain);
    return () => window.clearTimeout(id);
  }, [active, visible, ms]);

  return visible;
}

/**
 * A failed refresh keeps the last value on screen. The error is said beside
 * it; the previous content does not disappear.
 */
export function useRetained<T>(value: T | undefined, failed: boolean): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (!failed && value !== undefined) last.current = value;
  if (failed && last.current !== undefined) return last.current;
  return value;
}
