import type { NodeType } from "@/lib/types";

/** One tool invocation, from call to result. */
export interface ToolCall {
  callId: string;
  name: string;
  /** Raw args as the engine sent them (string or JSON-encoded object). */
  args: string;
  ok?: boolean;
  result?: string;
  durationMs?: number;
  /* ── chat tools broker (contract v1.1 §2.5) ── */
  /** Who asked: the model, or the user via a `/` preset. */
  origin?: "model" | "preset";
  /** Parsed from `args` when the tool is `exec` — shown one item per line on the approval card. */
  argv?: string[];
  /** Parsed from `args` when the tool is `read`. */
  path?: string;
  /** Present once the run parked on the approval gate for this call. */
  approval?: {
    reason: "exec" | "secret_pattern";
    risk: "normal" | "high";
    riskHints: string[];
    decision?: "approve" | "reject";
    note?: string;
  };
  /** The permission mode, not a person, let this command run without the approval gate. */
  autoApproved?: { mode: string; reason: string };
  denied?: { reason: "rejected" | "approval_timeout" | "policy" | "hook"; note: string; /** The permission mode that refused it (absent for a refusal that is not about the mode). */ mode?: string };
  /** The pre-tool hook that decided, from `tool_hook_decision` (one entry per hook evaluated, in order). */
  hooks?: { hookId: string; decision: "allow" | "block"; reason: string }[];
  truncated?: boolean;
  timedOut?: boolean;
  simulated?: boolean;
  redactions?: number;
  exitCode?: number | null;
}

/** `capabilities` event / `GET /chat/tools/capabilities` (contract v1.1 §2.1). */
export interface ToolCapabilities {
  workspace: { root: string; name: string } | null;
  provider_kind: "http" | "cli" | "mock";
  tools: { discover: boolean; read: boolean; exec: boolean };
  preset: { read: boolean; exec: boolean };
  reason: "ok" | "no-workspace" | "cli-adapter" | "provider-no-tools" | "mock";
  limits: Record<string, number>;
}

/**
 * A run of contiguous same-kind output inside one node.
 *
 * Streamed text is coalesced into the trailing block rather than appended as
 * one element per token — a 900-token answer is one paragraph to a reader, and
 * 900 DOM nodes to a browser.
 */
export type Block =
  | { kind: "reason"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; call: ToolCall };

/** One providerIds entry that was tried and rejected before the connection
    that actually served the turn (PROVIDER-FAILOVER story, AC#4). */
export interface FailoverAttempt {
  connectionId: string;
  reason: string;
}

export type SegmentState = "pending" | "running" | "gate" | "done" | "error" | "skipped";

export type Phase = "thinking" | "tool" | "writing" | "routing" | "";

export interface Segment {
  nodeId: string;
  type: NodeType;
  label: string;
  adapter: string;
  model: string;
  intrinsic: boolean;
  /** Which connection actually ran this node — carried on `node_start` once
      real resolution happens (backend/engine.py), same way `adapter`/`model`
      arrive late. Absent for a run_start preview segment, and absent
      entirely on the harness-off `/execute/direct` path, which resolves no
      connection at all (see runClient.ts's `DirectRunPayload`). A harness
      graph node can pin its own connection, different from the one the chat
      composer resolved — this is what lets a run's outcome be credited to
      the connection that actually produced it instead of whichever one the
      composer happened to have selected. */
  connectionId?: string;
  /** Present only when `connectionId` above is not this node's first
      `providerIds` entry — one or more earlier connections were tried and
      rejected first (backend/engine.py's `node_view["failover"]`, AC#4). A
      plain pin never carries this key at all (absent, not null/empty), so
      it is the one honest signal that distinguishes "pinned" from
      "failed over" — never inferred from connectionId alone. */
  failover?: { attempts: FailoverAttempt[] };

  state: SegmentState;
  phase: Phase;
  phaseDetail: string;

  blocks: Block[];
  output?: string;
  tokens?: number;
  /** Token provenance from `node_done.tokens_estimated`: true = approximated
      from output length, false = the provider reported it. Absent = the
      backend (or an older saved log) never said — unknown, not "real". */
  tokensEstimated?: boolean;
  /** Wall time of the node, only when the backend captured one. Absent means
      "not captured" — a 0 from the wire is never stored as a measurement. */
  latencyMs?: number;
  error?: string;

  gate?: {
    question: string;
    context: string;
    decision?: "approve" | "reject";
    note?: string;
  };

  startedAt?: number;
  endedAt?: number;
}

export interface Subagent {
  id: string;
  parentCallId: string;
  task: string;
  state: "running" | "done" | "cancelled" | "error";
  chars: number;
  tokens: number;
}

export interface TurnDiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  binary: boolean;
  revertible: boolean;
  diff: string;
  diff_truncated: boolean;
}

export interface TurnDiff {
  files: TurnDiffFile[];
  omitted: number;
  /** False when the workspace was too large to snapshot fully. */
  complete: boolean;
}

export type RunStatus =
  | "idle"
  | "starting"
  | "running"
  | "gate"
  | "paused"
  | "stopped"
  | "complete"
  | "error";

export interface RouteDecision {
  source: "laya" | "model_fallback" | "model";
  reason: string;
  engageHarness: boolean;
  confidence: number | null;
  latencyMs: number | null;
}

export interface RunState {
  runId: string | null;
  status: RunStatus;
  /** What this run's provider/workspace can do with tools — from the `capabilities` event. */
  capabilities?: ToolCapabilities | null;
  mode: string;
  step: boolean;
  plan: Segment[];
  cursor: number;
  totals: {
    tokens: number;
    nodesRun: number;
    /** `harness_done.elapsed_ms`; 0 means the backend did not capture a duration. */
    elapsedMs: number;
    /** Run-wide token provenance (see Segment.tokensEstimated); absent = unknown. */
    tokensEstimated?: boolean;
  };
  startedAt: number | null;
  endedAt: number | null;
  /** Node the engine is parked before, in step mode. */
  awaitingStep: { nodeId: string; label: string; type: NodeType } | null;
  /** Operator instructions injected while the run was already moving. */
  steers: { text: string; atNode: string }[];
  notices: string[];
  /** Who made the Nilo-vs-Harness choice. Persisted as `route_decision`. */
  routeDecision: RouteDecision | null;
  /** Children this run started (`subagent_*` events), in start order. */
  subagents: Subagent[];
  /** Set when the run reached its token ceiling (`budget_exceeded`). */
  budget: { maxTokens: number; usedTokens: number } | null;
  /** One entry per context compaction, in order. */
  compactions: { beforeTokens: number; afterTokens: number }[];
  /** What the turn changed in the workspace (`turn_diff`), if anything. */
  turnDiff: TurnDiff | null;
}

export interface RunEvent {
  event: string;
  data: Record<string, unknown>;
}
