"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * "Only this conversation": the model a person picked in the chat combo with
 * `s` (docs/adr/0014-chat-model-scope.md). It lives in the front end, per
 * thread and per connection, so the backend and the connection's saved default
 * (`setDefaultModel`) stay untouched. A thread with no entry for a connection
 * simply runs that connection's default. Picking with Enter writes the default
 * instead and clears the override, so the two never disagree.
 */
export interface ChatModelState {
  /** threadId -> connectionId -> model id. */
  overrides: Record<string, Record<string, string>>;
  /** Set (or, with an empty id, clear) the model one thread uses on one connection. */
  setOverride: (threadId: string, connectionId: string, model: string) => void;
  /** Forget everything a thread chose, e.g. when it is deleted. */
  clearThread: (threadId: string) => void;
  /** Drop overrides of threads that no longer exist. */
  prune: (liveThreadIds: string[]) => void;
}

export const CHAT_MODEL_STORAGE_KEY = "oh.chat.model.v1";

export const useChatModelStore = create<ChatModelState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (threadId, connectionId, model) =>
        set((s) => {
          const mine = { ...(s.overrides[threadId] ?? {}) };
          if (model) mine[connectionId] = model;
          else delete mine[connectionId];
          const next = { ...s.overrides };
          if (Object.keys(mine).length) next[threadId] = mine;
          else delete next[threadId];
          return { overrides: next };
        }),
      clearThread: (threadId) =>
        set((s) => {
          if (!(threadId in s.overrides)) return s;
          const next = { ...s.overrides };
          delete next[threadId];
          return { overrides: next };
        }),
      prune: (live) =>
        set((s) => {
          const keep = new Set(live);
          const next = Object.fromEntries(Object.entries(s.overrides).filter(([id]) => keep.has(id)));
          return Object.keys(next).length === Object.keys(s.overrides).length ? s : { overrides: next };
        }),
    }),
    { name: CHAT_MODEL_STORAGE_KEY, storage: createJSONStorage(() => localStorage) },
  ),
);

/** The model this thread runs on a connection, or "" when it follows the connection's default. */
export function modelOverride(overrides: ChatModelState["overrides"], threadId: string | null, connectionId: string): string {
  return (threadId && overrides[threadId]?.[connectionId]) || "";
}
