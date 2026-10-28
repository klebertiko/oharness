"use client";
import { useCallback, useEffect, useState } from "react";
import { chatToolsApi } from "@/lib/chatToolsApi";
import { usePermissionStore } from "@/store/permissionStore";

export interface WaitingPlan { planId: string; text: string }

const APPROVE_FAILED = "Couldn't approve the plan; this chat stays in Plan mode and nothing has run.";
const DISCARD_FAILED = "Couldn't discard the plan; it is still waiting.";

/**
 * The plan waiting for approval in a conversation. The sidecar holds and enforces it (a conversation cannot leave
 * Plan mode while one waits): this hook shows it, restores it after a reload, and relays Approve and Discard.
 */
export function usePlanArtifact(threadId: string | null, inPlanMode: boolean, fromRun: WaitingPlan | undefined) {
  const [restored, setRestored] = useState<WaitingPlan | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRestored(null);
    setError(null);
    if (!threadId || !inPlanMode) return;
    let cancelled = false;
    chatToolsApi.getPlan(threadId).then(
      (answer) => { if (!cancelled && answer.plan) setRestored({ planId: answer.plan.plan_id, text: answer.plan.text }); },
      () => { /* offline: the sidecar still enforces its own state */ },
    );
    return () => { cancelled = true; };
  }, [threadId, inPlanMode]);

  const candidate = fromRun ?? restored;
  const plan = candidate && candidate.planId !== resolved && threadId ? candidate : null;

  /** Returns the approved plan's text, or null when the sidecar refused. */
  const approve = useCallback(async (): Promise<string | null> => {
    if (!plan || !threadId) return null;
    setBusy(true);
    setError(null);
    try {
      const done = await chatToolsApi.approvePlan(threadId, plan.planId);
      usePermissionStore.getState().setMode(threadId, done.mode);
      setResolved(plan.planId);
      return plan.text;
    } catch {
      setError(APPROVE_FAILED);
      return null;
    } finally {
      setBusy(false);
    }
  }, [plan, threadId]);

  const discard = useCallback(async () => {
    if (!plan || !threadId) return;
    setBusy(true);
    setError(null);
    try {
      await chatToolsApi.discardPlan(threadId, plan.planId);
      setResolved(plan.planId);
    } catch {
      setError(DISCARD_FAILED);
    } finally {
      setBusy(false);
    }
  }, [plan, threadId]);

  return { plan, busy, error, approve, discard };
}
