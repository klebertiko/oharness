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

it("offers to continue a resumable run as a new, linked run and says the saved events stay untouched", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "r2", continued_from: "r1", parent_sequence: 3, status: "pending" }) }));
  const onContinued = vi.fn();
  const detail: RunLogDetail = {
    id: "r1", harnessId: "h", harnessName: "Harness", source: "harness", status: "interrupted",
    startedAt: null, finishedAt: null, result: {}, coverage: "partial", lastSequence: 3, artifacts: [],
    resumable: true, continuedFrom: null, parentSequence: null, continuations: [],
  };
  render(<RunEvidence detail={detail} onContinued={onContinued} />);
  expect(screen.getByText(/saved events stay as they are/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue as a new run" }));
  expect(await screen.findByText(/New run created from event 3/)).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/execute/logs/r1/continue", expect.objectContaining({ method: "POST" }));
  expect(onContinued).toHaveBeenCalledWith("r2");
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
