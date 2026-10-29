"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { HarnessGraph } from "@/lib/types";
import { useActiveRunStore } from "@/store/activeRunStore";
import { useProviderStore } from "@/components/providers/providerStore";
import { useUsageStore } from "@/components/providers/usageStore";
import { emptyRun, runReducer } from "./runReducer";
import { useRunBudgetStore } from "@/store/runBudgetStore";
import { sendControl, startDirectRun, startRun, type DirectRunPayload } from "./runClient";
import type { RunState } from "./types";

export interface RunController {
  run: RunState;
  /** Milliseconds since the run opened — ticks while live, freezes when it ends. */
  elapsed: number;
  live: boolean;
  /** Cancel any stream and return to a blank run (used by New chat). */
  reset: () => void;
  start: (opts: { instruction: string; mode: string; step: boolean; cwd?: string; providerId?: string; model?: string; tools?: DirectRunPayload["tools"] }) => void;
  stop: () => void;
  advance: () => void;
  resolveGate: (decision: "approve" | "reject", note: string) => void;
  /** Tool approval (contract §2.6): one decision per `call_id`, consumed once by the backend. */
  resolveToolCall: (callId: string, decision: "approve" | "reject", note?: string) => void;
  steer: (text: string) => void;
}

const LIVE = new Set(["starting", "running", "gate", "paused"]);

export interface UseRunStreamOptions {
  /** Active when harnessSessionStore.enabled — engine walks this graph. */
  graph: HarnessGraph;
  /** When false, start hits `/api/run/direct` instead of `/api/run`. */
  harnessEnabled: boolean;
}

function maxTokensPayload(): { max_tokens?: number } {
  const maxTokens = useRunBudgetStore.getState().maxTokens;
  return maxTokens ? { max_tokens: maxTokens } : {};
}

export function useRunStream({ graph, harnessEnabled }: UseRunStreamOptions): RunController {
  const [run, dispatch] = useReducer(runReducer, emptyRun);
  const abortRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const harnessEnabledRef = useRef(harnessEnabled);
  harnessEnabledRef.current = harnessEnabled;
  const setRunId = useActiveRunStore((s) => s.setRunId);
  const live = LIVE.has(run.status);

  const reset = useCallback(() => {
    generationRef.current++;
    abortRef.current?.();
    abortRef.current = null;
    dispatch({ type: "clear" });
    setElapsed(0);
    useActiveRunStore.getState().setRunId(null);
  }, []);

  /* One shared clock for the header, the now-line and the gate. A run that has
     been parked at a human gate for four minutes should say so; freezing the
     timer the moment the tokens stop would hide exactly that. */
  const [elapsed, setElapsed] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-run on run start/end or live change only; elapsed is the frozen value to keep, not a trigger
  useEffect(() => {
    if (!run.startedAt) return;
    if (!live) {
      setElapsed(run.endedAt ? run.endedAt - run.startedAt : elapsed);
      return;
    }
    const id = window.setInterval(() => setElapsed(Date.now() - run.startedAt!), 100);
    setElapsed(Date.now() - run.startedAt);
    return () => window.clearInterval(id);
  }, [run.startedAt, run.endedAt, live]);

  useEffect(() => {
    setRunId(live ? run.runId : null);
  }, [live, run.runId, setRunId]);

  const start = useCallback(
    ({
      instruction,
      mode,
      step,
      cwd,
      providerId,
      model,
      tools,
    }: {
      instruction: string;
      mode: string;
      step: boolean;
      cwd?: string;
      providerId?: string;
      model?: string;
      tools?: DirectRunPayload["tools"];
    }) => {
      const generation = ++generationRef.current;
      abortRef.current?.();
      dispatch({ type: "reset", mode, step });
      let terminal = false;
      let refreshed = false;
      const refreshUsage = () => {
        if (refreshed) return;
        refreshed = true;
        void useUsageStore.getState().refresh();
      };
      const onEvent = (event: string, data: Record<string, unknown>) => {
        if (generation !== generationRef.current || terminal) return;
        // Only backend completion evidence proves contact, including triage
        // events that have no segment in the preview plan.
        const id = data.connection_id;
        if (event === "node_done" && data.provider_verified === true && typeof id === "string" && id.trim()) {
          useProviderStore.getState().reportRunOutcome(id, { ok: true });
        }
        if (event === "node_error" && typeof id === "string" && id.trim() &&
            (data.provider_failure === "authentication" || data.provider_failure === "transport")) {
          useProviderStore.getState().reportRunOutcome(id, {
            ok: false,
            detail: data.provider_failure === "authentication"
              ? "Provider authentication failed. Test the connection after signing in."
              : "Provider transport failed. Test the connection to check reachability.",
          });
        }
        dispatch({ type: "sse", event, data });
        if (event === "harness_done" || event === "error") {
          terminal = true;
          refreshUsage();
        }
      };
      const onClose = (err?: Error) => {
        if (generation !== generationRef.current) return;
        if (!terminal) {
          terminal = true;
          dispatch({ type: "transport-error", message: err?.message ?? "Run stream closed before completion." });
        }
        refreshUsage();
        useActiveRunStore.getState().setRunId(null);
      };

      // A slash-menu Tool is an explicit direct broker action. It must not be
      // swallowed by the currently enabled harness graph.
      // In Plan mode the turn is answered directly and ends in a plan: the harness graph runs after approval.
      if (harnessEnabledRef.current && !tools?.preset && tools?.permission_mode !== "plan") {
        abortRef.current = startRun(
          { graph_json: graphRef.current, mode, step, instruction, cwd, ...maxTokensPayload() },
          onEvent,
          onClose
        );
      } else {
        abortRef.current = startDirectRun(
          { instruction, mode, step, cwd, connection_id: providerId, ...(model ? { model } : {}), ...(tools ? { tools } : {}), ...maxTokensPayload() },
          onEvent,
          onClose
        );
      }
    },
    []
  );

  const stop = useCallback(() => {
    if (run.runId) void sendControl(run.runId, { action: "stop" });
    // Do not abort the fetch here: the engine unwinds at its next checkpoint
    // and emits `run_stopped` + `harness_done`, which is what tells the panel
    // where it actually got to.
  }, [run.runId]);

  const advance = useCallback(() => {
    if (run.runId) void sendControl(run.runId, { action: "step" });
  }, [run.runId]);

  const resolveGate = useCallback(
    (decision: "approve" | "reject", note: string) => {
      if (run.runId) void sendControl(run.runId, { action: "resume", decision, note });
    },
    [run.runId]
  );

  const resolveToolCall = useCallback(
    (callId: string, decision: "approve" | "reject", note = "") => {
      if (run.runId) void sendControl(run.runId, { action: "resume", decision, call_id: callId, note });
    },
    [run.runId]
  );

  const steer = useCallback(
    (text: string) => {
      if (run.runId) void sendControl(run.runId, { action: "message", text });
    },
    [run.runId]
  );

  useEffect(() => () => {
    generationRef.current++;
    abortRef.current?.();
  }, []);

  return { run, elapsed, live, reset, start, stop, advance, resolveGate, resolveToolCall, steer };
}
