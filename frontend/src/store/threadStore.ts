"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { harnessLabel, sameHarness, switchNotice, type ThreadHarness } from "@/lib/chatHarness";
import { usePermissionStore } from "./permissionStore";

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Hidden from the main list, kept under "Archived" until restored or deleted. */
  archived?: boolean;
  /** The harness this chat runs its next turns with. Absent on chats from before the field existed. */
  harness?: ThreadHarness;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  /** Which connection actually answered — set on assistant replies from an
      Auto pick, so the composer chip can stay "Auto" while the transcript
      still says which provider ran. Absent for a person's explicit pick. */
  providerLabel?: string;
  /** The harness run that produced this reply, when there was one (never set
      for a direct/no-harness turn). `HistoricalRunDetail` fetches
      GET /execute/logs/{runId} and replays it through runReducer to rebuild
      "Show run detail" after a reload — the live run state itself is
      in-memory only and does not survive one. */
  runId?: string;
  /** The harness that produced this reply (or, on a `system` marker, the one chosen). */
  harness?: ThreadHarness;
  /** On a `system` marker: the harness the chat was running before the change. */
  from?: ThreadHarness;
};

/** Is the last message a fresh harness change (the only moment a chat can be forked for it)? */
export const canForkForHarness = (messages: ThreadMessage[]): boolean => {
  const last = messages.at(-1);
  return last?.role === "system" && !!last.harness && !!last.from;
};

export const THREADS_STORAGE_KEY = "oh.threads.v1";

export const DEFAULT_THREAD_TITLE = "New chat";

export interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;
  messagesByThread: Record<string, ThreadMessage[]>;
  createThread: (title?: string, harness?: ThreadHarness) => string;
  /** Change the harness of the next turns. After messages exist it leaves a marker in the transcript. */
  setThreadHarness: (threadId: string, harness: ThreadHarness, from?: ThreadHarness) => void;
  /** Give a chat from before the setting the harness it is running with. Never overrides one, never leaves a marker. */
  bindThreadHarness: (threadId: string, harness: ThreadHarness) => void;
  /** While a harness change is the last thing in a chat: copy the chat into a new one on the new harness and put the original back. Returns the new chat's id, or null when it no longer applies. */
  forkThreadForHarness: (threadId: string) => string | null;
  selectThread: (id: string) => void;
  /** Blank slate: no thread is created until the first message is sent. */
  startNewChat: () => void;
  renameThread: (id: string, title: string) => void;
  archiveThread: (id: string) => void;
  restoreThread: (id: string) => void;
  deleteThread: (id: string) => void;
  ensureActiveThread: () => string;
  appendMessage: (
    threadId: string,
    message: Omit<ThreadMessage, "id" | "createdAt"> & { id?: string; createdAt?: number }
  ) => void;
  messagesFor: (threadId: string | null) => ThreadMessage[];
}

export const useThreadStore = create<ThreadState>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,
      messagesByThread: {},

      createThread: (title, harness) => {
        const now = Date.now();
        const id = crypto.randomUUID();
        const thread: Thread = {
          id,
          title: title?.trim() || DEFAULT_THREAD_TITLE,
          createdAt: now,
          updatedAt: now,
          archived: false,
          ...(harness ? { harness } : {}),
        };
        set({
          threads: [thread, ...get().threads],
          activeThreadId: id,
          messagesByThread: { ...get().messagesByThread, [id]: [] },
        });
        return id;
      },

      setThreadHarness: (threadId, harness, from) => {
        const thread = get().threads.find((t) => t.id === threadId);
        if (!thread) return;
        // `from` is what the chat was effectively running (a chat from before the field has no binding yet).
        const previous = from ?? thread.harness;
        if (previous && sameHarness(previous, harness)) {
          // Same harness: bind the chat (and refresh a renamed one) without saying anything.
          const current = thread.harness;
          if (!current || (current.kind === "harness" && harness.kind === "harness" && current.name !== harness.name)) {
            set({ threads: get().threads.map((t) => (t.id === threadId ? { ...t, harness } : t)) });
          }
          return;
        }
        const now = Date.now();
        const messages = get().messagesByThread[threadId] ?? [];
        const last = messages.at(-1);
        // Several picks before the next message are one change: fold them into a single marker, or none if the chat ends up where it started.
        const open = last?.role === "system" && last.harness && last.from ? last : undefined;
        const origin = open?.from ?? previous;
        const kept = open ? messages.slice(0, -1) : messages;
        const back = !!origin && sameHarness(origin, harness);
        const marker: ThreadMessage[] =
          messages.length > 0 && !back
            ? [{ id: crypto.randomUUID(), role: "system", content: switchNotice(harness), createdAt: now, harness, ...(origin ? { from: origin } : {}) }]
            : [];
        set({
          threads: get().threads.map((t) => (t.id === threadId ? { ...t, harness, updatedAt: messages.length > 0 ? now : t.updatedAt } : t)),
          messagesByThread: { ...get().messagesByThread, [threadId]: [...kept, ...marker] },
        });
      },

      forkThreadForHarness: (threadId) => {
        const thread = get().threads.find((t) => t.id === threadId);
        const messages = get().messagesByThread[threadId] ?? [];
        const marker = messages.at(-1);
        if (!thread || !marker?.harness || !marker.from || !canForkForHarness(messages)) return null;
        const kept = messages.slice(0, -1);
        const now = Date.now();
        const id = crypto.randomUUID();
        const copy: Thread = { id, title: `${thread.title} · ${harnessLabel(marker.harness)}`, createdAt: now, updatedAt: now, archived: false, harness: marker.harness };
        set({
          threads: [copy, ...get().threads.map((t) => (t.id === threadId ? { ...t, harness: marker.from, updatedAt: kept.at(-1)?.createdAt ?? t.updatedAt } : t))],
          activeThreadId: id,
          messagesByThread: {
            ...get().messagesByThread,
            [threadId]: kept,
            [id]: kept.map((m) => ({ ...m, id: crypto.randomUUID() })),
          },
        });
        return id;
      },

      bindThreadHarness: (threadId, harness) => {
        if (get().threads.find((t) => t.id === threadId)?.harness) return;
        set({ threads: get().threads.map((t) => (t.id === threadId ? { ...t, harness } : t)) });
      },

      selectThread: (id) => {
        if (!get().threads.some((t) => t.id === id)) return;
        set({ activeThreadId: id });
      },

      startNewChat: () => set({ activeThreadId: null }),

      renameThread: (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const now = Date.now();
        set({
          threads: get().threads.map((t) =>
            t.id === id ? { ...t, title: trimmed, updatedAt: now } : t
          ),
        });
      },

      archiveThread: (id) => {
        set({
          threads: get().threads.map((t) => (t.id === id ? { ...t, archived: true } : t)),
        });
        if (get().activeThreadId === id) {
          const nextActive = get().threads.find((t) => t.id !== id && !t.archived)?.id ?? null;
          set({ activeThreadId: nextActive });
        }
      },

      restoreThread: (id) => {
        set({
          threads: get().threads.map((t) => (t.id === id ? { ...t, archived: false } : t)),
        });
      },

      deleteThread: (id) => {
        usePermissionStore.getState().forget(id);
        const rest = get().threads.filter((t) => t.id !== id);
        const nextMessages = { ...get().messagesByThread };
        delete nextMessages[id];
        const nextActive =
          get().activeThreadId === id ? (rest.find((t) => !t.archived)?.id ?? null) : get().activeThreadId;
        set({ threads: rest, messagesByThread: nextMessages, activeThreadId: nextActive });
      },

      ensureActiveThread: () => {
        const { activeThreadId, threads, createThread } = get();
        if (activeThreadId && threads.some((t) => t.id === activeThreadId && !t.archived)) {
          return activeThreadId;
        }
        const firstOpen = threads.find((t) => !t.archived);
        if (firstOpen) {
          set({ activeThreadId: firstOpen.id });
          return firstOpen.id;
        }
        return createThread();
      },

      appendMessage: (threadId, message) => {
        const now = Date.now();
        const full: ThreadMessage = {
          id: message.id ?? crypto.randomUUID(),
          role: message.role,
          content: message.content,
          createdAt: message.createdAt ?? now,
          providerLabel: message.providerLabel,
          runId: message.runId,
          ...(message.harness ? { harness: message.harness } : {}),
        };
        const prev = get().messagesByThread[threadId] ?? [];
        set({
          messagesByThread: { ...get().messagesByThread, [threadId]: [...prev, full] },
          threads: get().threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  updatedAt: now,
                  title:
                    t.title === DEFAULT_THREAD_TITLE && message.role === "user"
                      ? message.content.slice(0, 48).trim() || t.title
                      : t.title,
                }
              : t
          ),
        });
      },

      messagesFor: (threadId) => {
        if (!threadId) return [];
        return get().messagesByThread[threadId] ?? [];
      },
    }),
    {
      name: THREADS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        messagesByThread: state.messagesByThread,
      }),
      version: 3,
      migrate: (persisted) => {
        const p = persisted as Partial<ThreadState> & { messagesByThread?: unknown };
        return {
          threads: Array.isArray(p.threads)
            ? p.threads.map((t) => ({ ...t, archived: Boolean((t as Thread).archived) }))
            : [],
          activeThreadId: typeof p.activeThreadId === "string" ? p.activeThreadId : null,
          messagesByThread:
            p.messagesByThread && typeof p.messagesByThread === "object"
              ? (p.messagesByThread as Record<string, ThreadMessage[]>)
              : {},
        };
      },
    }
  )
);
