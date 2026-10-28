"use client";

import { useEffect, useMemo } from "react";

import { harnessFromSession, resolveHarness, type ThreadHarness } from "@/lib/chatHarness";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";

/**
 * The harness of the chat on screen (ADR 0011). A chat that has one keeps it;
 * a chat that has none yet (the blank "new chat") follows the session choice,
 * which is also what the next chat starts with. The session store stays what
 * the run engine reads, so it is kept in step with the chat's binding.
 */
export function useChatHarness() {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const setEnabled = useHarnessSessionStore((s) => s.setEnabled);
  const entries = useHarnessLibraryStore((s) => s.entries);
  const libraryReady = useHarnessLibraryStore((s) => s.hydrated);
  const activate = useHarnessLibraryStore((s) => s.activate);
  const thread = useThreadStore((s) => s.threads.find((t) => t.id === s.activeThreadId));
  const setThreadHarness = useThreadStore((s) => s.setThreadHarness);

  const sessionBinding = harnessFromSession(enabled, activeBundle);
  const binding: ThreadHarness = thread?.harness ?? sessionBinding;

  const available = useMemo(() => {
    const list = entries.map((e) => ({ id: e.id, name: e.name }));
    const current = activeBundle?.manifest;
    // A harness put in use from Studio is not a library entry but is really running.
    if (current?.id && !list.some((h) => h.id === current.id)) list.push({ id: current.id, name: current.name || current.id });
    return list;
  }, [entries, activeBundle]);
  const status = resolveHarness(binding, available, libraryReady);

  const bound = thread?.harness;
  const boundId = bound?.kind === "harness" ? bound.id : null;
  const activeId = activeBundle?.manifest?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the chat's binding, not the session's own changes
  useEffect(() => {
    if (!bound) return;
    if (bound.kind === "none") {
      if (enabled) setEnabled(false);
      return;
    }
    if (status.state !== "ready") return;
    if (activeId !== boundId) activate(bound.id);
    else if (!enabled) setEnabled(true);
  }, [thread?.id, bound?.kind, boundId, status.state]);

  const choose = (next: ThreadHarness) => {
    if (next.kind === "none") setEnabled(false);
    else if (next.id === activeId) setEnabled(true);
    else activate(next.id);
    if (thread) setThreadHarness(thread.id, next, binding);
  };

  return { binding, status, choose, canSend: status.state === "none" || status.state === "ready" };
}
