"use client";

import { create } from "zustand";

/**
 * A draft the person asked to send once a subscription limit frees up. It lives here, not in the banner,
 * so it survives the banner going away and coming back. Memory only: it is never written to storage.
 */
interface ComposerDraftState {
  held: string | null;
  /** Keep the text until the window opens. A blank text holds nothing. */
  hold: (text: string) => void;
  /** Hand the held text back and forget it; null when nothing was held. */
  take: () => string | null;
}

export const useComposerDraftStore = create<ComposerDraftState>((set, get) => ({
  held: null,
  hold: (text) => {
    const clean = text.trim();
    if (clean) set({ held: clean });
  },
  take: () => {
    const text = get().held;
    set({ held: null });
    return text;
  },
}));
