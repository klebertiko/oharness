import type { NodeType } from "@/lib/types";
import type { Block, FailoverAttempt, RunState, Segment, ToolCall } from "./types";

export const emptyRun: RunState = {
  runId: null,
  status: "idle",
  mode: "mock",
  step: false,
  plan: [],
  cursor: -1,
  totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 },
  startedAt: null,
  endedAt: null,
  awaitingStep: null,
  steers: [],
  notices: [],
  routeDecision: null,
  subagents: [],
};

type Action =
  | { type: "reset"; mode: string; step: boolean }
  | { type: "clear" }
  | { type: "sse"; event: string; data: Record<string, never> | Record<string, unknown> }
  | { type: "transport-error"; message: string };

/**
 * A duration off the wire, or undefined when the backend did not actually
 * capture one. The sidecar emits a literal 0 for nodes it never timed (an
 * intrinsic node, an older log), and rendering that as "0ms" would present
 * an absent measurement as a real one. Tool calls pass `allowZero` because a
 * `tool_result` that does carry `duration_ms` can honestly be 0.
 */
function capturedMs(raw: unknown, allowZero = false): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw > 0 || (allowZero && raw === 0) ? raw : undefined;
}

/**
 * Whether the run's token total was estimated. The backend's own
 * `harness_done.tokens_estimated` decides; failing that, derive it from the
 * nodes' own flags (any estimated -> estimated; all stated real -> real).
 * Nothing stated anywhere stays `undefined` — unknown, not "measured".
 */
function runTokensEstimated(state: RunState, stated: unknown): boolean | undefined {
  if (typeof stated === "boolean") return stated;
  const flags = state.plan.map((s) => s.tokensEstimated).filter((f): f is boolean => f !== undefined);
  if (!flags.length) return undefined;
  return flags.some(Boolean);
}

function seg(view: Record<string, unknown>): Segment {
  return {
    nodeId: String(view.node_id),
    type: (view.type as NodeType) ?? "agent",
    label: String(view.label ?? view.type ?? "node"),
    adapter: String(view.adapter ?? ""),
    model: String(view.model ?? ""),
    intrinsic: Boolean(view.intrinsic),
    state: "pending",
    phase: "",
    phaseDetail: "",
    blocks: [],
  };
}

/** Replace one segment by id, leaving the rest referentially untouched. */
function patch(state: RunState, nodeId: string, fn: (s: Segment) => Segment): RunState {
  let hit = false;
  const plan = state.plan.map((s) => {
    if (s.nodeId !== nodeId) return s;
    hit = true;
    return fn(s);
  });
  if (!hit) return state;
  return { ...state, plan };
}

/**
 * Append streamed text to the trailing block when it is the same kind, so a
 * paragraph stays one block no matter how many chunks it arrived in.
 */
function appendText(blocks: Block[], kind: "reason" | "text", text: string): Block[] {
  const last = blocks[blocks.length - 1];
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { kind, text: last.text + text }];
  }
  return [...blocks, { kind, text }];
}

/** `node_start`'s `failover` key (AC#4) is present only once at least one
    earlier `providerIds` entry was tried and rejected — absent entirely for
    a plain pin, never `null`. Malformed/missing shape parses to `undefined`
    rather than an empty attempts list, so a segment can't show a failover
    badge with nothing to show inside it. */
function parseFailover(raw: unknown): Segment["failover"] {
  if (!raw || typeof raw !== "object") return undefined;
  const attempts = (raw as { attempts?: unknown }).attempts;
  if (!Array.isArray(attempts) || !attempts.length) return undefined;
  return {
    attempts: attempts.map((a): FailoverAttempt => {
      const o = (a ?? {}) as Record<string, unknown>;
      return { connectionId: String(o.connection_id ?? ""), reason: String(o.reason ?? "") };
    }),
  };
}

/** Contract §2.5 `args` may arrive as an object or as its JSON string. */
function parseToolArgs(raw: unknown): { argv?: string[]; path?: string } {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return {}; }
  }
  if (!obj || typeof obj !== "object") return {};
  const o = obj as Record<string, unknown>;
  const out: { argv?: string[]; path?: string } = {};
  if (Array.isArray(o.argv)) out.argv = o.argv.map(String);
  if (typeof o.path === "string") out.path = o.path;
  return out;
}

function patchTool(state: RunState, nodeId: string, callId: string, fn: (call: ToolCall) => ToolCall): RunState {
  return patch(state, nodeId, (s) => ({
    ...s,
    blocks: s.blocks.map((b) => (b.kind === "tool" && b.call.callId === callId ? { kind: "tool", call: fn(b.call) } : b)),
  }));
}

export function runReducer(state: RunState, action: Action): RunState {
  if (action.type === "clear") return emptyRun;
  if (action.type === "reset") {
    return { ...emptyRun, mode: action.mode, step: action.step, status: "starting" };
  }
  if (action.type === "transport-error") {
    return {
      ...state,
      status: "error",
      endedAt: Date.now(),
      notices: [...state.notices, action.message],
    };
  }

  const d = action.data as Record<string, string & number & boolean>;

  switch (action.event) {
    case "route_decision":
      return {
        ...state,
        routeDecision: {
          source:
            action.data.source === "laya" || action.data.source === "model_fallback"
              ? action.data.source
              : "model",
          reason: String(action.data.reason ?? ""),
          engageHarness: Boolean(action.data.engage_harness),
          confidence:
            typeof action.data.confidence === "number" ? action.data.confidence : null,
          latencyMs:
            typeof action.data.latency_ms === "number" ? action.data.latency_ms : null,
        },
      };

    case "run_start": {
      const order = (action.data.order as Record<string, unknown>[]) ?? [];
      const unreachable = (action.data.unreachable as string[]) ?? [];
      const unreachableNotice = `${unreachable.length} node${unreachable.length > 1 ? "s" : ""} unreachable — check for a cycle in the graph.`;
      return {
        ...state,
        runId: String(action.data.run_id ?? ""),
        mode: String(action.data.mode ?? state.mode),
        step: Boolean(action.data.step),
        status: "running",
        startedAt: Date.now(),
        plan: order.map(seg),
        cursor: -1,
        notices: unreachable.length && !state.notices.includes(unreachableNotice)
          ? [...state.notices, unreachableNotice]
          : state.notices,
      };
    }

    case "node_start": {
      const nodeId = String(action.data.node_id);
      const idx = state.plan.findIndex((s) => s.nodeId === nodeId);
      const next = patch(state, nodeId, (s) => ({
        ...s,
        state: "running",
        startedAt: Date.now(),
        // run_start's `order` is a pre-run preview built from the node's
        // static template data — every node defaults to "mock" there
        // regardless of what actually runs. This event fires right before
        // the real adapter resolution and carries the real answer (e.g.
        // "claude", not "mock"), so refresh the segment now rather than
        // showing the stale preview for the rest of the run.
        adapter: action.data.adapter !== undefined ? String(action.data.adapter) : s.adapter,
        model: action.data.model !== undefined ? String(action.data.model) : s.model,
        // Only present once real resolution happens (backend/engine.py) and
        // never on the harness-off direct path — see Segment.connectionId.
        connectionId:
          action.data.connection_id !== undefined ? String(action.data.connection_id) : s.connectionId,
        // Same "arrives on node_start, once real resolution happens" shape
        // as connectionId above — see Segment.failover's own doc comment.
        failover:
          action.data.failover !== undefined ? parseFailover(action.data.failover) : s.failover,
      }));
      return { ...next, cursor: idx, status: "running", awaitingStep: null };
    }

    case "node_phase":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        phase: (action.data.phase as Segment["phase"]) ?? "",
        phaseDetail: String(action.data.detail ?? ""),
      }));

    case "node_reason":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: appendText(s.blocks, "reason", String(action.data.chunk ?? "")),
      }));

    case "node_stream":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: appendText(s.blocks, "text", String(action.data.chunk ?? "")),
      }));

    case "tool_call": {
      const parsed = parseToolArgs(action.data.args);
      const call: ToolCall = {
        callId: String(action.data.call_id ?? ""),
        name: String(action.data.name ?? ""),
        args: typeof action.data.args === "string" ? action.data.args : JSON.stringify(action.data.args ?? ""),
        ...(action.data.origin === "model" || action.data.origin === "preset" ? { origin: action.data.origin } : {}),
        ...(parsed.argv ? { argv: parsed.argv } : {}),
        ...(parsed.path ? { path: parsed.path } : {}),
      };
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: [...s.blocks, { kind: "tool", call }],
      }));
    }

    case "tool_result":
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.kind === "tool" && b.call.callId === action.data.call_id
            ? {
                kind: "tool",
                call: {
                  ...b.call,
                  ok: Boolean(action.data.ok),
                  result: String(action.data.result ?? ""),
                  durationMs: capturedMs(action.data.duration_ms, true),
                  ...("truncated" in action.data ? { truncated: Boolean(action.data.truncated) } : {}),
                  ...("timed_out" in action.data ? { timedOut: Boolean(action.data.timed_out) } : {}),
                  ...("simulated" in action.data ? { simulated: Boolean(action.data.simulated) } : {}),
                  ...("redactions" in action.data ? { redactions: Number(action.data.redactions ?? 0) } : {}),
                  ...("exit_code" in action.data
                    ? { exitCode: action.data.exit_code === null ? null : Number(action.data.exit_code) }
                    : {}),
                },
              }
            : b
        ),
      }));

    /* ── chat tools broker: approval gate per call (contract v1.1 §2.5–2.6) ── */
    case "tool_approval_required":
      return {
        ...patchTool(state, String(d.node_id), String(action.data.call_id ?? ""), (call) => ({
          ...call,
          ...(call.argv ? {} : parseToolArgs(action.data.args)),
          approval: {
            reason: action.data.reason === "secret_pattern" ? "secret_pattern" : "exec",
            risk: action.data.risk === "high" ? "high" : "normal",
            riskHints: Array.isArray(action.data.risk_hints) ? action.data.risk_hints.map(String) : [],
          },
        })),
        status: "gate",
      };

    case "tool_approval_decision":
      return {
        ...patchTool(state, String(d.node_id), String(action.data.call_id ?? ""), (call) => ({
          ...call,
          approval: {
            ...(call.approval ?? { reason: "exec", risk: "normal", riskHints: [] }),
            decision: action.data.decision === "reject" ? "reject" : "approve",
            note: String(action.data.note ?? ""),
          },
        })),
        status: "running",
      };

    case "tool_auto_approved":
      return patchTool(state, String(d.node_id), String(action.data.call_id ?? ""), (call) => ({
        ...call,
        autoApproved: { mode: String(action.data.mode ?? ""), reason: String(action.data.reason ?? "") },
      }));

    case "tool_denied":
      return {
        ...patchTool(state, String(d.node_id), String(action.data.call_id ?? ""), (call) => ({
          ...call,
          ok: false,
          denied: {
            reason:
              action.data.reason === "approval_timeout" || action.data.reason === "policy"
                ? action.data.reason
                : "rejected",
            note: String(action.data.note ?? ""),
          },
        })),
        status: state.status === "gate" ? "running" : state.status,
      };

    case "capabilities": {
      const caps = action.data as unknown as NonNullable<RunState["capabilities"]>;
      const notice =
        caps.reason === "cli-adapter"
          ? "this provider doesn't request tools; /exec and /read stay available"
          : caps.reason === "provider-no-tools"
            ? "this model doesn't support tools; the reply continues as text only"
            : caps.reason === "no-workspace"
              ? "no folder selected: no tools in this conversation"
              : null;
      return {
        ...state,
        capabilities: caps,
        notices: notice && !state.notices.includes(notice) ? [...state.notices, notice] : state.notices,
      };
    }

    case "node_done": {
      const tokens = Number(action.data.tokens ?? 0);
      const next = patch(state, String(d.node_id), (s) => ({
        ...s,
        state: "done",
        phase: "",
        phaseDetail: "",
        output: String(action.data.output ?? ""),
        tokens,
        tokensEstimated: typeof action.data.tokens_estimated === "boolean" ? action.data.tokens_estimated : undefined,
        latencyMs: capturedMs(action.data.latency_ms),
        endedAt: Date.now(),
      }));
      return {
        ...next,
        totals: {
          ...next.totals,
          tokens: next.totals.tokens + tokens,
          nodesRun: next.totals.nodesRun + 1,
        },
      };
    }

    case "node_error": {
      const previous = state.plan.find((s) => s.nodeId === String(d.node_id))?.tokens ?? 0;
      const supplied = Number(action.data.tokens ?? previous);
      const tokens = Number.isFinite(supplied) && supplied >= 0 ? supplied : previous;
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          state: "error",
          phase: "",
          tokens,
          error: String(action.data.error ?? "Unknown error"),
          endedAt: Date.now(),
        })),
        totals: { ...state.totals, tokens: state.totals.tokens + tokens - previous },
        status: "error",
      };
    }

    case "node_skipped":
      // A PASS/FAIL branch this run didn't take (backend engine.py,
      // 2026-09-12) — distinct from "error": nothing went wrong, this path
      // just wasn't selected. `nodesRun` in `harness_done`'s totals already
      // excludes it; this only updates how the segment itself renders.
      return patch(state, String(d.node_id), (s) => ({
        ...s,
        state: "skipped",
        phase: "",
        endedAt: Date.now(),
      }));

    case "hitl_pause":
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          state: "gate",
          gate: {
            question: String(action.data.question ?? "Approve and continue?"),
            context: String(action.data.context ?? ""),
          },
        })),
        status: "gate",
      };

    case "hitl_resolved":
      return {
        ...patch(state, String(d.node_id), (s) => ({
          ...s,
          gate: s.gate
            ? {
                ...s.gate,
                decision: action.data.decision as "approve" | "reject",
                note: String(action.data.note ?? ""),
              }
            : s.gate,
        })),
        status: "running",
      };

    case "awaiting_step": {
      const next = (action.data.next as Record<string, unknown>) ?? {};
      return {
        ...state,
        status: "paused",
        awaitingStep: {
          nodeId: String(next.node_id ?? ""),
          label: String(next.label ?? ""),
          type: (next.type as NodeType) ?? "agent",
        },
      };
    }

    case "user_message":
      return {
        ...state,
        steers: [
          ...state.steers,
          { text: String(action.data.text ?? ""), atNode: String(action.data.at_node ?? "") },
        ],
      };

    case "subagent_start":
      return {
        ...state,
        subagents: [
          ...state.subagents,
          {
            id: String(action.data.child_id ?? ""),
            parentCallId: String(action.data.parent_call_id ?? ""),
            task: String(action.data.task ?? ""),
            state: "running",
            chars: 0,
            tokens: 0,
          },
        ],
      };

    case "subagent_progress":
      return {
        ...state,
        subagents: state.subagents.map((c) =>
          c.id === action.data.child_id ? { ...c, chars: Number(action.data.chars ?? c.chars) } : c
        ),
      };

    case "subagent_done": {
      const next = action.data.state;
      const finalState = next === "cancelled" || next === "error" ? next : "done";
      return {
        ...state,
        subagents: state.subagents.map((c) =>
          c.id === action.data.child_id
            ? { ...c, state: finalState, chars: Number(action.data.chars ?? c.chars), tokens: Number(action.data.tokens ?? 0) }
            : c
        ),
      };
    }

    case "run_stopped":
      return { ...state, status: "stopped" };

    case "harness_done": {
      const status = String(action.data.status ?? "complete");
      return {
        ...state,
        status:
          status === "complete" ? "complete" : status === "stopped" ? "stopped" : "error",
        endedAt: Date.now(),
        awaitingStep: null,
        totals: {
          tokens: Number(action.data.total_tokens ?? state.totals.tokens),
          nodesRun: Number(action.data.nodes_run ?? state.totals.nodesRun),
          elapsedMs: Number(action.data.elapsed_ms ?? 0),
          tokensEstimated: runTokensEstimated(state, action.data.tokens_estimated),
        },
        plan: state.plan.map((s) =>
          s.state === "pending" ? { ...s, state: "skipped" } : s
        ),
      };
    }

    case "error":
      return {
        ...state,
        status: "error",
        endedAt: Date.now(),
        notices: [...state.notices, String(action.data.error ?? "Stream error")],
      };

    default:
      return state;
  }
}
