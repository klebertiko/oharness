import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startDirectRunMock = vi.fn();
const startRunMock = vi.fn();
const sendControlMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./runClient", () => ({
  startDirectRun: (...args: unknown[]) => startDirectRunMock(...args),
  startRun: (...args: unknown[]) => startRunMock(...args),
  sendControl: (...args: unknown[]) => sendControlMock(...args),
}));

import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useUsageStore } from "@/components/providers/usageStore";
import { useRunStream } from "./useRunStream";

/**
 * 2026-09-13 — the composer chip stayed "Not verified" forever unless a
 * person explicitly clicked Test, even while the connection was actively,
 * successfully answering real chat turns. These tests pin the new wiring:
 * `useRunStream` is the seam that knows both "which connection sent this"
 * (the `providerId` the composer resolved at send-time, and/or the
 * `connectionId` a harness node's own `node_start` carries) and "how the
 * run actually ended" — so it is what teaches `providerStore` the
 * difference between untested and proven.
 *
 * Revised after QA/SEC review of the first pass found two real defects:
 * (1) crediting/blaming the *whole run* to the composer's own connection,
 * even when a different harness node (its own pin) is what actually ran —
 * fixed by attributing per-segment via `connectionId`, only falling back to
 * the composer's pick when a segment carries none (the direct-mode path,
 * which has exactly one connection in play by construction); (2) marking a
 * connection "fault" from free-form error prose (model output, an HITL
 * rejection note, a token-limit message) is unsafe — that text is never
 * guaranteed unrelated to the connection, and "fault" is sticky (blocks the
 * connection from being auto-picked again) in a way a stale "live" is not.
 * So there is no failure path here at all — only success ever moves health.
 */

function connection(overrides: Partial<Connection>): Connection {
  return {
    id: "an",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: null,
    health: "setup",
    detail: "Not connected.",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    enabled: true,
    lastProbe: "",
    ...overrides,
  };
}

const emptyGraph = { nodes: [], edges: [] };

/** The direct-mode order/node_start view shape `run_direct` actually sends
    (backend/routers/execution.py) — one synthetic "direct" node, and
    crucially no `connection_id` at all (that path resolves no connection). */
function directNode(adapter: string) {
  return { node_id: "direct", type: "llm", label: "Direct", adapter, model: "" };
}

function startAndCapture(providerId: string | undefined, harnessEnabled = false) {
  const { result } = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled }));
  act(() => {
    result.current.start({ instruction: "hi", mode: "live", step: false, providerId });
  });
  const mock = harnessEnabled ? startRunMock : startDirectRunMock;
  const call = mock.mock.calls.at(-1)!;
  const onEvent = call[1] as (event: string, data: Record<string, unknown>) => void;
  return { result, onEvent };
}

describe("useRunStream -> providerStore run-outcome wiring", () => {
  beforeEach(() => {
    startDirectRunMock.mockReset().mockReturnValue(vi.fn());
    startRunMock.mockReset().mockReturnValue(vi.fn());
    sendControlMock.mockClear();
    useProviderStore.setState({ connections: [connection({ health: "setup", enabled: true })] });
    // Real refresh() would fetch /usage/summary; stub it in every test in this
    // file now that the run-completion effect also calls it (see the second
    // describe block below), so the nine pre-existing tests above stay
    // hermetic instead of incidentally hitting the network.
    useUsageStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  });

  it("marks the connection verified when a direct-mode run completes successfully (no connection_id on the wire — falls back to the composer's pick)", () => {
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r1", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_done", { node_id: "direct", connection_id: "an", provider_verified: true, output: "hello there", tokens: 12, latency_ms: 400 });
      onEvent("harness_done", { status: "complete", total_tokens: 12, elapsed_ms: 400, nodes_run: 1 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("marks the connection verified from a harness node's own connection_id, not just the composer's fallback", () => {
    const { onEvent } = startAndCapture("an", true);
    act(() => {
      onEvent("run_start", {
        run_id: "r1b",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      });
      onEvent("node_start", { node_id: "PO", adapter: "claude", model: "", connection_id: "an" });
      onEvent("node_done", { node_id: "PO", connection_id: "an", provider_verified: true, output: "hello", tokens: 8, latency_ms: 300 });
      onEvent("harness_done", { status: "complete", total_tokens: 8, elapsed_ms: 300, nodes_run: 1 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("does not credit the composer's connection for a different node's success, and instead credits the connection that actually ran it", () => {
    // The exact cross-attribution defect QA/SEC review caught: a harness
    // graph can pin one node to a connection different from the chat
    // composer's own pick (bundleGraph.ts leaves an explicit per-node pin
    // untouched). The composer is showing "an" (Anthropic); this graph's
    // only real node is pinned to "ol" (Ollama local).
    useProviderStore.setState({
      connections: [
        connection({ id: "an", health: "live", enabled: true }),
        connection({ id: "ol", label: "Ollama local", health: "setup", enabled: true }),
      ],
    });
    const { onEvent } = startAndCapture("an", true);
    act(() => {
      onEvent("run_start", {
        run_id: "r1c",
        mode: "live",
        step: false,
        order: [{ node_id: "reviewer", type: "agent", label: "Reviewer", adapter: "mock", model: "" }],
        unreachable: [],
      });
      onEvent("node_start", { node_id: "reviewer", adapter: "ollama", model: "qwen3.5:9b", connection_id: "ol" });
      onEvent("node_done", { node_id: "reviewer", connection_id: "ol", provider_verified: true, output: "looks good", tokens: 4, latency_ms: 20 });
      onEvent("harness_done", { status: "complete", total_tokens: 4, elapsed_ms: 20, nodes_run: 1 });
    });
    const cs = useProviderStore.getState().connections;
    // The node that actually ran gets credited...
    expect(cs.find((c) => c.id === "ol")?.health).toBe("live");
    // ...and the composer's own connection, which did nothing this run, is untouched.
    expect(cs.find((c) => c.id === "an")?.health).toBe("live");
    expect(cs.find((c) => c.id === "an")?.detail).toBe("Not connected.");
  });

  it("does not downgrade an already-healthy connection when a run fails for a reason unrelated to the provider", () => {
    useProviderStore.setState({ connections: [connection({ health: "live", enabled: true })] });
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r2", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_error", { node_id: "direct", error: "The model returned invalid JSON for the requested tool call." });
      onEvent("harness_done", { status: "error", total_tokens: 0, elapsed_ms: 50, nodes_run: 0 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("does not fault a healthy connection even on a message that reads like an auth failure — there is no failure path at all", () => {
    // Pinned down after review: automatically marking "fault" from run
    // outcomes was removed entirely (see the module doc comment above) —
    // this is not "the classifier let it through", there is no classifier
    // in this path any more.
    useProviderStore.setState({ connections: [connection({ health: "live", enabled: true })] });
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r3", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_error", { node_id: "direct", error: "401 Unauthorized — the Claude CLI session has expired." });
      onEvent("harness_done", { status: "error", total_tokens: 0, elapsed_ms: 50, nodes_run: 0 });
    });
    const c = useProviderStore.getState().connections.find((x) => x.id === "an");
    expect(c?.health).toBe("live");
  });

  it("leaves health untouched when the person stops the run mid-flight", () => {
    useProviderStore.setState({ connections: [connection({ health: "live", enabled: true })] });
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r4", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("run_stopped", { at_node: "direct" });
      onEvent("harness_done", { status: "stopped", total_tokens: 0, elapsed_ms: 10, nodes_run: 0 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("leaves health untouched on a rejected HITL gate, including the node_error the backend actually emits for it", () => {
    // backend/engine.py: a HITL reject emits node_error with the reviewer's
    // free-text note as `error` (falling back to "Rejected by reviewer."),
    // THEN harness_done with status "stopped" — not just hitl_resolved on
    // its own. The note is chosen here to also prove SEC's point: even a
    // note that reads like a transport failure must never fault anything,
    // because there is no failure path here at all any more.
    useProviderStore.setState({ connections: [connection({ health: "live", enabled: true })] });
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r5", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("hitl_pause", { node_id: "direct", question: "Approve?", context: "" });
      onEvent("hitl_resolved", { node_id: "direct", decision: "reject", note: "connection timed out, try later" });
      onEvent("node_error", { node_id: "direct", error: "connection timed out, try later" });
      onEvent("harness_done", { status: "stopped", total_tokens: 0, elapsed_ms: 10, nodes_run: 0 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("live");
  });

  it("does not verify a connection from a run that silently fell back to mock", () => {
    // Guards the latent direct-mode gap where an unresolved adapter falls
    // back to MockAdapter server-side — a mock reply must never read back as
    // "this connection works".
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "r6", mode: "live", step: false, order: [directNode("mock")], unreachable: [] });
      onEvent("node_start", directNode("mock"));
      onEvent("node_done", { node_id: "direct", output: "canned reply", tokens: 5, latency_ms: 1 });
      onEvent("harness_done", { status: "complete", total_tokens: 5, elapsed_ms: 1, nodes_run: 1 });
    });
    expect(useProviderStore.getState().connections.find((c) => c.id === "an")?.health).toBe("setup");
  });

  it("does nothing when no provider was resolved for the run (Auto with nothing connected)", () => {
    const before = useProviderStore.getState().connections;
    const { onEvent } = startAndCapture(undefined);
    act(() => {
      onEvent("run_start", { run_id: "r7", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_done", { node_id: "direct", output: "hi", tokens: 1, latency_ms: 1 });
      onEvent("harness_done", { status: "complete", total_tokens: 1, elapsed_ms: 1, nodes_run: 1 });
    });
    expect(useProviderStore.getState().connections).toEqual(before);
  });
});

/**
 * 2026-09-15 — QA bounce (qa.md, Finding 2). `usageStore.hydrate()` fetches
 * once per app session and never again; `refresh()` existed but had zero
 * production call sites, so token/cost numbers on the Providers/Dossier
 * screens went stale after the very first load, for the rest of the
 * session, no matter how many real runs happened afterward. This wires
 * `refresh()` into the exact same real-run-completion condition that
 * already credits `reportRunOutcome` above — a real (non-mock) segment
 * reaching "done" — so usage numbers and provider health go stale-proof
 * together, the same way Story 1 already did for health alone.
 */
describe("useRunStream -> usageStore refresh wiring", () => {
  beforeEach(() => {
    startDirectRunMock.mockReset().mockReturnValue(vi.fn());
    startRunMock.mockReset().mockReturnValue(vi.fn());
    sendControlMock.mockClear();
    useProviderStore.setState({ connections: [connection({ health: "setup", enabled: true })] });
    useUsageStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });
  });

  it("refreshes usage after a real, non-mock run finishes — numbers must not go stale after something real just happened", () => {
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "u1", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_done", { node_id: "direct", connection_id: "an", provider_verified: true, output: "hello there", tokens: 12, latency_ms: 400 });
      onEvent("harness_done", { status: "complete", total_tokens: 12, elapsed_ms: 400, nodes_run: 1 });
    });
    expect(useUsageStore.getState().refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes usage from a harness node's own real adapter even when the composer's own connection is different", () => {
    const { onEvent } = startAndCapture("an", true);
    act(() => {
      onEvent("run_start", {
        run_id: "u2",
        mode: "live",
        step: false,
        order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
        unreachable: [],
      });
      onEvent("node_start", { node_id: "PO", adapter: "claude", model: "", connection_id: "an" });
      onEvent("node_done", { node_id: "PO", connection_id: "an", provider_verified: true, output: "hello", tokens: 8, latency_ms: 300 });
      onEvent("harness_done", { status: "complete", total_tokens: 8, elapsed_ms: 300, nodes_run: 1 });
    });
    expect(useUsageStore.getState().refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh usage for a run that silently fell back to mock — nothing real was spent", () => {
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "u3", mode: "live", step: false, order: [directNode("mock")], unreachable: [] });
      onEvent("node_start", directNode("mock"));
      onEvent("node_done", { node_id: "direct", output: "canned reply", tokens: 5, latency_ms: 1 });
      onEvent("harness_done", { status: "complete", total_tokens: 5, elapsed_ms: 1, nodes_run: 1 });
    });
    expect(useUsageStore.getState().refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes usage even when a task fails without provider failure", () => {
    const { onEvent } = startAndCapture("an");
    act(() => {
      onEvent("run_start", { run_id: "u4", mode: "live", step: false, order: [directNode("claude")], unreachable: [] });
      onEvent("node_start", directNode("claude"));
      onEvent("node_error", { node_id: "direct", error: "The model returned invalid JSON for the requested tool call." });
      onEvent("harness_done", { status: "error", total_tokens: 0, elapsed_ms: 50, nodes_run: 0 });
    });
    expect(useUsageStore.getState().refresh).toHaveBeenCalledTimes(1);
  });
});

it("forwards the selected connection and cwd on the direct wire contract", () => {
  const { result } = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: false }));
  act(() => result.current.start({ instruction: "hi", mode: "local", step: true, cwd: "D:/work", providerId: "ollama-local" }));
  expect(startDirectRunMock.mock.calls.at(-1)?.[0]).toEqual({ instruction: "hi", mode: "local", step: true, cwd: "D:/work", connection_id: "ollama-local" });
});

it("requires explicit completion evidence, never node_start or composer metadata", () => {
  useProviderStore.setState({ connections: [connection({})] });
  const { onEvent } = startAndCapture("an", true);
  act(() => {
    onEvent("run_start", { run_id: "proof", order: [directNode("claude")] });
    onEvent("node_start", { ...directNode("claude"), connection_id: "an", provider_verified: true });
    onEvent("node_done", { node_id: "direct", tokens: 1 });
    onEvent("harness_done", { status: "complete" });
  });
  expect(useProviderStore.getState().connections[0].health).toBe("setup");
});

it.each(["authentication", "transport"])("faults only the connection in structured %s evidence", (provider_failure) => {
  useProviderStore.setState({ connections: [connection({ health: "live" }), connection({ id: "ol", health: "live" })] });
  const { onEvent } = startAndCapture("an", true);
  act(() => onEvent("node_error", { node_id: "triage", connection_id: "ol", provider_failure, error: "arbitrary task text" }));
  expect(useProviderStore.getState().connections.map((c) => c.health)).toEqual(["live", "fault"]);
});

it("ignores completion and close callbacks from a superseded stream", () => {
  useProviderStore.setState({ connections: [connection({})] });
  const { result, onEvent } = startAndCapture("an");
  const oldClose = startDirectRunMock.mock.calls.at(-1)![2];
  act(() => result.current.start({ instruction: "new", mode: "live", step: false, providerId: "an" }));
  act(() => {
    onEvent("node_done", { connection_id: "an", provider_verified: true });
    oldClose(new Error("old transport"));
  });
  expect(useProviderStore.getState().connections[0].health).toBe("setup");
  expect(result.current.run.status).toBe("starting");
});

it("refreshes usage after an errored terminal event and deduplicates close", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  useUsageStore.setState({ refresh });
  const { onEvent } = startAndCapture("an");
  const onClose = startDirectRunMock.mock.calls.at(-1)![2];
  act(() => {
    onEvent("run_start", { run_id: "spent-error", order: [directNode("claude")] });
    onEvent("node_error", { node_id: "direct", tokens: 42, error: "Token limit reached" });
  });
  expect(refresh).not.toHaveBeenCalled();
  act(() => {
    onEvent("harness_done", { status: "error", total_tokens: 42 });
    onClose();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("routes a user-selected tool preset through the direct broker even when the harness is enabled", () => {
  startDirectRunMock.mockClear().mockReturnValue(vi.fn());
  startRunMock.mockClear().mockReturnValue(vi.fn());
  const { result } = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: true }));
  act(() => result.current.start({
    instruction: "",
    mode: "local",
    step: false,
    cwd: "D:/work",
    providerId: "ollama-local",
    tools: { preset: { name: "exec", argv: ["npm", "run", "test"] }, summarize: false },
  }));

  expect(startRunMock).not.toHaveBeenCalled();
  expect(startDirectRunMock).toHaveBeenCalledTimes(1);
  expect(startDirectRunMock.mock.calls[0][0].tools?.preset).toEqual({ name: "exec", argv: ["npm", "run", "test"] });
});

it("reset cancels the current stream and returns an idle run", () => {
  const abort = vi.fn();
  startDirectRunMock.mockReturnValueOnce(abort);
  const { result, onEvent } = startAndCapture("an");
  act(() => {
    onEvent("run_start", { run_id: "old-run", mode: "live", order: [directNode("claude")] });
    onEvent("node_start", directNode("claude"));
  });
  expect(result.current.run.runId).toBe("old-run");

  act(() => result.current.reset());

  expect(abort).toHaveBeenCalledTimes(1);
  expect(result.current.run.status).toBe("idle");
  expect(result.current.run.runId).toBeNull();
  expect(result.current.run.plan).toEqual([]);
});

it("asks for the run's own worktree only for a harness run that has a folder and the switch on", async () => {
  const { useRunWorktreeStore } = await import("@/store/runWorktreeStore");
  startRunMock.mockReset().mockReturnValue(vi.fn());
  startDirectRunMock.mockReset().mockReturnValue(vi.fn());
  useRunWorktreeStore.setState({ enabled: true });
  const harness = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: true }));
  act(() => harness.result.current.start({ instruction: "hi", mode: "live", step: false, cwd: "D:/work" }));
  expect(startRunMock.mock.calls.at(-1)?.[0]).toMatchObject({ cwd: "D:/work", worktree: true });
  act(() => harness.result.current.start({ instruction: "hi", mode: "live", step: false }));
  expect(startRunMock.mock.calls.at(-1)?.[0]).not.toHaveProperty("worktree"); // no folder: nothing to branch from
  const direct = renderHook(() => useRunStream({ graph: emptyGraph, harnessEnabled: false }));
  act(() => direct.result.current.start({ instruction: "hi", mode: "live", step: false, cwd: "D:/work" }));
  expect(startDirectRunMock.mock.calls.at(-1)?.[0]).not.toHaveProperty("worktree"); // a direct chat turn has no harness to isolate
  useRunWorktreeStore.setState({ enabled: false });
  act(() => harness.result.current.start({ instruction: "hi", mode: "live", step: false, cwd: "D:/work" }));
  expect(startRunMock.mock.calls.at(-1)?.[0]).not.toHaveProperty("worktree");
});
