"use client";

import { create } from "zustand";

/** What can wait behind one running turn. A bound, so a stuck run cannot pile up unbounded work. */
export const MAX_QUEUED = 20;

export interface QueuedMessage { id: string; text: string }

/**
 * Messages typed while a turn was running, per conversation. In memory only, like the run itself:
 * a queued message is a decision about the current turn, not a draft to restore later.
 */
interface QueueState {
  byThread: Record<string, QueuedMessage[]>;
  /** False when the text is blank or the queue is full. */
  enqueue: (threadId: string, text: string) => boolean;
  takeNext: (threadId: string) => QueuedMessage | null;
  remove: (threadId: string, id: string) => void;
  clear: (threadId: string) => void;
}

let counter = 0;
const without = (byThread: Record<string, QueuedMessage[]>, threadId: string, rest: QueuedMessage[]) => {
  const { [threadId]: _gone, ...others } = byThread;
  void _gone;
  return rest.length ? { ...others, [threadId]: rest } : others;
};

export const useMessageQueueStore = create<QueueState>()((set, get) => ({
  byThread: {},
  enqueue: (threadId, text) => {
    const trimmed = text.trim();
    const current = get().byThread[threadId] ?? [];
    if (!trimmed || current.length >= MAX_QUEUED) return false;
    set({ byThread: { ...get().byThread, [threadId]: [...current, { id: `q${++counter}`, text: trimmed }] } });
    return true;
  },
  takeNext: (threadId) => {
    const [next, ...rest] = get().byThread[threadId] ?? [];
    if (!next) return null;
    set({ byThread: without(get().byThread, threadId, rest) });
    return next;
  },
  remove: (threadId, id) => set({ byThread: without(get().byThread, threadId, (get().byThread[threadId] ?? []).filter((m) => m.id !== id)) }),
  clear: (threadId) => set({ byThread: without(get().byThread, threadId, []) }),
}));
