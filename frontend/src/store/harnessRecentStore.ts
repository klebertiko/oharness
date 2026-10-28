"use client";

import { create } from "zustand";

export const HARNESS_RECENT_KEY = "oh.harnessRecent";
const KEEP = 5;

interface HarnessRecentState {
  /** Harness ids the person chose most recently, newest first. */
  ids: string[];
  load: () => void;
  push: (id: string) => void;
}

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HARNESS_RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, KEEP) : [];
  } catch {
    return [];
  }
}

export const useHarnessRecentStore = create<HarnessRecentState>((set, get) => ({
  ids: [],
  load: () => set({ ids: read() }),
  push: (id) => {
    const ids = [id, ...get().ids.filter((x) => x !== id)].slice(0, KEEP);
    set({ ids });
    try {
      localStorage.setItem(HARNESS_RECENT_KEY, JSON.stringify(ids));
    } catch {
      /* storage blocked: recents just won't persist */
    }
  },
}));
