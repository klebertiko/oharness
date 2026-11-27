/**
 * Frame geometry. Widths are layout constants (the shell measures the window
 * and writes pixels); colour and motion stay on the existing tokens.
 */

export type SidebarMode = "open" | "rail" | "hidden";

export const SIDEBAR_OPEN = 280;
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 400;
export const SIDEBAR_RAIL = 56;
/** Dragging narrower than this snaps the sidebar to the icon strip. */
export const SIDEBAR_COLLAPSE_AT = SIDEBAR_MIN / 2;

export const DOCK_MIN = 240;
export const DOCK_MAX = 960;
export const DOCK_RATIO = 0.45;
export const DOCK_COLLAPSE_AT = DOCK_MIN / 2;
/** The center keeps this much before the dock takes more. Wide enough for the studio bar. */
export const CENTER_MIN = 640;
export const READING_WIDTH = 760;

/** Icon strip from here down, so a 1280px window at 125% still has the list. */
export const STRIP_AT = 1024;
export const DRAWER_AT = 768;

export function cycleSidebar(mode: SidebarMode, viewport: number): SidebarMode {
  if (viewport < DRAWER_AT) return mode;
  if (viewport <= STRIP_AT) return mode === "hidden" ? "rail" : "hidden";
  if (mode === "open") return "rail";
  if (mode === "rail") return "hidden";
  return "open";
}

/** Pixels the sidebar occupies in the row. Zero means the center takes the rest. */
export function flowWidth(mode: SidebarMode, viewport: number, openWidth: number): number {
  if (viewport < DRAWER_AT) return 0;
  if (viewport <= STRIP_AT) return mode === "hidden" ? 0 : SIDEBAR_RAIL;
  if (mode === "hidden") return 0;
  if (mode === "rail") return SIDEBAR_RAIL;
  return clamp(openWidth, SIDEBAR_MIN, SIDEBAR_MAX);
}

export function showsDrawer(viewport: number): boolean {
  return viewport < DRAWER_AT;
}

export function showsPeek(mode: SidebarMode, viewport: number): boolean {
  return viewport >= DRAWER_AT && viewport <= STRIP_AT && mode !== "hidden";
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** A drag that passes the snap point collapses; otherwise the width is clamped. */
export function sidebarDrag(px: number): { mode: SidebarMode; width: number } {
  if (px < SIDEBAR_COLLAPSE_AT) return { mode: "rail", width: SIDEBAR_OPEN };
  return { mode: "open", width: clamp(px, SIDEBAR_MIN, SIDEBAR_MAX) };
}

export function dockDrag(px: number): { open: boolean; width: number | null } {
  if (px < DOCK_COLLAPSE_AT) return { open: false, width: null };
  return { open: true, width: clamp(px, DOCK_MIN, DOCK_MAX) };
}

export interface DockBox {
  kind: "hidden" | "column" | "overlay";
  width: number;
}

/**
 * The dock yields before the center goes under CENTER_MIN. When the column
 * cannot keep that minimum, the dock overlays the right edge instead.
 */
export function dockBox(viewport: number, side: number, open: boolean, remembered: number | null): DockBox {
  if (!open) return { kind: "hidden", width: 0 };
  const available = Math.max(0, viewport - side);
  const wanted = remembered ?? Math.round(viewport * DOCK_RATIO);
  const maxColumn = available - CENTER_MIN;
  if (maxColumn < DOCK_MIN) {
    const overlay = Math.min(Math.round(viewport * DOCK_RATIO), Math.max(DOCK_MIN, viewport - 48));
    return { kind: "overlay", width: overlay };
  }
  return { kind: "column", width: clamp(wanted, DOCK_MIN, Math.min(DOCK_MAX, maxColumn)) };
}
