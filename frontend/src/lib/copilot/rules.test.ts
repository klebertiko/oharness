import { describe, expect, it } from "vitest";
import { EDITABLE } from "./catalog";
import type { Op } from "./contract";
import { NILO_FORBIDDEN_FIELDS, OP_RULES, PROPOSAL_STATES, dependentsOf, nextState, toggleOp } from "./rules";
import { validateOps } from "./ops";
import { goldenBaseCanvas } from "./testGraph";
import { toCopilotGraph } from "./serialize";

const ops: Op[] = [
  { op: "addNode", ref: "n1", type: "agent", label: "Reviewer" },
  { op: "connect", from: "g1", fromPort: "pass", to: "n1" },
  { op: "updateNode", id: "n1", label: "Senior reviewer" },
  { op: "updateNode", id: "a1", label: "Writer" },
];

describe("proposal rules table", () => {
  it("lists exactly the ops the validator accepts, and the validator rejects any other", () => {
    expect(Object.keys(OP_RULES).sort()).toEqual(["addNode", "connect", "disconnect", "removeNode", "updateNode"]);
    const g = goldenBaseCanvas();
    const r = validateOps(toCopilotGraph(g.nodes, g.edges), [{ op: "setProvider", id: "a1" }]);
    expect(r.ok).toBe(false);
  });

  it("only an applied proposal touches the live canvas", () => {
    for (const state of Object.values(PROPOSAL_STATES)) {
      if (state.pending) expect(state.touchesCanvas).toBe(false);
    }
    expect(PROPOSAL_STATES.pending.touchesCanvas).toBe(false);
    expect(PROPOSAL_STATES.applied.touchesCanvas).toBe(true);
  });

  it("moves between states only along the table", () => {
    expect(nextState("pending", "apply")).toBe("applied");
    expect(nextState("pending", "reject")).toBe("rejected");
    expect(nextState("pending", "newPrompt")).toBe("replaced");
    expect(nextState("pending", "conflict")).toBe("stale");
    expect(nextState("stale", "apply")).toBeNull();
    expect(nextState("stale", "reject")).toBe("rejected");
    expect(nextState("applied", "keep")).toBe("kept");
    expect(nextState("applied", "undo")).toBe("undone");
    expect(nextState("applied", "newPrompt")).toBe("kept");
    for (const end of ["kept", "undone", "rejected", "replaced"] as const) {
      for (const ev of ["apply", "keep", "undo", "reject", "newPrompt", "conflict"] as const) expect(nextState(end, ev)).toBeNull();
    }
  });

  it("offers Apply and per-change toggles only while pending", () => {
    expect(PROPOSAL_STATES.pending).toMatchObject({ canApply: true, canReject: true, canToggle: true });
    expect(PROPOSAL_STATES.applied).toMatchObject({ canKeep: true, canUndo: true, canToggle: false, canApply: false });
    expect(PROPOSAL_STATES.stale.canApply).toBe(false);
  });

  it("never lets Nilo reach credentials, providers, executable fields or cwd", () => {
    for (const field of ["providerIds", "providerRoutes", "connectorIds", "adapter", "model", "endpoint", "secretRef", "apiKey", "mcpCommand", "mcpUrl", "toolKind", "cwd"]) {
      expect(NILO_FORBIDDEN_FIELDS).toContain(field);
    }
    for (const fields of Object.values(EDITABLE)) {
      for (const f of fields) expect(NILO_FORBIDDEN_FIELDS).not.toContain(f);
    }
    const g = toCopilotGraph(goldenBaseCanvas().nodes, goldenBaseCanvas().edges);
    for (const field of NILO_FORBIDDEN_FIELDS) {
      const r = validateOps(g, [{ op: "updateNode", id: "a1", config: { [field]: "x" } }]);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a forbidden field even if the allowlist ever listed it", () => {
    const g = toCopilotGraph(goldenBaseCanvas().nodes, goldenBaseCanvas().edges);
    EDITABLE.agent.push("secretRef");
    try {
      const r = validateOps(g, [{ op: "updateNode", id: "a1", config: { secretRef: "vault://k" } }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0].code).toBe("field_not_editable");
    } finally {
      EDITABLE.agent.pop();
    }
  });
});

describe("partial selection", () => {
  it("dropping an added node drops what depends on it", () => {
    expect([...dependentsOf(ops, 0)].sort()).toEqual([1, 2]);
    expect(toggleOp(ops, new Set(), 0)).toEqual(new Set([0, 1, 2]));
  });

  it("re-including a dependent re-includes the node it needs", () => {
    expect(toggleOp(ops, new Set([0, 1, 2]), 1)).toEqual(new Set([2]));
  });

  it("an independent change toggles alone", () => {
    expect(toggleOp(ops, new Set(), 3)).toEqual(new Set([3]));
    expect(toggleOp(ops, new Set([3]), 3)).toEqual(new Set());
  });
});
