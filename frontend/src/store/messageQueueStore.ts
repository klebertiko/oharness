"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { NEW_CHAT_KEY } from "./chatModelStore";

export const QUEUE_STORAGE_KEY = "oh.messageQueue.v1";

/** What can wait behind one running turn. A bound, so a stuck run cannot pile up unbounded work. */
export const MAX_QUEUED = 20;
/** One queued message is capped too: the queue lives in localStorage, whose quota is small and shared. */
export const MAX_QUEUED_CHARS = 4000;

export interface QueuedMessage { id: string; text: string }
export type QueueRefusal = "empty" | "long" | "full";

/**
 * Messages typed while a turn was running, per conversation. They survive a reload (they are work the person
 * asked for), but a restored queue comes back PAUSED: nothing runs until a person presses "Send next".
 */
interface QueueState {
  byThread: Record<string, QueuedMessage[]>;
  /** Conversations whose queue was restored from storage and has not been resumed or cleared. Not persisted. */
  pausedThreads: Record<string, true>;
  /** False when the text is blank, too long, or the queue is full (`queueRefusal` says which). */
  enqueue: (threadId: string, text: string) => boolean;
  takeNext: (threadId: string) => QueuedMessage | null;
  remove: (threadId: string, id: string) => void;
  clear: (threadId: string) => void;
}

let counter = 0;
const newId = () => `q${Date.now().toString(36)}-${++counter}`;

const pick = <V,>(record: Record<string, V>, keep: (key: string) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => keep(key))) as Record<string, V>;

const without = (byThread: Record<string, QueuedMessage[]>, threadId: string, rest: QueuedMessage[]) => {
  const { [threadId]: _gone, ...others } = byThread;
  void _gone;
  return rest.length ? { ...others, [threadId]: rest } : others;
};

/** Why this text cannot join the queue of `threadId` right now, or null when it can. */
export function queueRefusal(threadId: string, text: string): QueueRefusal | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_QUEUED_CHARS) return "long";
  if ((useMessageQueueStore.getState().byThread[threadId]?.length ?? 0) >= MAX_QUEUED) return "full";
  return null;
}

/** Whatever storage held is data, not trusted: keep only well-formed, bounded messages. */
export function restoreQueue(raw: unknown): Record<string, QueuedMessage[]> {
  const byThread: Record<string, QueuedMessage[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return byThread;
  for (const [threadId, list] of Object.entries(raw as Record<string, unknown>)) {
    // `__proto__` as a key would swap the prototype of `byThread` instead of adding an entry.
    if (threadId === "__proto__" || !Array.isArray(list)) continue;
    const kept: QueuedMessage[] = [];
    for (const item of list) {
      if (kept.length >= MAX_QUEUED || !item || typeof item !== "object") continue;
      const { id, text } = item as { id?: unknown; text?: unknown };
      if (typeof id !== "string" || !id || typeof text !== "string" || kept.some((m) => m.id === id)) continue;
      const trimmed = text.trim();
      if (trimmed && trimmed.length <= MAX_QUEUED_CHARS) kept.push({ id, text: trimmed });
    }
    if (kept.length) byThread[threadId] = kept;
  }
  return byThread;
}

/** Storage that never throws: a full or blocked localStorage must not break typing. */
const safeStorage: StateStorage = {
  getItem: (name) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name, value) => { try { localStorage.setItem(name, value); } catch { /* quota or blocked: the queue stays in memory */ } },
  removeItem: (name) => { try { localStorage.removeItem(name); } catch { /* nothing to remove */ } },
};

export const useMessageQueueStore = create<QueueState>()(
  persist(
    (set, get) => ({
      byThread: {},
      pausedThreads: {},
      enqueue: (threadId, text) => {
        if (queueRefusal(threadId, text)) return false;
        const current = get().byThread[threadId] ?? [];
        set({ byThread: { ...get().byThread, [threadId]: [...current, { id: newId(), text: text.trim() }] } });
        return true;
      },
      takeNext: (threadId) => {
        const [next, ...rest] = get().byThread[threadId] ?? [];
        if (!next) return null;
        set({ byThread: without(get().byThread, threadId, rest), pausedThreads: pick(get().pausedThreads, (k) => k !== threadId) });
        return next;
      },
      remove: (threadId, id) => {
        const rest = (get().byThread[threadId] ?? []).filter((m) => m.id !== id);
        set({ byThread: without(get().byThread, threadId, rest), pausedThreads: rest.length ? get().pausedThreads : pick(get().pausedThreads, (k) => k !== threadId) });
      },
      clear: (threadId) => set({ byThread: without(get().byThread, threadId, []), pausedThreads: pick(get().pausedThreads, (k) => k !== threadId) }),
    }),
    {
      name: QUEUE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // NEW_CHAT_KEY is the key for a chat that has no thread yet: nothing to come back to after a reload.
      partialize: (state) => ({ byThread: pick(state.byThread, (key) => key !== NEW_CHAT_KEY) }),
      merge: (persisted, current) => {
        const byThread = restoreQueue((persisted as { byThread?: unknown } | undefined)?.byThread);
        return { ...current, byThread, pausedThreads: Object.fromEntries(Object.keys(byThread).map((id) => [id, true as const])) };
      },
    },
  ),
);
