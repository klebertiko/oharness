"use client";

import { create } from "zustand";
import { useChatProviderStore } from "./chatProviderStore";

/** Why the chat's account was passed over: the closed classes the sidecar sends, nothing else. */
export const FALLBACK_REASONS = ["usage_limit", "signin", "unavailable", "failed"] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export function fallbackReason(value: unknown): FallbackReason {
  return typeof value === "string" && (FALLBACK_REASONS as readonly string[]).includes(value) ? (value as FallbackReason) : "failed";
}

export type FallbackNoticeState = {
  /** The account the chat asked for, and the one that answered. */
  fromId: string;
  toId: string;
  reason: FallbackReason;
  /** The chat's choice before it followed `toId` (null = Auto), restored by Back. */
  previous: string | null;
};

/**
 * A chat turn was answered by another account of the saved order. The chat
 * then follows that account, so the next turn does not wait on the one that
 * just failed; Back puts the previous choice back. Session only: ids and a
 * closed class, never a provider's words.
 */
export interface ChatFallbackState {
  notice: FallbackNoticeState | null;
  note: (fromId: string, toId: string, reason: FallbackReason) => void;
  back: () => void;
  dismiss: () => void;
}

export const useChatFallbackStore = create<ChatFallbackState>((set, get) => ({
  notice: null,
  note: (fromId, toId, reason) => {
    const chat = useChatProviderStore.getState();
    set({ notice: { fromId, toId, reason, previous: chat.chosenId } });
    chat.setChosen(toId);
  },
  back: () => {
    const notice = get().notice;
    set({ notice: null });
    if (notice) useChatProviderStore.getState().setChosen(notice.previous);
  },
  dismiss: () => set({ notice: null }),
}));
