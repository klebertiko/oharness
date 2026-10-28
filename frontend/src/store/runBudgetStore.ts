"use client";

import { create } from "zustand";

/** The token ceiling the next run starts with; null means no ceiling. */
interface RunBudgetState {
  maxTokens: number | null;
  setMaxTokens: (value: number | null) => void;
}

export const useRunBudgetStore = create<RunBudgetState>()((set) => ({
  maxTokens: null,
  setMaxTokens: (maxTokens) => set({ maxTokens }),
}));
