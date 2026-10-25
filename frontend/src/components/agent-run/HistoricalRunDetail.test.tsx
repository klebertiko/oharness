import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoricalRunDetail } from "./HistoricalRunDetail";
import { emptyRun, runReducer } from "./runReducer";
import type { RunState } from "./types";

describe("HistoricalRunDetail", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("replays the persisted event log into a real transcript on open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "r1",
          harness_id: "h1",
          harness_name: "OHarness Agile",
          status: "complete",
          started_at: null,
          finished_at: null,
          result: {
            events: [
              {
                event: "run_start",
                data: {
                  run_id: "r1",
                  mode: "live",
                  step: false,
                  order: [{ node_id: "PO", type: "agent", label: "PO", adapter: "mock", model: "" }],
                  unreachable: [],
                },
              },
              {
                event: "node_start",
                data: { node_id: "PO", type: "agent", label: "PO", adapter: "claude", model: "" },
              },
              {
                event: "node_stream",
                data: { node_id: "PO", chunk: "Oi! Como posso ajudar?" },
              },
              {
                event: "node_done",
                data: { node_id: "PO", output: "Oi! Como posso ajudar?", tokens: 8, latency_ms: 100 },
              },
              { event: "harness_done", data: { status: "complete" } },
            ],
          },
        }),
      })
    );

    render(<HistoricalRunDetail runId="r1" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText("Oi! Como posso ajudar?")).toBeTruthy());
    // The replayed segment's adapter was refreshed by node_start, same as a
    // live run — proves this goes through the real reducer, not a stub.
    expect(screen.getByText(/claude/i)).toBeTruthy();
  });

  it("shows an honest message when the run has nothing to replay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "r1",
          harness_id: "h1",
          harness_name: "OHarness Agile",
          status: "complete",
          started_at: null,
          finished_at: null,
          result: { events: 4 }, // the old, pre-fix shape: a count, not a list
        }),
      })
    );

    render(<HistoricalRunDetail runId="r1" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText(/wasn't saved/i)).toBeTruthy());
  });

  it("shows an honest message when the run_id has no log at all (a direct/no-harness turn)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" })
    );

    render(<HistoricalRunDetail runId="ghost" />);
    fireEvent.click(screen.getByText("Show run detail"));

    await waitFor(() => expect(screen.getByText(/wasn't saved/i)).toBeTruthy());
  });

  /* The log a direct "Nilo" reply persisted before durations were captured:
     latency_ms 0, elapsed_ms 0, no token provenance. */
  function replyLog(over: { latency?: number; elapsed?: number; estimated?: boolean } = {}) {
    return {
      id: "r2",
      harness_id: "adhoc",
      harness_name: "Nilo reply (no harness)",
      status: "complete",
      started_at: null,
      finished_at: null,
      result: {
        events: [
          {
            event: "run_start",
            data: {
              run_id: "r2", mode: "live", step: false, unreachable: [],
              order: [{ node_id: "reply", type: "agent", label: "Nilo", adapter: "claude", model: "m" }],
            },
          },
          { event: "node_start", data: { node_id: "reply", type: "agent", label: "Nilo", adapter: "claude", model: "m" } },
          { event: "node_stream", data: { node_id: "reply", chunk: "Sim, 1 + 1 = 2." } },
          {
            event: "node_done",
            data: {
              node_id: "reply", output: "Sim, 1 + 1 = 2.", tokens: 19, latency_ms: over.latency ?? 0,
              ...(over.estimated === undefined ? {} : { tokens_estimated: over.estimated }),
            },
          },
          {
            event: "harness_done",
            data: {
              status: "complete", total_tokens: 19, nodes_run: 1, elapsed_ms: over.elapsed ?? 0,
              ...(over.estimated === undefined ? {} : { tokens_estimated: over.estimated }),
            },
          },
        ],
      },
    };
  }

  it("a finished reply with no captured duration says 'not recorded' — never '— elapsed', 0ms, or 'estimated'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => replyLog({ estimated: false }) }));
    render(<HistoricalRunDetail runId="r2" />);
    fireEvent.click(screen.getByRole("button", { name: "Show run detail" }));

    await waitFor(() => expect(screen.getAllByText("Sim, 1 + 1 = 2.").length).toBeGreaterThan(0));
    expect(screen.getByText("not recorded")).toBeTruthy();
    expect(screen.queryByText("elapsed")).toBeNull();
    expect(screen.queryByText("0ms")).toBeNull();
    expect(screen.queryByText(/estimated/i)).toBeNull();
    expect(screen.getByText("tokens measured")).toBeTruthy();
    expect(screen.getAllByText("19")).toHaveLength(2); // rollup + the node row
  });

  it("a finished reply with a captured duration shows it, and real tokens stay measured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => replyLog({ latency: 640, elapsed: 812, estimated: false }) }),
    );
    render(<HistoricalRunDetail runId="r2" />);
    fireEvent.click(screen.getByRole("button", { name: "Show run detail" }));

    await waitFor(() => expect(screen.getByText("0.8s")).toBeTruthy());
    expect(screen.getByText("640ms")).toBeTruthy();
    expect(screen.queryByText("not recorded")).toBeNull();
    expect(screen.queryByText(/estimated/i)).toBeNull();
  });

  it("estimated tokens are still labelled estimated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => replyLog({ latency: 640, elapsed: 812, estimated: true }) }),
    );
    render(<HistoricalRunDetail runId="r2" />);
    fireEvent.click(screen.getByRole("button", { name: "Show run detail" }));
    await waitFor(() => expect(screen.getByText("tokens estimated")).toBeTruthy());
  });

  describe("expand/collapse semantics", () => {
    it("is one real button with aria-expanded, aria-controls pointing at the region it reveals", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => replyLog({ estimated: false }) }));
      render(<HistoricalRunDetail runId="r2" />);

      const closed = screen.getByRole("button", { name: "Show run detail" });
      expect(closed.getAttribute("aria-expanded")).toBe("false");
      expect(closed.getAttribute("type")).toBe("button");

      fireEvent.click(closed);
      const open = await screen.findByRole("button", { name: "Hide run detail" });
      expect(open.getAttribute("aria-expanded")).toBe("true");
      const region = document.getElementById(open.getAttribute("aria-controls") ?? "");
      expect(region).not.toBeNull();
      await waitFor(() => expect(region?.textContent).toMatch(/Sim, 1 \+ 1 = 2\./));
      // exactly one control for this run, before and after opening
      expect(screen.getAllByRole("button", { name: /run detail/i })).toHaveLength(1);

      fireEvent.click(open);
      expect(screen.getByRole("button", { name: "Show run detail" }).getAttribute("aria-expanded")).toBe("false");
      expect(document.getElementById(open.getAttribute("aria-controls") ?? "")).toBeNull();
    });

    it("announces loading politely", async () => {
      let release!: (v: unknown) => void;
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((r) => (release = r))));
      render(<HistoricalRunDetail runId="r2" />);
      fireEvent.click(screen.getByRole("button", { name: "Show run detail" }));
      expect(screen.getByRole("status").textContent).toMatch(/loading/i);
      release({ ok: false, status: 404, text: async () => "" });
      await waitFor(() => expect(screen.getByText(/wasn't saved/i)).toBeTruthy());
    });
  });

  describe("with the run already in memory (the run that just finished)", () => {
    function inMemoryRun(): RunState {
      let r = runReducer(emptyRun, { type: "reset", mode: "live", step: false });
      for (const [event, data] of [
        ["run_start", { run_id: "r3", order: [{ node_id: "reply", label: "Nilo", type: "agent" }] }],
        ["node_start", { node_id: "reply", label: "Nilo", type: "agent", adapter: "claude", model: "m" }],
        ["node_done", { node_id: "reply", output: "Sim, 1 + 1 = 2.", tokens: 19, latency_ms: 700, tokens_estimated: false }],
        ["harness_done", { status: "complete", total_tokens: 19, elapsed_ms: 900, nodes_run: 1, tokens_estimated: false }],
      ] as const) {
        r = runReducer(r, { type: "sse", event, data: data as Record<string, unknown> });
      }
      return r;
    }

    it("opens straight from memory without calling the sidecar", () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      render(<HistoricalRunDetail runId="r3" run={inMemoryRun()} />);
      fireEvent.click(screen.getByRole("button", { name: "Show run detail" }));
      expect(screen.getByText("0.9s")).toBeTruthy();
      expect(screen.getByText("700ms")).toBeTruthy();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("can start open, carrying over a detail the person already expanded", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<HistoricalRunDetail runId="r3" run={inMemoryRun()} defaultOpen />);
      expect(screen.getByRole("button", { name: "Hide run detail" })).toBeTruthy();
      expect(screen.getByText("0.9s")).toBeTruthy();
    });

    it("loads saved coverage on request while keeping the in-memory transcript", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
        id: "r3", status: "complete", coverage: "complete", last_sequence: 4,
        result: { events: [] }, artifacts: [],
      }) }));
      render(<HistoricalRunDetail runId="r3" run={inMemoryRun()} defaultOpen />);
      fireEvent.click(screen.getByRole("button", { name: "Load saved outputs" }));
      expect(await screen.findByText(/Complete history/)).toBeTruthy();
      expect(screen.getByText("0.9s")).toBeTruthy();
    });
  });
});
