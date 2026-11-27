"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { rememberChoice, type ModelChoice } from "@/components/providers/modelChoice";

/**
 * The last five account + model combinations picked in the chat combo, newest
 * first. A small per-device convenience like the chat's provider choice: ids
 * and model names only, nothing a provider said.
 */
export interface ChatRecentState {
  recent: ModelChoice[];
  remember: (choice: ModelChoice) => void;
}

export const CHAT_RECENT_STORAGE_KEY = "oh.chat.recent.v1";

export const useChatRecentStore = create<ChatRecentState>()(
  persist(
    (set) => ({
      recent: [],
      remember: (choice) => set((s) => ({ recent: rememberChoice(s.recent, choice) })),
    }),
    { name: CHAT_RECENT_STORAGE_KEY, storage: createJSONStorage(() => localStorage) },
  ),
);
