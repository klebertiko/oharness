import { describe, expect, it } from "vitest";
import { emptyRun, runReducer } from "./runReducer";

describe("runReducer", () => {
  it("run_start seeds the plan from the pre-run preview, including its placeholder adapter", () => {
    const state = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      },
    });
    expect(state.plan[0].adapter).toBe("mock");
  });

  it("node_start refreshes the segment's adapter/model from the real resolved values", () => {
    // run_start's `order` is a static preview built from the node's template
    // data — every node defaults to "mock" there regardless of what actually
    // runs. The node_start event that fires right before real adapter
    // resolution carries the true answer and must overwrite the preview,
    // not leave the transcript showing "mock" for a run that used a real
    // provider end to end (surfaced live, 2026-09-11: an Anthropic-provider
    // chat run displayed "agent · mock" on every node in "Show run detail").
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      },
    });

    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: { node_id: "PO", type: "agent", label: "PO", adapter: "claude", model: "" },
    });

    expect(afterNodeStart.plan[0].adapter).toBe("claude");
    expect(afterNodeStart.plan[0].state).toBe("running");
  });

  it("node_start records which connection actually ran the node, for run-outcome attribution", () => {
    // backend/engine.py only puts `connection_id` on node_start once real
    // resolution happens (never in run_start's pre-run preview, and never
    // at all on the harness-off /execute/direct path) — the same "arrives
    // late" shape adapter/model already have.
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      },
    });
    expect(afterStart.plan[0].connectionId).toBeUndefined();

    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: { node_id: "PO", adapter: "claude", model: "", connection_id: "anthropic" },
    });
    expect(afterNodeStart.plan[0].connectionId).toBe("anthropic");
  });

  it("node_start leaves connectionId untouched when the event carries none (the direct-mode path)", () => {
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "direct", type: "llm", label: "Direct", adapter: "claude", model: "" }],
        unreachable: [],
      },
    });
    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: { node_id: "direct", adapter: "claude", model: "" },
    });
    expect(afterNodeStart.plan[0].connectionId).toBeUndefined();
  });

  it("node_start leaves adapter/model untouched when the event carries neither", () => {
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "claude", model: "sonnet" }],
        unreachable: [],
      },
    });

    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: { node_id: "PO" },
    });

    expect(afterNodeStart.plan[0].adapter).toBe("claude");
    expect(afterNodeStart.plan[0].model).toBe("sonnet");
  });

  it("node_start records the failover attempts when backend/engine.py's AC#4 signal fires", () => {
    // engine.py only ever attaches `node_view["failover"]` once at least one
    // earlier providerIds entry was tried and rejected — a plain pin never
    // carries the key at all (absent, not null). Mirrors connection_id's
    // "arrives on node_start, camelCased for the client" shape.
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      },
    });
    expect(afterStart.plan[0].failover).toBeUndefined();

    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: {
        node_id: "PO",
        adapter: "claude",
        model: "",
        connection_id: "ol",
        failover: {
          attempts: [{ connection_id: "an", reason: "Provider execution failed." }],
        },
      },
    });

    expect(afterNodeStart.plan[0].connectionId).toBe("ol");
    expect(afterNodeStart.plan[0].failover).toEqual({
      attempts: [{ connectionId: "an", reason: "Provider execution failed." }],
    });
  });

  it("node_start leaves failover unset when the event carries none — a plain pin, not a mismarked failover", () => {
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      },
    });
    const afterNodeStart = runReducer(afterStart, {
      type: "sse",
      event: "node_start",
      data: { node_id: "PO", adapter: "claude", model: "", connection_id: "an" },
    });
    expect(afterNodeStart.plan[0].failover).toBeUndefined();
  });

  it("node_skipped marks the segment skipped, not error — a branch not taken is not a failure", () => {
    // Backend engine.py, 2026-09-12: PASS/FAIL conditional routing emits
    // node_skipped for a branch this run's decisions didn't select.
    const afterStart = runReducer(emptyRun, {
      type: "sse",
      event: "run_start",
      data: {
        run_id: "r1",
        mode: "live",
        step: false,
        order: [{ node_id: "rejected", type: "agent", label: "Rejected", adapter: "claude", model: "" }],
        unreachable: [],
      },
    });

    const afterSkip = runReducer(afterStart, {
      type: "sse",
      event: "node_skipped",
      data: { node_id: "rejected", reason: "no matching condition" },
    });

    expect(afterSkip.plan[0].state).toBe("skipped");
    expect(afterSkip.status).not.toBe("error");
  });
});

it("retains partial token usage on node_error before final totals arrive", () => {
  const running = runReducer(emptyRun, { type: "sse", event: "run_start", data: { run_id: "partial", order: [{ node_id: "direct" }] } });
  const failed = runReducer(running, { type: "sse", event: "node_error", data: { node_id: "direct", tokens: 42, error: "limit" } });
  expect(failed.plan[0].tokens).toBe(42);
  expect(failed.totals.tokens).toBe(42);
});

it("node_done adds the node's own tokens and one nodesRun onto the run's running totals, not resets them", () => {
  const running = runReducer(emptyRun, {
    type: "sse", event: "run_start", data: { run_id: "sum", order: [{ node_id: "po" }, { node_id: "dev" }] },
  });
  const afterFirst = runReducer(
    runReducer(running, { type: "sse", event: "node_start", data: { node_id: "po" } }),
    { type: "sse", event: "node_done", data: { node_id: "po", tokens: 100, output: "done", latency_ms: 12 } },
  );
  expect(afterFirst.totals.tokens).toBe(100);
  expect(afterFirst.totals.nodesRun).toBe(1);
  expect(afterFirst.plan[0].state).toBe("done");
  expect(afterFirst.plan[0].output).toBe("done");
  expect(afterFirst.plan[0].latencyMs).toBe(12);

  const afterSecond = runReducer(
    runReducer(afterFirst, { type: "sse", event: "node_start", data: { node_id: "dev" } }),
    { type: "sse", event: "node_done", data: { node_id: "dev", tokens: 50, output: "", latency_ms: 3 } },
  );
  // 100 + 50, not 50 — a second node_done accumulates onto the running total.
  expect(afterSecond.totals.tokens).toBe(150);
  expect(afterSecond.totals.nodesRun).toBe(2);
});

it("node_error corrects the running total by the delta when a node's token count was revised, not by re-adding it", () => {
  const running = runReducer(emptyRun, { type: "sse", event: "run_start", data: { run_id: "delta", order: [{ node_id: "direct" }] } });
  const first = runReducer(running, { type: "sse", event: "node_error", data: { node_id: "direct", tokens: 42, error: "limit" } });
  expect(first.totals.tokens).toBe(42);
  // The backend revises the same node's error a second time with a higher
  // count — totals must move by the *difference* (58), landing on 100, not
  // double-count the original 42 by re-adding the new figure outright.
  const revised = runReducer(first, { type: "sse", event: "node_error", data: { node_id: "direct", tokens: 100, error: "limit" } });
  expect(revised.totals.tokens).toBe(100);
  expect(revised.status).toBe("error");
});

it("node_error keeps the segment's previous token figure when the new event omits or malforms tokens", () => {
  const running = runReducer(emptyRun, { type: "sse", event: "run_start", data: { run_id: "fallback", order: [{ node_id: "direct" }] } });
  const withTokens = runReducer(running, { type: "sse", event: "node_error", data: { node_id: "direct", tokens: 30, error: "first" } });
  const omitted = runReducer(withTokens, { type: "sse", event: "node_error", data: { node_id: "direct", error: "second" } });
  expect(omitted.plan[0].tokens).toBe(30);
  expect(omitted.totals.tokens).toBe(30);
  const negative = runReducer(withTokens, { type: "sse", event: "node_error", data: { node_id: "direct", tokens: -5, error: "third" } });
  expect(negative.plan[0].tokens).toBe(30);
});

describe("runReducer · route decision provenance", () => {
  it("keeps who decided before and after run_start so historical replay is honest", () => {
    const decided = runReducer(emptyRun, {
      type: "sse",
      event: "route_decision",
      data: { source: "laya", reason: "confident", engage_harness: false, confidence: 0.97, latency_ms: 9.5 },
    });
    expect(decided.routeDecision).toEqual({
      source: "laya",
      reason: "confident",
      engageHarness: false,
      confidence: 0.97,
      latencyMs: 9.5,
    });

    const started = runReducer(decided, {
      type: "sse",
      event: "run_start",
      data: { run_id: "routed", mode: "live", step: false, order: [], unreachable: [] },
    });
    expect(started.routeDecision).toEqual(decided.routeDecision);
  });
});

// ── CHAT-TOOLS-FE AC#3/#4: tool approval gate on the run stream (contract v1.1 §2.5/§2.6) ──
describe("runReducer · chat tools", () => {
  const seeded = runReducer(emptyRun, {
    type: "sse", event: "run_start",
    data: { run_id: "r1", mode: "live", step: false, order: [{ node_id: "direct", type: "agent", label: "Chat", adapter: "http", model: "" }], unreachable: [] },
  });
  const called = runReducer(seeded, { type: "sse", event: "tool_call", data: { node_id: "direct", call_id: "c1", name: "exec", args: { argv: ["npm", "run", "test"] }, origin: "preset" } });
  const tool = (state: ReturnType<typeof runReducer>) => {
    const block = state.plan[0].blocks.find((b) => b.kind === "tool");
    return block && block.kind === "tool" ? block.call : undefined;
  };

  it("tool_call keeps the parsed argv beside the raw args", () => {
    expect(tool(called)?.argv).toEqual(["npm", "run", "test"]);
    expect(tool(called)?.origin).toBe("preset");
  });

  it("tool_approval_required parks the run on a gate for that call", () => {
    const state = runReducer(called, { type: "sse", event: "tool_approval_required", data: { node_id: "direct", call_id: "c1", name: "exec", args: { argv: ["npm", "run", "test"] }, reason: "exec", risk: "high", risk_hints: ["npm publish"] } });
    expect(state.status).toBe("gate");
    expect(tool(state)?.approval).toEqual({ reason: "exec", risk: "high", riskHints: ["npm publish"] });
  });

  it("tool_approval_decision resumes and records the decision", () => {
    const gated = runReducer(called, { type: "sse", event: "tool_approval_required", data: { node_id: "direct", call_id: "c1", reason: "exec", risk: "normal", risk_hints: [] } });
    const state = runReducer(gated, { type: "sse", event: "tool_approval_decision", data: { node_id: "direct", call_id: "c1", decision: "approve", note: "ok" } });
    expect(state.status).toBe("running");
    expect(tool(state)?.approval?.decision).toBe("approve");
    expect(tool(state)?.approval?.note).toBe("ok");
  });

  it("tool_auto_approved records that the mode, not a person, let the command run", () => {
    const state = runReducer(called, { type: "sse", event: "tool_auto_approved", data: { node_id: "direct", call_id: "c1", mode: "auto_workspace", reason: "workspace" } });
    expect(tool(state)?.autoApproved).toEqual({ mode: "auto_workspace", reason: "workspace" });
    expect(tool(state)?.approval).toBeUndefined();
    expect(state.status).not.toBe("gate");
  });

  it("tool_denied marks the call failed with the reason", () => {
    const state = runReducer(called, { type: "sse", event: "tool_denied", data: { node_id: "direct", call_id: "c1", reason: "rejected", note: "no" } });
    expect(state.status).toBe("running");
    expect(tool(state)?.ok).toBe(false);
    expect(tool(state)?.denied).toEqual({ reason: "rejected", note: "no" });
  });

  it("tool_result carries truncated, timed_out, simulated, redactions and exit_code", () => {
    const state = runReducer(called, { type: "sse", event: "tool_result", data: { node_id: "direct", call_id: "c1", ok: false, result: "", duration_ms: 2000, truncated: true, timed_out: true, exit_code: null, redactions: 1, simulated: false } });
    const c = tool(state)!;
    expect(c.ok).toBe(false);
    expect(c.truncated).toBe(true);
    expect(c.timedOut).toBe(true);
    expect(c.exitCode).toBeNull();
    expect(c.redactions).toBe(1);
    expect(c.simulated).toBe(false);
  });

  it("capabilities is kept on the run", () => {
    const state = runReducer(seeded, { type: "sse", event: "capabilities", data: { reason: "cli-adapter", provider_kind: "cli", tools: { discover: true, read: false, exec: false }, preset: { read: true, exec: true }, workspace: { root: "D:/x", name: "x" }, limits: {} } });
    expect(state.capabilities?.reason).toBe("cli-adapter");
    expect(state.capabilities?.preset.exec).toBe(true);
  });

  it("preserves capabilities notices emitted before run_start", () => {
    const capable = runReducer(emptyRun, { type: "sse", event: "capabilities", data: { reason: "cli-adapter" } });
    const started = runReducer(capable, { type: "sse", event: "run_start", data: {
      run_id: "r1", mode: "live", step: false, order: [], unreachable: [],
    } });
    expect(started.notices).toEqual(["this provider doesn't request tools; /exec and /read stay available"]);
    expect(started.capabilities?.reason).toBe("cli-adapter");
  });

  it("normalizes read calls, ignores invalid origins, and keeps optional result fields absent", () => {
    const readCalled = runReducer(seeded, { type: "sse", event: "tool_call", data: {
      node_id: "direct", call_id: "r1", name: "read", args: '{"path":"README.md"}', origin: "invalid",
    } });
    const read = readCalled.plan[0].blocks.find((b) => b.kind === "tool");
    expect(read && read.kind === "tool" ? read.call : null).toEqual({
      callId: "r1", name: "read", args: '{"path":"README.md"}', path: "README.md",
    });
    const done = runReducer(readCalled, { type: "sse", event: "tool_result", data: {
      node_id: "direct", call_id: "r1", ok: true, result: "text", duration_ms: 7,
    } });
    const result = done.plan[0].blocks.find((b) => b.kind === "tool");
    expect(result && result.kind === "tool" ? result.call : null).toEqual({
      callId: "r1", name: "read", args: '{"path":"README.md"}', path: "README.md",
      ok: true, result: "text", durationMs: 7,
    });
  });

  it("applies approval defaults, reject decisions, and every denial reason", () => {
    const gated = runReducer(called, { type: "sse", event: "tool_approval_required", data: {
      node_id: "direct", call_id: "c1", reason: "other", risk: "other", risk_hints: "bad",
    } });
    expect(tool(gated)?.approval).toEqual({ reason: "exec", risk: "normal", riskHints: [] });
    const rejected = runReducer(gated, { type: "sse", event: "tool_approval_decision", data: {
      node_id: "direct", call_id: "c1", decision: "reject",
    } });
    expect(tool(rejected)?.approval).toEqual({ reason: "exec", risk: "normal", riskHints: [], decision: "reject", note: "" });
    for (const reason of ["approval_timeout", "policy", "other"] as const) {
      const denied = runReducer(gated, { type: "sse", event: "tool_denied", data: {
        node_id: "direct", call_id: "c1", reason,
      } });
      expect(tool(denied)?.denied).toEqual({ reason: reason === "other" ? "rejected" : reason, note: "" });
      expect(denied.status).toBe("running");
    }
  });

  it("emits each capability notice once and none for ok", () => {
    const reasons = [
      ["cli-adapter", "this provider doesn't request tools; /exec and /read stay available"],
      ["provider-no-tools", "this model doesn't support tools; the reply continues as text only"],
      ["no-workspace", "no folder selected: no tools in this conversation"],
    ] as const;
    for (const [reason, notice] of reasons) {
      const once = runReducer(seeded, { type: "sse", event: "capabilities", data: { reason } });
      const twice = runReducer(once, { type: "sse", event: "capabilities", data: { reason } });
      expect(twice.notices).toEqual([notice]);
    }
    expect(runReducer(seeded, { type: "sse", event: "capabilities", data: { reason: "ok" } }).notices).toEqual([]);
  });
});

/* ── honest metrics: absent/zero is "not captured", never a measurement ───── */
function started() {
  return runReducer(
    runReducer(emptyRun, { type: "sse", event: "run_start", data: { run_id: "m", order: [{ node_id: "n" }] } }),
    { type: "sse", event: "node_start", data: { node_id: "n" } },
  );
}

it("node_done with latency_ms 0 or missing records no latency — 0ms was never measured", () => {
  const zero = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 3, output: "x", latency_ms: 0 } });
  expect(zero.plan[0].latencyMs).toBeUndefined();
  const missing = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 3, output: "x" } });
  expect(missing.plan[0].latencyMs).toBeUndefined();
});

it("node_done keeps a real positive latency", () => {
  const s = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 3, output: "x", latency_ms: 812 } });
  expect(s.plan[0].latencyMs).toBe(812);
});

it("node_done carries token provenance only when the backend states it", () => {
  const est = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 3, output: "x", tokens_estimated: true } });
  expect(est.plan[0].tokensEstimated).toBe(true);
  const real = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 19, output: "x", tokens_estimated: false } });
  expect(real.plan[0].tokensEstimated).toBe(false);
  const unknown = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 19, output: "x" } });
  expect(unknown.plan[0].tokensEstimated).toBeUndefined();
});

it("harness_done records the run's token provenance from its own payload", () => {
  const done = (data: Record<string, unknown>) =>
    runReducer(started(), { type: "sse", event: "harness_done", data: { status: "complete", total_tokens: 19, nodes_run: 1, ...data } });
  expect(done({ tokens_estimated: false, elapsed_ms: 800 }).totals).toMatchObject({ tokensEstimated: false, elapsedMs: 800 });
  expect(done({ tokens_estimated: true }).totals.tokensEstimated).toBe(true);
  expect(done({}).totals.tokensEstimated).toBeUndefined();
});

it("harness_done falls back to the nodes' own provenance when its payload omits it", () => {
  const afterNode = runReducer(started(), { type: "sse", event: "node_done", data: { node_id: "n", tokens: 3, output: "x", tokens_estimated: true } });
  const done = runReducer(afterNode, { type: "sse", event: "harness_done", data: { status: "complete", total_tokens: 3, nodes_run: 1 } });
  expect(done.totals.tokensEstimated).toBe(true);
});

it("tool_result without a duration records none rather than 0ms", () => {
  const withTool = runReducer(started(), { type: "sse", event: "tool_call", data: { node_id: "n", call_id: "c1", name: "read", args: "a" } });
  const missing = runReducer(withTool, { type: "sse", event: "tool_result", data: { node_id: "n", call_id: "c1", ok: true, result: "r" } });
  const block = missing.plan[0].blocks.find((b) => b.kind === "tool");
  expect(block && block.kind === "tool" ? block.call.durationMs : "no-block").toBeUndefined();
});

describe("runReducer plan_proposed", () => {
  it("keeps the plan artifact a Plan-mode run ended in, waiting for approval", () => {
    const state = runReducer(emptyRun, { type: "sse", event: "plan_proposed", data: { node_id: "direct", plan_id: "p1", thread_id: "t1", text: "1. Do it", status: "proposed" } });
    expect(state.proposedPlan).toEqual({ planId: "p1", text: "1. Do it" });
  });

  it("ignores a plan event without an id or text", () => {
    expect(runReducer(emptyRun, { type: "sse", event: "plan_proposed", data: { text: "x" } }).proposedPlan).toBeUndefined();
    expect(runReducer(emptyRun, { type: "sse", event: "plan_proposed", data: { plan_id: "p" } }).proposedPlan).toBeUndefined();
  });

  it("a new run starts with no plan", () => {
    const withPlan = runReducer(emptyRun, { type: "sse", event: "plan_proposed", data: { plan_id: "p1", text: "t" } });
    expect(runReducer(withPlan, { type: "reset", mode: "live", step: false }).proposedPlan).toBeUndefined();
  });
});


describe("node_restored (a continued run)", () => {
  it("marks the node done with the earlier output, restored, and does not count it as run or as spend", () => {
    let state = runReducer(emptyRun, { type: "reset", mode: "mock", step: false });
    state = runReducer(state, { type: "sse", event: "run_start", data: { run_id: "r2", mode: "mock", order: [
      { node_id: "a", type: "llm", label: "A", adapter: "mock", model: "", intrinsic: false },
    ] } });
    state = runReducer(state, { type: "sse", event: "node_restored", data: { node_id: "a", output: "kept" } });
    const step = state.plan.find((s) => s.nodeId === "a");
    expect(step).toMatchObject({ state: "done", restored: true, output: "kept", tokens: 0 });
    expect(state.totals.nodesRun).toBe(0);
    expect(state.totals.tokens).toBe(0);
  });
});

describe("runReducer plan_error", () => {
  it("records that the plan could not be saved, so the chat can say so", () => {
    const state = runReducer(emptyRun, { type: "sse", event: "plan_error", data: { node_id: "direct", code: "plan_not_saved" } });
    expect(state.planNotSaved).toBe(true);
    expect(state.proposedPlan).toBeUndefined();
  });

  it("a new run clears it", () => {
    const flagged = runReducer(emptyRun, { type: "sse", event: "plan_error", data: { code: "plan_not_saved" } });
    expect(runReducer(flagged, { type: "reset", mode: "live", step: false }).planNotSaved).toBeUndefined();
  });
});

describe("worktree events", () => {
  it("tells the person the run works in its own worktree and where its changes were kept", () => {
    let state = runReducer(emptyRun, { type: "reset", mode: "live", step: false });
    state = runReducer(state, { type: "sse", event: "worktree_ready", data: { workspace_id: "ws-1" } });
    expect(state.notices).toContain("This run works in its own worktree; your folder is not touched.");
    state = runReducer(state, { type: "sse", event: "worktree_closed", data: { workspace_id: "ws-1", rescue_ref: "refs/openharness/rescue/ws-1" } });
    expect(state.notices.at(-1)).toBe("The worktree was removed. Its changes are kept on refs/openharness/rescue/ws-1.");
  });

  it("says nothing was left behind when the worktree was clean", () => {
    let state = runReducer(emptyRun, { type: "reset", mode: "live", step: false });
    state = runReducer(state, { type: "sse", event: "worktree_closed", data: { workspace_id: "ws-1", rescue_ref: null } });
    expect(state.notices.at(-1)).toBe("The worktree was removed. It had no changes to keep.");
  });
});
