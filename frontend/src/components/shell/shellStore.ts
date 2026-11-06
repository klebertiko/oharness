"use client";
import { create } from "zustand";

/**
 * Shell state — everything about the *frame*, nothing about the graph.
 *
 * There is one flat set of destinations (see ActivityRail). `section` is which
 * one is showing. Panel geometry is persisted because spatial memory is the
 * whole point of a desktop layout: the app comes back as the user left it.
 */

export type RailSection = "chats" | "studio" | "providers" | "forja";

/** Studio is the only destination with its own right-hand inspector. */
export const STUDIO_SECTION: RailSection = "studio";

const STORAGE_KEY = "oh.shell.v8";

interface Persisted {
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  section: RailSection;
}

const DEFAULTS: Persisted = {
  leftOpen: true,
  rightOpen: false,
  leftWidth: 216,
  rightWidth: 264,
  section: "chats",
};

const SECTIONS: RailSection[] = ["chats", "studio", "providers", "forja"];

export const LEFT_MIN = 188;
export const LEFT_MAX = 380;
/** Icon-only rail width, used while the left panel is suppressed (narrow window). */
export const RAIL_COLLAPSED = 52;
export const RIGHT_MIN = 240;
export const RIGHT_MAX = 460;

function load(): Persisted {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
    if (!SECTIONS.includes(parsed.section)) parsed.section = DEFAULTS.section;
    return parsed;
  } catch {
    return DEFAULTS;
  }
}

function save(state: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage disabled — the layout simply will not persist */
  }
}

interface ShellState extends Persisted {
  studioView: "overview" | "editor";
  setStudioView: (view: "overview" | "editor") => void;
  hydrated: boolean;
  paletteOpen: boolean;
  keymapOpen: boolean;
  /** Studio's "Open .ohm" / browse library — a sheet, not a destination:
      picking a harness is a step inside building one, not a place you go. */
  libraryOpen: boolean;

  hydrate: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  setSection: (s: RailSection) => void;
  setPaletteOpen: (v: boolean) => void;
  setKeymapOpen: (v: boolean) => void;
  setLibraryOpen: (v: boolean) => void;
  dismissOverlays: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function persistFrom(s: ShellState) {
  save({
    leftOpen: s.leftOpen,
    rightOpen: s.rightOpen,
    leftWidth: s.leftWidth,
    rightWidth: s.rightWidth,
    section: s.section,
  });
}

export const useShellStore = create<ShellState>((set, get) => ({
  ...DEFAULTS,
  studioView: "overview",
  setStudioView: (studioView) => set({ studioView }),
  hydrated: false,
  paletteOpen: false,
  keymapOpen: false,
  libraryOpen: false,

  // Read persisted geometry after mount so SSR and first paint agree.
  hydrate: () => set({ ...load(), hydrated: true }),

  toggleLeft: () => {
    set({ leftOpen: !get().leftOpen });
    persistFrom(get());
  },
  toggleRight: () => {
    set({ rightOpen: !get().rightOpen });
    persistFrom(get());
  },
  setLeftOpen: (leftOpen) => {
    set({ leftOpen });
    persistFrom(get());
  },
  setRightOpen: (rightOpen) => {
    set({ rightOpen });
    persistFrom(get());
  },
  setLeftWidth: (w) => {
    set({ leftWidth: clamp(Math.round(w), LEFT_MIN, LEFT_MAX) });
    persistFrom(get());
  },
  setRightWidth: (w) => {
    set({ rightWidth: clamp(Math.round(w), RIGHT_MIN, RIGHT_MAX) });
    persistFrom(get());
  },
  setSection: (section) => {
    // Studio brings its inspector; every other destination hides it.
    set({ section, leftOpen: true, rightOpen: section === STUDIO_SECTION });
    persistFrom(get());
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen, keymapOpen: false, libraryOpen: false }),
  setKeymapOpen: (keymapOpen) => set({ keymapOpen, paletteOpen: false, libraryOpen: false }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen, paletteOpen: false, keymapOpen: false }),
  dismissOverlays: () => set({ paletteOpen: false, keymapOpen: false, libraryOpen: false }),
}));
