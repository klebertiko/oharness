"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { tr } from "@/i18n/store";
import { chatToolsApi } from "@/lib/chatToolsApi";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, nextPermissionMode, type PermissionMode } from "@/lib/permissionMode";
import { usePermissionStore } from "@/store/permissionStore";


/**
 * The conversation's permission mode. The sidecar holds and enforces the
 * value; this hook selects it, caches it per thread for display, and never
 * leaves the screen claiming more than the sidecar accepted.
 */
export function usePermissionMode(threadId: string | null) {
  const mode = usePermissionStore((s) => s.modeFor(threadId));
  const [error, setError] = useState<string | null>(null);
  const edits = useRef(0);

  useEffect(() => {
    setError(null);
    if (!threadId) return;
    // A thread on the default has nothing to reconcile (and costs no request). Only a
    // cached non-default mode is checked against what the sidecar actually holds.
    if (usePermissionStore.getState().modeFor(threadId) === DEFAULT_PERMISSION_MODE) return;
    let cancelled = false;
    const seen = edits.current;
    chatToolsApi.getPermission(threadId).then(
      (stored) => {
        // The backend is the source of truth; an answer we do not know is `ask`.
        if (!cancelled && edits.current === seen) usePermissionStore.getState().setMode(threadId, isPermissionMode(stored.mode) ? stored.mode : DEFAULT_PERMISSION_MODE);
      },
      () => { /* offline: keep the cache; the sidecar enforces its own value regardless */ }
    );
    return () => { cancelled = true; };
  }, [threadId]);

  const setMode = useCallback(async (next: PermissionMode) => {
    const store = usePermissionStore.getState();
    const previous = store.modeFor(threadId);
    setError(null);
    edits.current++;
    store.setMode(threadId, next);
    if (!threadId) return; // no conversation yet: becomes the first thread's mode via adopt()
    try {
      await chatToolsApi.setPermission(threadId, next);
    } catch (failure) {
      usePermissionStore.getState().setMode(threadId, previous);
      setError((failure as { code?: string } | null)?.code === "plan_not_approved" ? tr("chat.permission.planWaiting") : tr("chat.permission.saveFailed"));
    }
  }, [threadId]);

  const cycle = useCallback(() => setMode(nextPermissionMode(usePermissionStore.getState().modeFor(threadId))), [setMode, threadId]);

  /** The first message created `newThreadId`: hand it the mode chosen before it existed. */
  const adopt = useCallback(async (newThreadId: string): Promise<PermissionMode> => {
    const store = usePermissionStore.getState();
    const chosen = store.modeFor(null);
    store.resetDraft();
    if (chosen === DEFAULT_PERMISSION_MODE) {
      store.setMode(newThreadId, chosen);
      return chosen;
    }
    try {
      await chatToolsApi.setPermission(newThreadId, chosen);
      usePermissionStore.getState().setMode(newThreadId, chosen);
      return chosen;
    } catch {
      usePermissionStore.getState().setMode(newThreadId, DEFAULT_PERMISSION_MODE);
      setError(tr("chat.permission.saveFailed"));
      return DEFAULT_PERMISSION_MODE;
    }
  }, []);

  return { mode, setMode, cycle, adopt, error };
}
