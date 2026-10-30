"use client";

import { create } from "zustand";

/** Whether the next harness run works in a worktree of its own (ADR 0019). Off until a person turns it on. */
interface RunWorktreeState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useRunWorktreeStore = create<RunWorktreeState>()((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}));
