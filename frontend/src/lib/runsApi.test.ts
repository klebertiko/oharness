import { beforeEach, describe, expect, it, vi } from "vitest";
import { runResultText, runsApi } from "./runsApi";

const rawList = [
  {
    id: "r1",
    harness_id: "h1",
    harness_name: "OHarness Agile",
    status: "complete",
    started_at: "2026-09-10T12:00:00Z",
    finished_at: "2026-09-10T12:00:42Z",
  },
  {
    id: "r2",
    harness_id: "",
    harness_name: "Ad-hoc execution",
    status: "weird",
    started_at: null,
    finished_at: null,
  },
];

describe("runsApi", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("list GETs /execute/logs and camel-cases the rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rawList }));

    const runs = await runsApi.list();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/execute/logs", { cache: "no-store" });
    expect(runs[0]).toMatchObject({ id: "r1", harnessName: "OHarness Agile", status: "complete" });
    // Unknown status falls back rather than leaking a bad enum.
    expect(runs[1].status).toBe("unknown");
  });

  it("get GETs /execute/logs/{id} and carries the result payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...rawList[0], result: { output: "done" } }) }),
    );

    const run = await runsApi.get("r1");
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/execute/logs/r1", { cache: "no-store" });
    expect(run.result).toEqual({ output: "done" });
  });

  it("throws with the status on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }));
    await expect(runsApi.list()).rejects.toThrow("503 down");
  });

  it("runResultText prefers a known text field, then pretty JSON, then empty", () => {
    expect(runResultText({ output: "  hi  " })).toBe("hi");
    expect(runResultText({ nodes: 3 })).toBe(JSON.stringify({ nodes: 3 }, null, 2));
    expect(runResultText({})).toBe("");
  });
});

// DIRECT-HISTORY (Codex PEDIDO 2026-09-18 01:34): the sidecar now tags every
// log with `source: "direct" | "harness"` and persists `status: "failed"` for
// provider failures. The client keeps both instead of flattening them.
describe("runsApi · direct history", () => {
  it("keeps source and the failed status from the sidecar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { id: "d1", harness_id: "", harness_name: "", status: "failed", source: "direct", started_at: "2026-09-18T01:00:00Z", finished_at: "2026-09-18T01:00:03Z" },
      { id: "h1", harness_id: "h", harness_name: "Agile", status: "complete", started_at: null, finished_at: null },
    ]), { status: 200 })));
    const list = await runsApi.list();
    expect(list[0].status).toBe("failed");
    expect(list[0].source).toBe("direct");
    expect(list[1].source).toBe("harness");
    vi.unstubAllGlobals();
  });
});


it("preserves durable coverage, interrupted status and artifact metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    id: "r3", status: "interrupted", coverage: "partial", last_sequence: 3,
    artifacts: [{ id: "a1", run_id: "r3", kind: "node_output", version: 2 }],
  }) }));
  const run = await runsApi.get("r3");
  expect(run.status).toBe("interrupted");
  expect(run.coverage).toBe("partial");
  expect(run.lastSequence).toBe(3);
  expect(run.artifacts[0].version).toBe(2);
});
