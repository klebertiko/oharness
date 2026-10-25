"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatToolsApi } from "@/lib/chatToolsApi";

const SAVE_FAILED = "Couldn't save workspace trust; the workspace stays untrusted.";

/**
 * Whether the person trusted the selected workspace. The sidecar stores and
 * enforces it (false by default); the screen only claims "trusted" after the
 * sidecar accepted it, and an unreachable sidecar reads as untrusted. Fetched
 * only while Auto is selected, the one mode where trust changes anything.
 */
export function useWorkspaceTrust(root: string | null, enabled: boolean) {
  const [state, setState] = useState<{ root: string; trusted: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edits = useRef(0);
  const trusted = Boolean(root && state && state.root === root && state.trusted);

  useEffect(() => {
    setError(null);
    if (!root || !enabled) return;
    let cancelled = false;
    const seen = edits.current;
    chatToolsApi.getTrust(root).then(
      (stored) => { if (!cancelled && edits.current === seen) setState({ root, trusted: stored.trusted === true }); },
      () => { /* unreachable: stay untrusted */ }
    );
    return () => { cancelled = true; };
  }, [root, enabled]);

  const setTrusted = useCallback(async (next: boolean) => {
    if (!root) return;
    setError(null);
    edits.current++;
    try {
      const stored = await chatToolsApi.setTrust(root, next);
      setState({ root, trusted: stored.trusted === true });
    } catch {
      setError(SAVE_FAILED);
    }
  }, [root]);

  return { trusted, setTrusted, error };
}
