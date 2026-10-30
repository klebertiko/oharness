"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const SUBAGENT_STORAGE_KEY = "oh.subagents.v1";

/** Whether the next turn may hand tasks to subagents. Off until a person turns it on, then remembered. */
interface SubagentState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useSubagentStore = create<SubagentState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: SUBAGENT_STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ enabled: s.enabled }),
      merge: (stored, current) => ({ ...current, enabled: (stored as { enabled?: unknown } | undefined)?.enabled === true }),
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
