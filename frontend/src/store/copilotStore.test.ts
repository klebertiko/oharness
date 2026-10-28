import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/copilot/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/copilot/api")>();
  return { ...actual, planGraphEdit: vi.fn() };
});

import { CopilotApiError, planGraphEdit } from "@/lib/copilot/api";
import { goldenBaseCanvas } from "@/lib/copilot/testGraph";
import type { Op, PlanResponse } from "@/lib/copilot/contract";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "./canvasStore";
import { useCopilotStore } from "./copilotStore";

const examples = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../backend/studio_copilot/contract_examples.json"), "utf8"),
) as { cases: { name: string; ops: PlanResponse["ops"] }[] };
const addAndWire = examples.cases.find((c) => c.name === "add_and_wire")!.ops;

const plan = (over: Partial<PlanResponse> = {}): PlanResponse => ({ summary: "Added a Reviewer.", ops: addAndWire, source: "model", tokens: 12, ...over });

const canvas = () => useCanvasStore.getState();
const copilot = () => useCopilotStore.getState();
const mockPlan = vi.mocked(planGraphEdit);

beforeEach(() => {
  mockPlan.mockReset();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  const g = goldenBaseCanvas();
  canvas().loadGraph(g.nodes, g.edges);
  copilot().reset();
  useCopilotStore.setState({ open: false, tab: "inspector" });
});

describe("copilotStore.send", () => {
  it("holds a plan as a pending proposal and leaves the canvas untouched", async () => {
    mockPlan.mockResolvedValue(plan());
    const before = structuredClone({ nodes: canvas().nodes, edges: canvas().edges });
    const seq = canvas().headSeq();
    await copilot().send("add a reviewer", { mode: "live", connectionId: "conn-1" });

    expect(mockPlan.mock.calls[0][0]).toMatchObject({ message: "add a reviewer", mode: "live", connection_id: "conn-1" });
    const turns = copilot().turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1]).toMatchObject({ text: "Added a Reviewer.", source: "model" });
    expect(turns[1].proposal).toMatchObject({ state: "pending", excluded: [], seq: null });
    expect(turns[1].proposal!.lines).toHaveLength(3);
    expect({ nodes: canvas().nodes, edges: canvas().edges }).toEqual(before);
    expect(canvas().headSeq()).toBe(seq);
    expect(Object.values(copilot().marks)).toEqual(["proposed"]);
    expect(copilot().status).toBe("idle");
  });

  it("apply commits the selected changes as one undo step and undo reverses them", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const id = copilot().turns[1].id;
    const beforeEdges = structuredClone(canvas().edges);
    copilot().apply(id);
    expect(canvas().nodes).toHaveLength(5);
    const added = canvas().nodes.find((n) => !["a1", "g1", "h1", "s1"].includes(n.id))!;
    expect(copilot().turns[1].proposal).toMatchObject({ state: "applied", seq: canvas().headSeq() });
    expect(copilot().marks).toEqual({ [added.id]: "added" });

    copilot().undo(id);
    expect(canvas().nodes).toHaveLength(4);
    expect(canvas().edges).toEqual(beforeEdges);
    expect(copilot().turns[1].proposal!.state).toBe("undone");
    expect(copilot().marks).toEqual({});
  });

  it("reject discards the proposal without touching the canvas", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const seq = canvas().headSeq();
    copilot().reject(copilot().turns[1].id);
    expect(copilot().turns[1].proposal!.state).toBe("rejected");
    expect(canvas().nodes).toHaveLength(4);
    expect(canvas().headSeq()).toBe(seq);
    expect(copilot().marks).toEqual({});
  });

  it("sends only the allowlisted graph, never credentials", async () => {
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    canvas().updateNodeData("a1", { secretRef: "vault://k", endpoint: "https://x.test", providerIds: ["p"] });
    await copilot().send("hello", { mode: "mock" });
    const sent = JSON.stringify(mockPlan.mock.calls[0][0]);
    expect(sent).not.toMatch(/vault:\/\/k|x\.test|secretRef|providerIds/);
  });

  it("an empty op list adds an assistant turn with no proposal", async () => {
    mockPlan.mockResolvedValue(plan({ summary: "Which steps do you want?", ops: [] }));
    await copilot().send("hmm", { mode: "mock" });
    expect(copilot().turns[1].proposal).toBeUndefined();
    expect(canvas().nodes).toHaveLength(4);
  });

  it("after a manual edit Undo is unavailable and does not touch the canvas", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const id = copilot().turns[1].id;
    copilot().apply(id);
    expect(copilot().undoAvailable(id)).toBe(true);
    canvas().addNode({ id: "manual", type: "agent", position: { x: 0, y: 400 }, data: { label: "Manual" } });
    expect(copilot().undoAvailable(id)).toBe(false);
    copilot().undo(id);
    expect(canvas().nodes).toHaveLength(6);
    expect(copilot().turns[1].proposal!.state).toBe("applied");
  });

  it("does not apply when the live graph drifted during the request", async () => {
    mockPlan.mockImplementation(async () => {
      canvas().removeNode("g1");
      return plan();
    });
    await copilot().send("add a reviewer", { mode: "mock" });
    expect(canvas().nodes.map((n) => n.id)).toEqual(["a1", "h1", "s1"]);
    const last = copilot().turns.at(-1)!;
    expect(last.error).toMatchObject({ text: "The graph changed while Nilo was working", retry: "add a reviewer" });
    expect(last.proposal).toBeUndefined();
    expect(copilot().marks).toEqual({});
  });

  it("does not apply while a run owns the graph and keeps the proposal pending", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    canvas().setRunning(true);
    copilot().apply(copilot().turns[1].id);
    expect(canvas().nodes).toHaveLength(4);
    expect(copilot().turns[1].proposal!.state).toBe("pending");
  });

  it("a failed or cancelled request leaves the pending proposal in place", async () => {
    mockPlan.mockResolvedValueOnce(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    mockPlan.mockRejectedValueOnce(new TypeError("fetch failed"));
    await copilot().send("refine it", { mode: "mock" });
    expect(copilot().turns[1].proposal!.state).toBe("pending");
    expect(Object.values(copilot().marks)).toEqual(["proposed"]);
  });

  it("a selection that no longer fits blocks Apply with the reason, without going stale", async () => {
    mockPlan.mockResolvedValue(plan({ ops: [{ op: "removeNode", id: "s1" }, { op: "addNode", ref: "n1", type: "agent", label: "Extra" }] }));
    await copilot().send("swap", { mode: "mock" });
    const id = copilot().turns[1].id;
    // 60 nodes: the removal makes room for the addition, so dropping the removal overflows the 60-node limit.
    const filler = Array.from({ length: 56 }, (_, i) => ({ id: `f${i}`, type: "agent" as const, position: { x: 0, y: 0 }, data: { label: `F${i}` } }));
    canvas().loadGraph([...canvas().nodes, ...filler], canvas().edges);
    copilot().toggleOp(id, 0);
    copilot().revalidate(id);
    expect(copilot().turns[1].proposal).toMatchObject({ state: "pending" });
    copilot().apply(id);
    expect(copilot().turns[1].proposal).toMatchObject({ state: "pending" });
    expect(copilot().turns[1].proposal!.notice).toMatch(/at most 60 nodes/);
    expect(canvas().nodes).toHaveLength(60);
  });

  it.each([
    [new CopilotApiError(422, { error: "plan_invalid" }), "didn't fit the graph rules"],
    [new CopilotApiError(400, { error: "provider_unavailable", detail: "Paste an Anthropic key to send" }), "Paste an Anthropic key to send"],
    [new CopilotApiError(402, { error: "budget_exceeded", detail: "Monthly budget reached" }), "Monthly budget reached"],
    [new CopilotApiError(504, { error: "provider_timeout" }), "took too long"],
    [new CopilotApiError(413, { error: "payload_too_large" }), "too large"],
    [new TypeError("fetch failed"), "reach"],
  ])("maps %o to a human error with a retry", async (err, fragment) => {
    mockPlan.mockRejectedValue(err);
    await copilot().send("do it", { mode: "mock" });
    const last = copilot().turns.at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.error!.text).toContain(fragment);
    expect(last.error!.retry).toBe("do it");
    expect(copilot().status).toBe("idle");
  });

  it("a 402 offers a way to Providers", async () => {
    mockPlan.mockRejectedValue(new CopilotApiError(402, { error: "budget_exceeded", detail: "Monthly budget reached" }));
    await copilot().send("do it", { mode: "live", connectionId: "c" });
    expect(copilot().turns.at(-1)!.error!.link).toBe("providers");
  });

  it("cancel aborts the request, returns to idle and adds no assistant turn", async () => {
    mockPlan.mockImplementation(
      (_req, signal) =>
        new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = copilot().send("slow", { mode: "mock" });
    expect(copilot().status).toBe("working");
    copilot().cancel();
    await pending;
    expect(copilot().status).toBe("idle");
    expect(copilot().turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("a new prompt replaces a pending proposal and keeps an applied one", async () => {
    mockPlan.mockResolvedValueOnce(plan());
    await copilot().send("first", { mode: "mock" });
    const first = copilot().turns[1].id;
    mockPlan.mockResolvedValueOnce(plan({ summary: "Nothing to change.", ops: [] }));
    await copilot().send("second", { mode: "mock" });
    expect(copilot().turns.find((t) => t.id === first)!.proposal!.state).toBe("replaced");
    expect(canvas().nodes).toHaveLength(4);
    expect(copilot().marks).toEqual({});

    mockPlan.mockResolvedValueOnce(plan());
    await copilot().send("third", { mode: "mock" });
    const third = copilot().turns.at(-1)!.id;
    copilot().apply(third);
    mockPlan.mockResolvedValueOnce(plan({ summary: "Nothing.", ops: [] }));
    await copilot().send("fourth", { mode: "mock" });
    expect(copilot().turns.find((t) => t.id === third)!.proposal!.state).toBe("kept");
  });

  it("keep clears the marks and collapses an applied proposal", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add", { mode: "mock" });
    copilot().apply(copilot().turns[1].id);
    copilot().keep(copilot().turns[1].id);
    expect(copilot().turns[1].proposal!.state).toBe("kept");
    expect(copilot().marks).toEqual({});
    expect(canvas().nodes).toHaveLength(5);
  });

  it("applies only the changes the person kept, dropping dependants with the node", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const id = copilot().turns[1].id;
    const ops = copilot().turns[1].proposal!.ops;
    const addAt = ops.findIndex((o) => o.op === "addNode");
    copilot().toggleOp(id, addAt);
    const excluded = copilot().turns[1].proposal!.excluded;
    expect(excluded).toContain(addAt);
    expect(excluded.length).toBeGreaterThan(1);
    expect(copilot().marks).toEqual({});
    copilot().apply(id); // nothing left to apply
    expect(canvas().nodes).toHaveLength(4);
    expect(copilot().turns[1].proposal!.state).toBe("pending");

    copilot().toggleOp(id, addAt);
    expect(copilot().turns[1].proposal!.excluded).toEqual([]);
  });

  it("goes stale, without touching the canvas, when the graph changes under a pending proposal", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    const id = copilot().turns[1].id;
    canvas().removeNode("g1");
    copilot().revalidate(id);
    expect(copilot().turns[1].proposal).toMatchObject({ state: "stale" });
    expect(copilot().turns[1].proposal!.notice).toMatch(/changed/i);
    copilot().apply(id);
    expect(canvas().nodes.map((n) => n.id)).toEqual(["a1", "h1", "s1"]);
    copilot().reject(id);
    expect(copilot().turns[1].proposal!.state).toBe("rejected");
  });

  it("keeps every history turn within the backend's 2000-character limit", async () => {
    const many: Op[] = Array.from({ length: 40 }, (_, i) => ({ op: "addNode", ref: `n${i + 1}`, type: "agent", label: `A long enough label for agent number ${i + 1}` }));
    mockPlan.mockResolvedValueOnce(plan({ ops: many, summary: "x".repeat(900) }));
    await copilot().send("big", { mode: "mock" });
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    await copilot().send("next", { mode: "mock" });
    for (const turn of mockPlan.mock.calls.at(-1)![0].history) expect(turn.text.length).toBeLessThanOrEqual(2000);
  });

  it("tells Nilo what was discarded or kept when the next prompt refines it", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add a reviewer", { mode: "mock" });
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    await copilot().send("make it a Gate instead", { mode: "mock" });
    const history = mockPlan.mock.calls.at(-1)![0].history;
    expect(history.at(-1)!.text).toMatch(/not applied/i);
  });

  it("sends at most the last 6 summaries as history, without error turns", async () => {
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    for (let i = 0; i < 5; i++) await copilot().send(`turn ${i}`, { mode: "mock" });
    mockPlan.mockRejectedValueOnce(new Error("boom"));
    await copilot().send("bad", { mode: "mock" });
    mockPlan.mockResolvedValue(plan({ ops: [] }));
    await copilot().send("last", { mode: "mock" });
    const history = mockPlan.mock.calls.at(-1)![0].history;
    expect(history.length).toBeLessThanOrEqual(6);
    expect(history.every((h) => !h.text.includes("couldn't"))).toBe(true);
  });

  it("reset clears turns, marks and cancels work", async () => {
    mockPlan.mockResolvedValue(plan());
    await copilot().send("add", { mode: "mock" });
    copilot().reset();
    expect(copilot().turns).toEqual([]);
    expect(copilot().marks).toEqual({});
    expect(copilot().status).toBe("idle");
  });
});

describe("copilotStore navigation", () => {
  it("openCopilot opens the Copilot tab and the right column", () => {
    useShellStore.setState({ rightOpen: false });
    copilot().openCopilot();
    expect(copilot()).toMatchObject({ open: true, tab: "copilot" });
    expect(useShellStore.getState().rightOpen).toBe(true);
    copilot().close();
    expect(copilot()).toMatchObject({ open: false, tab: "inspector" });
  });
});
