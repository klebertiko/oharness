import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunLogDetail } from "@/lib/runsApi";
import { RunEvidence } from "./RunEvidence";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows partial coverage and retrieves a saved artifact version", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: "saved answer" }) }));
  const detail: RunLogDetail = {
    id: "r1", harnessId: "h", harnessName: "Harness", source: "harness", status: "interrupted",
    startedAt: null, finishedAt: null, result: {}, coverage: "partial", lastSequence: 3,
    artifacts: [{ id: "a1", run_id: "r1", event_sequence: 3, kind: "node_output", name: "Agent output",
      version: 2, media_type: "text/plain", sha256: "hash" }],
  };
  render(<RunEvidence detail={detail} />);
  expect(screen.getByText(/Partial history/)).toBeTruthy();
  expect(screen.getByText(/execution did not resume/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Agent output · v2" }));
  expect(await screen.findByText("saved answer")).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/execute/logs/r1/artifacts/a1", { cache: "no-store" });
});

it("labels legacy coverage without inventing completeness", () => {
  const detail: RunLogDetail = {
    id: "old", harnessId: "h", harnessName: "Harness", source: "harness", status: "complete",
    startedAt: null, finishedAt: null, result: {}, coverage: "legacy_unknown", lastSequence: null, artifacts: [],
  };
  render(<RunEvidence detail={detail} />);
  expect(screen.getByText(/capture coverage is unknown/)).toBeTruthy();
});

function sse(...frames: [string, unknown][]) {
  const text = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const reads = [{ done: false, value: bytes }, { done: true, value: undefined }];
  return { ok: true, body: { getReader: () => ({ read: async () => reads.shift() ?? { done: true, value: undefined } }) } };
}

const resumable: RunLogDetail = {
  id: "r1", harnessId: "h", harnessName: "Harness", source: "harness", status: "interrupted",
  startedAt: null, finishedAt: null, result: {}, coverage: "partial", lastSequence: 3, artifacts: [],
  resumable: true, continuedFrom: null, parentSequence: null, continuations: [],
};

it("continues a resumable run for real: creates the linked run, starts it and shows what was restored and what ran", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "r2", continued_from: "r1", parent_sequence: 3, status: "pending" }) })
    .mockResolvedValueOnce(
      sse(
        ["run_start", { run_id: "r2", mode: "mock", order: [
          { node_id: "a", type: "llm", label: "Agent A", adapter: "mock", model: "", intrinsic: false },
          { node_id: "b", type: "llm", label: "Agent B", adapter: "mock", model: "", intrinsic: false },
        ] }],
        ["node_restored", { node_id: "a", output: "first answer" }],
        ["node_start", { node_id: "b", type: "llm", label: "Agent B", adapter: "mock", model: "", intrinsic: false }],
        ["node_stream", { node_id: "b", chunk: "second answer" }],
        ["node_done", { node_id: "b", output: "second answer", tokens: 5 }],
        ["harness_done", { status: "complete", total_tokens: 5, tokens_estimated: false, elapsed_ms: 10, nodes_run: 1 }],
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onContinued = vi.fn();
  render(<RunEvidence detail={resumable} onContinued={onContinued} />);
  expect(screen.getByText(/saved events stay as they are/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue as a new run" }));
  expect(await screen.findByText("Restored from the earlier run")).toBeTruthy();
  expect(await screen.findByText(/second answer/)).toBeTruthy();
  expect(screen.getByText(/first answer/)).toBeTruthy();
  expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/execute/logs/r1/continue");
  expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8000/execute/logs/r2/start");
  expect(onContinued).toHaveBeenCalledWith("r2");
});

it("says so when the continued run cannot be started, and offers the button again", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "r2", continued_from: "r1", parent_sequence: 3, status: "pending" }) })
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => "not_startable" }),
  );
  render(<RunEvidence detail={resumable} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue as a new run" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue as a new run" })).toBeTruthy();
});

it("shows where a continued run came from and hides the button for a run that cannot be continued", () => {
  const detail: RunLogDetail = {
    id: "r2", harnessId: "h", harnessName: "Harness", source: "harness", status: "pending",
    startedAt: null, finishedAt: null, result: {}, coverage: "partial", lastSequence: 1, artifacts: [],
    resumable: false, continuedFrom: "r1", parentSequence: 3, continuations: [],
  };
  render(<RunEvidence detail={detail} />);
  expect(screen.getByText(/Continues run r1 from event 3/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue as a new run" })).toBeNull();
});

it("has no axe violations with the continue control and the continued run's transcript on screen", async () => {
  const { axeViolations } = await import("@/test/axe");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "r2", continued_from: "r1", parent_sequence: 3, status: "pending" }) })
      .mockResolvedValueOnce(sse(["node_restored", { node_id: "a", output: "kept" }], ["harness_done", { status: "complete", total_tokens: 0, tokens_estimated: false, elapsed_ms: 1, nodes_run: 0 }])),
  );
  const { container } = render(<RunEvidence detail={resumable} />);
  expect(await axeViolations(container)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Continue as a new run" }));
  await screen.findByRole("status");
  expect(await axeViolations(container)).toEqual([]);
});

it("keeps what the continued run showed when the connection drops mid-run, and says so", async () => {
  const start = { run_id: "r2", mode: "mock", order: [{ node_id: "a", type: "llm", label: "Agent A", adapter: "mock", model: "", intrinsic: false }] };
  const frame = new TextEncoder().encode(
    `event: run_start\ndata: ${JSON.stringify(start)}\n\nevent: node_restored\ndata: ${JSON.stringify({ node_id: "a", output: "kept text" })}\n\n`,
  );
  const reads = [async () => ({ done: false, value: frame }), async () => { throw new Error("network down"); }];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "r2", continued_from: "r1", parent_sequence: 3, status: "pending" }) })
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => ({ read: () => (reads.shift() ?? (async () => ({ done: true })))() }) } }),
  );
  render(<RunEvidence detail={resumable} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue as a new run" }));
  expect(await screen.findByText(/kept text/)).toBeTruthy();
  expect((await screen.findByRole("alert")).textContent).toMatch(/dropped/);
  expect(screen.getByText(/kept text/)).toBeTruthy();
});
