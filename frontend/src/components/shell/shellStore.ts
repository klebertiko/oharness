"use client";
import { create } from "zustand";
import {
  DOCK_MAX,
  DOCK_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_OPEN,
  clamp,
  cycleSidebar,
  dockDrag,
  sidebarDrag,
  type SidebarMode,
} from "./frame";
import { hrefForDestination, navigate, type Destination } from "./routes";
import { useThreadStore } from "@/store/threadStore";

/**
 * Shell state: the frame, not the graph.
 * Sidebar mode and dock visibility are global. Changing destination does not
 * touch them. Geometry is persisted so the app comes back as it was left.
 */

export type RailSection = Destination;

export const STUDIO_SECTION: RailSection = "studio";

const STORAGE_KEY = "oh.shell.v9";
const LEGACY_KEY = "oh.shell.v8";

export const LEFT_MIN = SIDEBAR_MIN;
export const LEFT_MAX = SIDEBAR_MAX;
export const LEFT_DEFAULT = SIDEBAR_OPEN;
export const RAIL_COLLAPSED = 56;
export const RIGHT_MIN = DOCK_MIN;
export const RIGHT_MAX = DOCK_MAX;

const SECTIONS: RailSection[] = ["chats", "forja", "studio", "plugins", "providers", "settings"];

interface Persisted {
  sidebar: SidebarMode;
  sidebarWidth: number;
  dockOpen: boolean;
  /** When set, a selected Studio block does not force the dock open. */
  dockSuppressed: boolean;
  /** Null means 45% of the window, remembered after the first resize. */
  dockWidth: number | null;
  section: RailSection;
}

const DEFAULTS: Persisted = {
  sidebar: "open",
  sidebarWidth: SIDEBAR_OPEN,
  dockOpen: false,
  dockSuppressed: false,
  dockWidth: null,
  section: "chats",
};

function isMode(value: unknown): value is SidebarMode {
  return value === "open" || value === "rail" || value === "hidden";
}

function isSection(value: unknown): value is RailSection {
  return typeof value === "string" && (SECTIONS as string[]).includes(value);
}

interface LegacyV8 {
  leftOpen?: boolean;
  rightOpen?: boolean;
  leftWidth?: number;
  rightWidth?: number;
  section?: string;
}

function fromLegacy(raw: LegacyV8): Persisted {
  const width = typeof raw.leftWidth === "number" ? raw.leftWidth : SIDEBAR_OPEN;
  return {
    sidebar: raw.leftOpen === false ? "hidden" : "open",
    sidebarWidth: width >= SIDEBAR_MIN && width <= SIDEBAR_MAX ? width : SIDEBAR_OPEN,
    dockOpen: Boolean(raw.rightOpen),
    dockSuppressed: false,
    dockWidth: typeof raw.rightWidth === "number" && raw.rightWidth >= DOCK_MIN ? raw.rightWidth : null,
    section: isSection(raw.section) ? raw.section : "chats",
  };
}

function load(): Persisted {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const next = window.localStorage.getItem(STORAGE_KEY);
    if (next) {
      const parsed = JSON.parse(next) as Partial<Persisted>;
      return {
        sidebar: isMode(parsed.sidebar) ? parsed.sidebar : DEFAULTS.sidebar,
        sidebarWidth:
          typeof parsed.sidebarWidth === "number"
            ? clamp(parsed.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
            : SIDEBAR_OPEN,
        dockOpen: Boolean(parsed.dockOpen),
        dockSuppressed: Boolean(parsed.dockSuppressed),
        dockWidth: typeof parsed.dockWidth === "number" ? clamp(parsed.dockWidth, DOCK_MIN, DOCK_MAX) : null,
        section: isSection(parsed.section) ? parsed.section : "chats",
      };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) return fromLegacy(JSON.parse(legacy) as LegacyV8);
    return DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function save(state: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled: the layout simply will not persist */
  }
}

export interface ShellState extends Persisted {
  /** Mirrors `sidebar !== "hidden"` for callers that still read the boolean. */
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  studioView: "overview" | "editor";
  hydrated: boolean;
  paletteOpen: boolean;
  keymapOpen: boolean;
  libraryOpen: boolean;
  /** Slide-over below 768px. Not persisted: a phone should not boot covered. */
  drawerOpen: boolean;

  setStudioView: (view: "overview" | "editor") => void;
  hydrate: () => void;
  /** Ctrl+B. Cycles open → strip → hidden on a wide window; toggles the drawer below 768px. */
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  resizeSidebar: (px: number) => void;
  resizeDock: (px: number) => void;
  resetSidebarWidth: () => void;
  resetDockWidth: () => void;
  /** Changes destination and the address. Does not touch the sidebar or the dock. */
  setSection: (s: RailSection) => void;
  /** Same section, no history entry. Used when the address already changed. */
  applySection: (s: RailSection) => void;
  setDrawerOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setKeymapOpen: (v: boolean) => void;
  setLibraryOpen: (v: boolean) => void;
  dismissOverlays: () => void;
}

function persisted(s: ShellState): Persisted {
  return {
    sidebar: s.sidebar,
    sidebarWidth: s.sidebarWidth,
    dockOpen: s.dockOpen,
    dockSuppressed: s.dockSuppressed,
    dockWidth: s.dockWidth,
    section: s.section,
  };
}

function withMirrors(patch: Partial<Persisted>): Partial<ShellState> {
  const next: Partial<ShellState> = { ...patch };
  if (patch.sidebar) next.leftOpen = patch.sidebar !== "hidden";
  if (patch.sidebarWidth !== undefined) next.leftWidth = patch.sidebarWidth;
  if (patch.dockOpen !== undefined) next.rightOpen = patch.dockOpen;
  if (patch.dockWidth !== undefined) next.rightWidth = patch.dockWidth ?? 0;
  return next;
}

export const useShellStore = create<ShellState>((set, get) => ({
  ...DEFAULTS,
  leftOpen: true,
  rightOpen: false,
  leftWidth: SIDEBAR_OPEN,
  rightWidth: 0,
  studioView: "overview",
  hydrated: false,
  paletteOpen: false,
  keymapOpen: false,
  libraryOpen: false,
  drawerOpen: false,

  setStudioView: (studioView) => set({ studioView }),
  hydrate: () => {
    const hasSaved =
      typeof window !== "undefined" &&
      (window.localStorage.getItem(STORAGE_KEY) !== null || window.localStorage.getItem(LEGACY_KEY) !== null);
    if (!hasSaved) {
      set({ hydrated: true });
      return;
    }
    const loaded = load();
    set({
      ...loaded,
      leftOpen: loaded.sidebar !== "hidden",
      rightOpen: loaded.dockOpen,
      leftWidth: loaded.sidebarWidth,
      rightWidth: loaded.dockWidth ?? 0,
      hydrated: true,
    });
  },

  toggleLeft: () => {
    const viewport = typeof window === "undefined" ? 1280 : window.innerWidth;
    if (viewport < 768) {
      set({ drawerOpen: !get().drawerOpen });
      return;
    }
    const sidebar = cycleSidebar(get().sidebar, viewport);
    set(withMirrors({ sidebar }));
    save(persisted(get()));
  },
  toggleRight: () => {
    const dockOpen = !get().dockOpen;
    set(withMirrors({ dockOpen, dockSuppressed: !dockOpen }));
    save(persisted(get()));
  },
  setLeftOpen: (open) => {
    const sidebar: SidebarMode = open ? "open" : "hidden";
    set(withMirrors({ sidebar }));
    save(persisted(get()));
  },
  setRightOpen: (dockOpen) => {
    set(withMirrors({ dockOpen, dockSuppressed: dockOpen ? false : get().dockSuppressed }));
    save(persisted(get()));
  },
  setLeftWidth: (w) => {
    const sidebarWidth = clamp(w, SIDEBAR_MIN, SIDEBAR_MAX);
    set(withMirrors({ sidebar: "open", sidebarWidth }));
    save(persisted(get()));
  },
  setRightWidth: (w) => {
    const dockWidth = clamp(w, DOCK_MIN, DOCK_MAX);
    set(withMirrors({ dockOpen: true, dockSuppressed: false, dockWidth }));
    save(persisted(get()));
  },
  resizeSidebar: (px) => {
    const dragged = sidebarDrag(px);
    set(withMirrors({ sidebar: dragged.mode, sidebarWidth: dragged.mode === "open" ? dragged.width : get().sidebarWidth }));
    save(persisted(get()));
  },
  resizeDock: (px) => {
    const dragged = dockDrag(px);
    set(withMirrors({ dockOpen: dragged.open, dockSuppressed: !dragged.open, dockWidth: dragged.width ?? get().dockWidth }));
    save(persisted(get()));
  },
  resetSidebarWidth: () => {
    set(withMirrors({ sidebar: "open", sidebarWidth: SIDEBAR_OPEN }));
    save(persisted(get()));
  },
  resetDockWidth: () => {
    set(withMirrors({ dockOpen: true, dockSuppressed: false, dockWidth: null }));
    save(persisted(get()));
  },
  setSection: (section) => {
    set({ section });
    save(persisted(get()));
    const sessionId = section === "chats" ? useThreadStore.getState().activeThreadId : null;
    navigate(hrefForDestination(section, sessionId));
  },
  applySection: (section) => {
    if (get().section === section) return;
    set({ section });
    save(persisted(get()));
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen, keymapOpen: false, libraryOpen: false }),
  setKeymapOpen: (keymapOpen) => set({ keymapOpen, paletteOpen: false, libraryOpen: false }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen, paletteOpen: false, keymapOpen: false }),
  dismissOverlays: () => set({ paletteOpen: false, keymapOpen: false, libraryOpen: false, drawerOpen: false }),
}));
