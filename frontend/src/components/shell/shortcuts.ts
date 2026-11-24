"use client";

import { create } from "zustand";

const KEY = "oh.shortcuts.v1";

type BindingMap = Record<string, string | null>;

function load(): BindingMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Storage is outside our control: keep only "chord" or null (cleared) values.
    const bindings: BindingMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" || value === null) bindings[id] = value;
    }
    return bindings;
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
  /**
   * Bind `chord` to `id` (null clears it). `displaced` are the commands that hold
   * the chord now, by default or by choice; they lose it. The caller confirms
   * that with the person first.
   */
  rebind: (id: string, chord: string | null, displaced?: string[]) => void;
  /** Back to the command's default chord. */
  reset: (id: string) => void;
  chordFor: (id: string, fallback?: string) => string | undefined;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  bindings: {},
  rebind: (id, chord, displaced = []) => {
    const bindings = { ...get().bindings };
    if (chord) {
      for (const [other, value] of Object.entries(bindings)) {
        if (other !== id && value && sameChord(value, chord)) bindings[other] = null;
      }
      for (const other of displaced) if (other !== id) bindings[other] = null;
    }
    bindings[id] = chord;
    set({ bindings });
    save(bindings);
  },
  reset: (id) => {
    const bindings = { ...get().bindings };
    delete bindings[id];
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

/**
 * A keyboard event as a chord spec ("Mod+B"), or null when it cannot be a
 * shortcut: without Ctrl/Cmd or Alt only a function key counts, so a lone
 * Enter, Tab, Space, arrow or a typed (or Shift-typed) character never does.
 */
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
  if (!mod && !e.altKey && !/^F\d{1,2}$/.test(name)) return null;
  parts.push(name);
  return parts.join("+");
}

export function sameChord(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
