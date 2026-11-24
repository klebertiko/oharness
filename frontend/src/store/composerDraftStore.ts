"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** The key of the draft of a chat that has no thread yet. */
export const NEW_DRAFT_KEY = "new";

interface DraftState {
  /** The unsent text of the composer, by thread (or `new`). Kept for the session so leaving the chat and coming back loses nothing. */
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  /** The thread born from a new chat takes its draft; one already written there is never overwritten. */
  moveDraft: (from: string, to: string) => void;
}

const safeSession = {
  getItem: (name: string): string | null => {
    try {
      return sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      sessionStorage.setItem(name, value);
    } catch {
      /* blocked or full: the draft stays in memory */
    }
  },
  removeItem: (name: string): void => {
    try {
      sessionStorage.removeItem(name);
    } catch {
      /* nothing to remove */
    }
  },
};

export const useComposerDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (key, value) =>
        set((s) => {
          const { [key]: _gone, ...rest } = s.drafts;
          return { drafts: value ? { ...rest, [key]: value } : rest };
        }),
      moveDraft: (from, to) =>
        set((s) => {
          const text = s.drafts[from];
          if (from === to || !text) return s;
          const { [from]: _moved, ...rest } = s.drafts;
          return { drafts: to in rest ? rest : { ...rest, [to]: text } };
        }),
    }),
    { name: "oh.composer-drafts", version: 1, storage: createJSONStorage(() => safeSession), partialize: (s) => ({ drafts: s.drafts }) },
  ),
);
