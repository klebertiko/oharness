"use client";

import { create } from "zustand";

const KEY = "oh.shortcuts.v1";

type BindingMap = Record<string, string | null>;

function load(): BindingMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BindingMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(bindings: BindingMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(bindings));
  } catch {
    /* the choice lasts for this session only */
  }
}

interface ShortcutState {
  bindings: BindingMap;
  rebind: (id: string, chord: string | null) => void;
  chordFor: (id: string, fallback?: string) => string | undefined;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  bindings: {},
  rebind: (id, chord) => {
    const bindings = { ...get().bindings };
    if (chord) {
      for (const [other, value] of Object.entries(bindings)) {
        if (other !== id && value === chord) bindings[other] = null;
      }
    }
    bindings[id] = chord;
    set({ bindings });
    save(bindings);
  },
  chordFor: (id, fallback) => {
    const bindings = get().bindings;
    if (Object.hasOwn(bindings, id)) {
      const value = bindings[id];
      return value ?? undefined;
    }
    return fallback;
  },
}));

export function hydrateShortcuts(): void {
  useShortcutStore.setState({ bindings: load() });
}

/** A keyboard event as a chord spec ("Mod+B"), or null when it is plain text. */
export function chordFromEvent(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  mac: boolean,
): string | null {
  const key = e.key;
  if (!key || key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const name = key.length === 1 ? key.toUpperCase() : key;
  parts.push(name);
  if (parts.length === 1 && name.length === 1) return null;
  return parts.join("+");
}

export function sameChord(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
