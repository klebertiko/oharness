"use client";

import { create } from "zustand";

/** Whether the next turn may hand tasks to subagents. Off until a person turns it on. */
interface SubagentState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useSubagentStore = create<SubagentState>()((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}));
