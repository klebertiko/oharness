const REGION_IDS = ["oh-titlebar", "oh-sidebar", "oh-main", "oh-dock"] as const;

function visible(id: string): HTMLElement | null {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return null;
  const box = el.getBoundingClientRect();
  if (box.width < 1 && box.height < 1) return null;
  return el;
}

/** Move focus to the next landmark. Hidden regions are skipped. */
export function cycleRegion(direction: 1 | -1): void {
  const regions = REGION_IDS.map((id) => visible(id)).filter((el): el is HTMLElement => Boolean(el));
  if (!regions.length) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const index = active ? regions.findIndex((el) => el === active || el.contains(active)) : -1;
  const next = regions[(index + direction + regions.length) % regions.length];
  next.focus();
}
