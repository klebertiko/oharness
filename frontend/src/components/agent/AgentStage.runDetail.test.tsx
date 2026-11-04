import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { AgentStage } from "./AgentStage";

/**
 * One run, one "run detail" control. A finished run used to be offered twice
 * at once: the per-message toggle (HistoricalRunDetail, saved on the thread
 * message) AND the stage-level toggle that survives for the in-memory run —
 * so with the detail open, an orphan "Show run detail" sat below it.
 */
const finishedRun = {
  runId: "run-1",
  status: "complete",
  mode: "live",
  step: false,
  plan: [
    {
      nodeId: "reply",
      type: "agent",
      label: "Nilo",
      adapter: "claude",
      model: "claude-sonnet-5",
      intrinsic: false,
      state: "done",
      phase: "",
      phaseDetail: "",
      blocks: [],
      output: "Sim, 1 + 1 = 2.",
      tokens: 19,
      latencyMs: 812,
    },
  ],
  cursor: 0,
  totals: { tokens: 19, nodesRun: 1, elapsedMs: 812, tokensEstimated: false },
  startedAt: 1_000,
  endedAt: 1_812,
  awaitingStep: null,
  steers: [],
  notices: [],
};

const runStreamState = vi.hoisted(() => ({ run: null as unknown, live: false }));

vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: runStreamState.run,
    elapsed: 812,
    live: runStreamState.live,
    reset: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    resolveGate: vi.fn(),
  }),
}));

vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("@/components/agent-run/Gate", () => ({ Gate: () => null }));
vi.mock("@/components/agent-run/Transcript", () => ({
  Transcript: () => <div data-testid="transcript" />,
}));

function detailControls() {
  return screen.queryAllByRole("button", { name: /run detail/i });
}

describe("AgentStage — a single run-detail control per run", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    runStreamState.run = finishedRun;
    runStreamState.live = false;
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.setState({ activeThreadId: id });
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: true,
      activeBundle: null,
      hydrate: async () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  });

  it("offers exactly one control once the finished run is saved on its chat message", () => {
    render(<AgentStage />);

    expect(screen.getByText("Sim, 1 + 1 = 2.")).toBeTruthy();
    expect(detailControls()).toHaveLength(1);
  });

  it("keeps exactly one control, now 'Hide', while the detail is open — no orphan 'Show' below it", () => {
    render(<AgentStage />);

    fireEvent.click(detailControls()[0]);

    const controls = detailControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].textContent).toBe("Hide run detail");
    expect(screen.getAllByTestId("transcript")).toHaveLength(1);
    // The detail of the run that just finished is already in memory — opening
    // it must not round-trip to the sidecar for a log it already has.
    // (The Flow switch reads its own setting when it mounts; that is not the run log.)
    expect(fetchSpy.mock.calls.filter(([url]) => !String(url).endsWith("/flow/config"))).toEqual([]);
  });

  it("exposes expanded state and the region it controls, and closes again on a second press", () => {
    render(<AgentStage />);
    const [toggle] = detailControls();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    const open = detailControls()[0];
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(open.getAttribute("aria-controls") ?? "");
    expect(region).not.toBeNull();
    expect(region?.querySelector("[data-testid='transcript']")).not.toBeNull();

    fireEvent.click(open);
    expect(detailControls()).toHaveLength(1);
    expect(detailControls()[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("transcript")).toBeNull();
  });

  it("keeps the stage-level control for a live run that has no chat message yet", () => {
    runStreamState.run = { ...finishedRun, runId: "run-live", status: "running", endedAt: null, totals: { ...finishedRun.totals, elapsedMs: 0 } };
    runStreamState.live = true;
    render(<AgentStage />);

    expect(detailControls()).toHaveLength(1);
    fireEvent.click(detailControls()[0]);
    expect(detailControls()).toHaveLength(1);
    expect(detailControls()[0].textContent).toBe("Hide run detail");
  });
});
