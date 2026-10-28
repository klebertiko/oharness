/**
 * The one table behind Nilo's graph proposals (ADR 0010). The validator
 * (`ops.ts`) reads `OP_RULES[op].shape`; the Studio reads the same rows to
 * decide how a change is previewed, whether it can be dropped alone, and
 * which controls each lifecycle state offers. Add an op or a state here and
 * both sides move together.
 */
import type { Op } from "./contract";

type Shape = { required: string[]; optional: string[]; types: Record<string, "string" | "object"> };

export interface OpRule {
  /** What the validator accepts for this op. */
  shape: Shape;
  /** The mark in front of the change in the review list. */
  glyph: "+" | "~" | "−" | "→" | "×";
}

export const OP_RULES: Record<Op["op"], OpRule> = {
  addNode: {
    shape: { required: ["op", "ref", "type", "label"], optional: ["config", "near"], types: { ref: "string", type: "string", label: "string", config: "object", near: "string" } },
    glyph: "+",
  },
  updateNode: {
    shape: { required: ["op", "id"], optional: ["label", "config"], types: { id: "string", label: "string", config: "object" } },
    glyph: "~",
  },
  removeNode: { shape: { required: ["op", "id"], optional: [], types: { id: "string" } }, glyph: "−" },
  connect: {
    shape: { required: ["op", "from", "to"], optional: ["fromPort", "toPort"], types: { from: "string", to: "string", fromPort: "string", toPort: "string" } },
    glyph: "→",
  },
  disconnect: {
    shape: { required: ["op", "from", "to"], optional: ["fromPort", "toPort"], types: { from: "string", to: "string", fromPort: "string", toPort: "string" } },
    glyph: "×",
  },
};

/** Fields Nilo can never read from or write to (credentials, providers, executable fields, workspace cwd). */
export const NILO_FORBIDDEN_FIELDS = [
  "providerIds",
  "providerRoutes",
  "connectorIds",
  "adapter",
  "model",
  "endpoint",
  "secretRef",
  "apiKey",
  "mcpCommand",
  "mcpUrl",
  "toolKind",
  "tokenLimit",
  "cwd",
] as const;

export type ProposalState = "pending" | "applied" | "kept" | "undone" | "rejected" | "replaced" | "stale";
export type ProposalEvent = "apply" | "keep" | "undo" | "reject" | "newPrompt" | "conflict";

interface StateRule {
  /** Does this state change the live canvas? Only an applied proposal does. */
  touchesCanvas: boolean;
  pending: boolean;
  canApply: boolean;
  canReject: boolean;
  canToggle: boolean;
  canKeep: boolean;
  canUndo: boolean;
  /** event → next state; an event not listed is not allowed here. */
  on: Partial<Record<ProposalEvent, ProposalState>>;
}

const closed = (touchesCanvas = false): StateRule => ({
  touchesCanvas,
  pending: false,
  canApply: false,
  canReject: false,
  canToggle: false,
  canKeep: false,
  canUndo: false,
  on: {},
});

export const PROPOSAL_STATES: Record<ProposalState, StateRule> = {
  pending: {
    touchesCanvas: false,
    pending: true,
    canApply: true,
    canReject: true,
    canToggle: true,
    canKeep: false,
    canUndo: false,
    on: { apply: "applied", reject: "rejected", newPrompt: "replaced", conflict: "stale" },
  },
  stale: { ...closed(), pending: true, canReject: true, on: { reject: "rejected", newPrompt: "replaced" } },
  applied: { ...closed(true), canKeep: true, canUndo: true, on: { keep: "kept", undo: "undone", newPrompt: "kept" } },
  kept: closed(true),
  undone: closed(),
  rejected: closed(),
  replaced: closed(),
};

export function nextState(state: ProposalState, event: ProposalEvent): ProposalState | null {
  return PROPOSAL_STATES[state].on[event] ?? null;
}

/* ── partial selection ───────────────────────────────────────────────────── */

/** Refs an op needs to exist (`n1`…): the node it adds, updates, removes or wires. */
function refsUsed(op: Op): string[] {
  switch (op.op) {
    case "addNode":
      return op.near ? [op.near] : [];
    case "updateNode":
    case "removeNode":
      return [op.id];
    default:
      return [op.from, op.to];
  }
}

const adds = (ops: Op[], ref: string) => ops.findIndex((o) => o.op === "addNode" && o.ref === ref);

/** Indices of the ops that cannot stand without op `index` (transitively). */
export function dependentsOf(ops: Op[], index: number): Set<number> {
  const out = new Set<number>();
  const queue = [index];
  while (queue.length) {
    const at = queue.pop()!;
    const op = ops[at];
    if (op.op !== "addNode") continue;
    ops.forEach((other, i) => {
      if (i !== at && !out.has(i) && refsUsed(other).includes(op.ref)) {
        out.add(i);
        queue.push(i);
      }
    });
  }
  return out;
}

/** Indices of the ops op `index` needs (the nodes it refers to), transitively. */
function requirementsOf(ops: Op[], index: number): Set<number> {
  const out = new Set<number>();
  const queue = [index];
  while (queue.length) {
    for (const ref of refsUsed(ops[queue.pop()!])) {
      const at = adds(ops, ref);
      if (at >= 0 && !out.has(at)) {
        out.add(at);
        queue.push(at);
      }
    }
  }
  return out;
}

/** The new set of excluded op indices after toggling op `index`. */
export function toggleOp(ops: Op[], excluded: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(excluded);
  if (next.has(index)) {
    next.delete(index);
    for (const need of requirementsOf(ops, index)) next.delete(need);
    for (const dep of dependentsOf(ops, index)) next.delete(dep);
  } else {
    next.add(index);
    for (const dep of dependentsOf(ops, index)) next.add(dep);
  }
  return next;
}
