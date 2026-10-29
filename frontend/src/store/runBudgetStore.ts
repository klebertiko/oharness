"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { validateMaxTokens } from "@/components/agent-run/runBudgetRules";

export const RUN_BUDGET_STORAGE_KEY = "oh.runBudget.v1";

/** The token ceiling the next run starts with; null means no ceiling. Kept across restarts. */
interface RunBudgetState {
  maxTokens: number | null;
  setMaxTokens: (value: number | null) => void;
}

export const useRunBudgetStore = create<RunBudgetState>()(
  persist(
    (set) => ({
      maxTokens: null,
      setMaxTokens: (maxTokens) => set({ maxTokens }),
    }),
    {
      name: RUN_BUDGET_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // A stored value from an older build or a hand edit is checked again before it is trusted.
      merge: (stored, current) => {
        const value = (stored as { maxTokens?: unknown } | undefined)?.maxTokens;
        const ok = typeof value === "number" && validateMaxTokens(String(value)).ok;
        return { ...current, maxTokens: ok ? value : null };
      },
    },
  ),
);
