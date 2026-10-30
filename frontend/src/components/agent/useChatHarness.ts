"use client";

import { useEffect, useMemo } from "react";

import { harnessFromSession, resolveHarness, type ThreadHarness } from "@/lib/chatHarness";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessRecentStore } from "@/store/harnessRecentStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";

const keyOf = (h: ThreadHarness) => (h.kind === "none" ? "none" : h.id);

/**
 * What the sync last settled on. Module-level on purpose: the chat stage is
 * unmounted while Studio is open, and a pick made there ("Use in chat") has to
 * be seen as a pick when the stage comes back, not mistaken for a fresh start.
 */
const settled = { syncId: "", key: "" };
export function resetChatHarnessSync() {
  settled.syncId = "";
  settled.key = "";
}

/**
 * The harness of the chat on screen (ADR 0011). A chat that has one keeps it;
 * a chat that has none yet (the blank "new chat") follows the session choice,
 * which is also what the next chat starts with. The session store stays what
 * the run engine reads, so one instance (`sync`, in the chat stage) keeps it in
 * step: opening a chat applies that chat's harness, and a pick made elsewhere
 * (command palette, Studio "Use in chat") while a chat is open becomes the
 * chat's harness. It waits for the session to load and for a running turn to
 * end before touching the session. Other instances only read.
 */
export function useChatHarness(sync = false) {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const sessionReady = useHarnessSessionStore((s) => s.hydrated);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryHydrated = useHarnessLibraryStore((s) => s.hydrated);
  const libraryFailed = useHarnessLibraryStore((s) => s.failed);
  const activate = useHarnessLibraryStore((s) => s.activate);
  const hydrateLibrary = useHarnessLibraryStore((s) => s.hydrate);
  const running = useCanvasStore((s) => s.isRunning);
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

  // The stage must not depend on another component to start the library.
  useEffect(() => {
    if (sync && !libraryHydrated && !libraryFailed) void hydrateLibrary().catch(() => undefined);
  }, [sync, libraryHydrated, libraryFailed, hydrateLibrary]);

  const bound = thread?.harness;
  const sessionKey = keyOf(sessionBinding);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reconcile on chat/binding/session changes only
  useEffect(() => {
    if (!sync || !sessionReady || running) return;
    const syncId = `${thread?.id ?? ""}|${bound ? keyOf(bound) : ""}`;
    if (settled.syncId !== syncId) {
      if (!bound) {
        // A chat with no harness of its own follows the session.
        settled.syncId = syncId;
        settled.key = sessionKey;
      } else if (bound.kind === "none") {
        if (enabled) setEnabled(false);
        settled.syncId = syncId;
        settled.key = "none";
      } else if (status.state === "ready") {
        if (activeId !== bound.id) {
          // A saved harness loads its graph first; if that fails the session stays as it was, and that is not a pick.
          void activate(bound.id).then((ok) => {
            if (!ok) settled.key = keyOf(harnessFromSession(useHarnessSessionStore.getState().enabled, useHarnessSessionStore.getState().activeBundle));
          });
        } else if (!enabled) setEnabled(true);
        settled.syncId = syncId;
        settled.key = bound.id;
      }
      return;
    }
    // A saved harness is still loading: the session has not moved on its own.
    if (sessionKey !== settled.key && !useHarnessLibraryStore.getState().activating) {
      // The session moved under an open chat: that is the person's pick.
      settled.key = sessionKey;
      if (thread) setThreadHarness(thread.id, sessionBinding, binding);
    }
  }, [sync, sessionReady, running, thread?.id, bound && keyOf(bound), sessionKey, status.state]);

  const choose = (next: ThreadHarness) => {
    const settle = () => {
      if (next.kind === "harness") useHarnessRecentStore.getState().push(next.id);
      if (thread) setThreadHarness(thread.id, next, binding);
    };
    useHarnessLibraryStore.getState().cancelActivation();
    if (next.kind === "none") setEnabled(false);
    else if (next.id === activeId) setEnabled(true);
    else {
      const entry = entries.find((e) => e.id === next.id);
      if (!entry) return;
      const loaded = activate(next.id);
      if (entry.source === "saved") {
        // Its graph is fetched first; the chat only moves to a harness that is really loaded.
        void loaded.then((ok) => ok && settle());
        return;
      }
    }
    settle();
  };

  // A saved harness is run from its fetched graph: until the session holds it (or if it couldn't be loaded) the chat would run something else.
  const notLoaded = binding.kind === "harness" && activeId !== binding.id && entries.some((e) => e.id === binding.id && e.source === "saved");
  return { binding, status, choose, canSend: sessionReady && !notLoaded && (status.state === "none" || status.state === "ready") };
}
