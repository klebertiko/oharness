export type NodeType =
  | "agent"
  | "gate"
  | "hitl"
  | "skill"
  | "mcp"
  | "tool"
  /** EXPERIMENTAL (ADR-0005, spike) — a typed Laya decision call over a
      separate loopback process. Opt-in only: never part of the standard
      Agile graph `compile_skills_harness.py` compiles. Its result
      (`NodeData.decisionResult`) is advisory-shadow evidence attached to
      the node's own run output — never read by gate/edge/HITL resolution
      anywhere in the engine. See docs/adr/0005-laya-decision-node.md. */
  | "decision";

export type AdapterType = "mock" | "ollama" | "openai" | "claude" | "lmstudio" | "codex";
export type ExecutionMode = "mock" | "live" | "local";

export interface ProviderRouteRule {
  /** Short matcher label, e.g. "code", "prose". */
  when: string;
  providerId: string;
}

export interface NodeData {
  label: string;
  /** Agent / content role id (PO, BE, …) or skill id. */
  roleId?: string;
  skillId?: string;
  gateId?: string;
  /** 1..N provider ids — index 0 is primary, rest are fallbacks. */
  providerIds?: string[];
  /** Optional task routing; only when the author enables advanced routing. */
  providerRoutes?: ProviderRouteRule[];
  /** Bound connector ids (McpServer / Tool nodes or connectors table). */
  connectorIds?: string[];
  /** Signals this node declares it can emit. */
  emits?: string[];
  /** Signals this node declares it consumes. */
  consumes?: string[];
  adapter?: AdapterType;
  model?: string;
  endpoint?: string;
  /** Opaque vault reference (e.g. `oharness/openai`). Never a raw key. */
  secretRef?: string;
  /** @deprecated POC field — do not persist; use `secretRef` instead. */
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional spend ceiling for this node's own turn, in total tokens
      (in+out combined — the adapter layer only ever reports one combined
      count, see backend/usage_tracking.py). Unlike `maxTokens` (a
      generation-length request parameter), this is enforced *after* the
      turn completes: the engine flags the node as failed (honest
      node_error) when its real usage is at/over this limit, and warns,
      non-blocking, at 80% of it. `undefined`/`0` means no limit. */
  tokenLimit?: number;
  /** Flow advice input (ADR 0065): marks this step as unsafe. Evidence only — the run still executes it. */
  unsafe?: boolean;
  /** Flow advice input (ADR 0065): text whose appearance in the last result means this node's goal is met. */
  goal?: string;
  /** MCP server transport hint. */
  mcpCommand?: string;
  mcpUrl?: string;
  /** Native tool kind. */
  toolKind?: string;
  approvalLabel?: string;
  checklist?: string;
  /** EXPERIMENTAL (ADR-0005, spike) — `type: "decision"` node only. Same
      question shape `scripts/laya_issue_shadow.py` already uses in CI.
      `noul` = "not or unlikely" binary-ish question; `choice` = one of
      `criteria`'s keys. Authored input, not engine output. */
  decisionQuestions?: Record<
    string,
    {
      type: "choice" | "noul";
      instructions: string;
      criteria?: Record<string, string>;
    }
  >;
  /** EXPERIMENTAL (ADR-0005, spike) — `type: "decision"` node only. Set by
      the engine on `node_done`, never authored. This is EVIDENCE ONLY:
      no conditional edge, Gate retry, or HITL resolution anywhere in
      `backend/engine.py` reads this field. `authority` is always
      `"advisory-shadow"` — constant, never a value this node (or anything
      upstream of it) can set to anything else. See
      docs/adr/0005-laya-decision-node.md item 5. */
  decisionResult?: {
    schema_version: string;
    authority: "advisory-shadow";
    model_result: unknown;
    latency_ms: number;
  };
  status?: "idle" | "running" | "complete" | "error" | "paused";
  output?: string;
  tokens?: number;
  latencyMs?: number;
  error?: string;
  [key: string]: unknown;
}

export interface HarnessNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
}

/**
 * What an edge *means*, not what it looks like. The renderer derives stroke,
 * dash and marker from this; nothing else in the app is allowed to style an
 * edge directly.
 */
export type EdgeKind = "flow" | "accept" | "reject";

export interface EdgeData {
  kind?: EdgeKind;
  /** Port name shown on the wire, e.g. "pass", "reject". */
  label?: string;
  /** Typed exit-state Signal, e.g. "Ready for QA". */
  signal?: string;
  /** A wire Nilo proposed that is not committed yet (drawn dashed, inert). */
  ghost?: boolean;
  [key: string]: unknown;
}

export interface HarnessEdge {
  id: string;
  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  data?: EdgeData;
}

export interface HarnessGraph {
  nodes: HarnessNode[];
  edges: HarnessEdge[];
}

export interface HarnessMeta {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

/** Palette grouping — flow pieces vs Connections dock pieces. */
export type NodeStage = "flow" | "connections";

export interface NodeTemplate {
  type: NodeType;
  label: string;
  description: string;
  stage: NodeStage;
  defaultData: Partial<NodeData>;
  icon?: string;
  color?: string;
}
