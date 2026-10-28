"use client";

import { useEffect, useMemo, useRef } from "react";

import { harnessFromSession, resolveHarness, type ThreadHarness } from "@/lib/chatHarness";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessRecentStore } from "@/store/harnessRecentStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";

const keyOf = (h: ThreadHarness) => (h.kind === "none" ? "none" : h.id);

/**
 * The harness of the chat on screen (ADR 0011). A chat that has one keeps it;
 * a chat that has none yet (the blank "new chat") follows the session choice,
 * which is also what the next chat starts with. The session store stays what
 * the run engine reads, so one instance (`sync`, in the chat stage) keeps it in
 * step: opening a chat applies that chat's harness, and a pick made elsewhere
 * (command palette, Studio "Use in chat") while a chat is open becomes the
 * chat's harness. Other instances only read.
 */
export function useChatHarness(sync = false) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const libraryFailed = useHarnessLibraryStore((s) => s.failed);
  const activate = useHarnessLibraryStore((s) => s.activate);
  const thread = useThreadStore((s) => s.threads.find((t) => t.id === s.activeThreadId));
  const setThreadHarness = useThreadStore((s) => s.setThreadHarness);

  const sessionBinding = harnessFromSession(enabled, activeBundle);
  const binding: ThreadHarness = thread?.harness ?? sessionBinding;
  const activeId = activeBundle?.manifest?.id ?? null;

  const available = useMemo(() => {
    const list = entries.map((e) => ({ id: e.id, name: e.name }));
    const current = activeBundle?.manifest;
    // A harness put in use from Studio is not a library entry but is really running.
    if (current?.id && !list.some((h) => h.id === current.id)) list.push({ id: current.id, name: current.name || current.id });
    return list;
  }, [entries, activeBundle]);
  const status = resolveHarness(binding, available, libraryHydrated || libraryFailed);

  const bound = thread?.harness;
  const synced = useRef("");
  const lastKey = useRef("");
  const sessionKey = keyOf(sessionBinding);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile on chat/binding/session changes only
  useEffect(() => {
    if (!sync) return;
    const syncId = `${thread?.id ?? ""}|${bound ? keyOf(bound) : ""}`;
    if (synced.current !== syncId) {
      if (!bound) {
        // A chat with no harness of its own follows the session.
        synced.current = syncId;
        lastKey.current = sessionKey;
      } else if (bound.kind === "none") {
        if (enabled) setEnabled(false);
        synced.current = syncId;
        lastKey.current = "none";
      } else if (status.state === "ready") {
        if (activeId !== bound.id) activate(bound.id);
        else if (!enabled) setEnabled(true);
        synced.current = syncId;
        lastKey.current = bound.id;
      }
      return;
    }
    if (sessionKey !== lastKey.current) {
      // The session moved under an open chat: that is the person's pick.
      lastKey.current = sessionKey;
      if (thread) setThreadHarness(thread.id, sessionBinding, binding);
    }
  }, [sync, thread?.id, bound && keyOf(bound), sessionKey, status.state]);

  const choose = (next: ThreadHarness) => {
    if (next.kind === "none") setEnabled(false);
    else if (next.id === activeId) setEnabled(true);
    else if (entries.some((e) => e.id === next.id)) activate(next.id);
    else return;
    if (next.kind === "harness") useHarnessRecentStore.getState().push(next.id);
    if (thread) setThreadHarness(thread.id, next, binding);
  };

  return { binding, status, choose, canSend: status.state === "none" || status.state === "ready" };
}
