import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Transcript } from "./Transcript";
import { emptyRun } from "./runReducer";
import type { RunState, Segment } from "./types";
import { useProviderStore, type Connection } from "@/components/providers/providerStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useActiveRunStore } from "@/store/activeRunStore";

function conn(overrides: Partial<Connection>): Connection {
  return {
    id: "c",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "https://api.anthropic.com",
    secret: null,
    health: "live",
    detail: "",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    enabled: true,
    lastProbe: "",
    ...overrides,
  };
}

function seg(overrides: Partial<Segment>): Segment {
  return {
    nodeId: "n",
    type: "agent",
    label: "Node",
    adapter: "claude",
    model: "claude-sonnet-5",
    intrinsic: false,
    state: "done",
    phase: "",
    phaseDetail: "",
    blocks: [],
    ...overrides,
  };
}

const ANTHROPIC = conn({ id: "an", label: "Anthropic" });
const OLLAMA = conn({ id: "ol", label: "Ollama local" });

/**
 * A four-node completed run: one direct-path node with no connection at all,
 * one pinned to the same connection the composer would pick by default, one
 * deliberately pinned elsewhere (the genuine mismatch), and one that errored
 * before finishing. Mirrors a real harness_done-terminated RunState rather
 * than a trivial stub — token/latency values are chosen to avoid
 * floating-point rounding boundaries in the formatters under test.
 */
function makeRun(overrides: Partial<RunState> = {}): RunState {
  const plan: Segment[] = [
    seg({ nodeId: "po", label: "PO", tokens: 1200, latencyMs: 2200, state: "done" }),
    seg({ nodeId: "dev", label: "Dev", tokens: 3400, latencyMs: 5100, state: "done", connectionId: "an" }),
    seg({ nodeId: "qa", label: "QA", tokens: 900, latencyMs: 1300, state: "done", connectionId: "ol" }),
    seg({ nodeId: "sec", label: "Security", tokens: 100, state: "error", error: "boom" }),
  ];
  return {
    ...emptyRun,
    runId: "r1",
    status: "complete",
    startedAt: 1_000,
    endedAt: 10_400,
    plan,
    totals: { tokens: 1200 + 3400 + 900 + 100, nodesRun: 4, elapsedMs: 9_400 },
    ...overrides,
  };
}

describe("Transcript — trajectory breakdown", () => {
  beforeEach(() => {
    useProviderStore.setState({ connections: [ANTHROPIC, OLLAMA] });
    useChatProviderStore.setState({ chosenId: "an" }); // composer's current default
  });

  afterEach(() => {
    cleanup();
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });
  });

  it("renders a rollup of real run totals, preferring the backend-measured elapsed over a stale live tick", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);

    // totals.elapsedMs (9400ms -> "9.4s") must win over the live `elapsed`
    // prop (500ms -> "0.5s") once harness_done has reported a real figure.
    expect(screen.getByText("9.4s")).toBeTruthy();
    expect(screen.queryByText("0.5s")).toBeNull();
    expect(screen.getByText("5.6k")).toBeTruthy(); // fmtTokens(5600)
    expect(screen.getByText("4/4")).toBeTruthy();
  });

  it("shows a live ticking elapsed while the run has not yet reported a backend-measured total", () => {
    const run = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    render(<Transcript run={run} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("1.5s")).toBeTruthy();
  });

  it("renders a safe fallback when the backend sends an unknown node type", () => {
    const unknown = seg({
      nodeId: "future-node",
      label: "Future node",
      type: "future-type" as Segment["type"],
    });
    render(<Transcript run={makeRun({ plan: [unknown], totals: { tokens: 0, nodesRun: 1, elapsedMs: 100 } })} onResolve={() => {}} />);

    expect(screen.getAllByText("Future node")).toHaveLength(2);
    expect(screen.getByText(/future-type/)).toBeTruthy();
  });

  /* ── run in progress / finished with real metrics / finished without ───── */
  it("in progress: ticking clock and a 'counting' label — neither estimated nor measured yet", () => {
    const run = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    render(<Transcript run={run} onResolve={() => {}} elapsed={1_500} />);
    const label = screen.getByText("counting");
    expect(label.getAttribute("title")).toMatch(/still running|in progress/i);
    expect(screen.queryByText(/estimated/i)).toBeNull();
    expect(screen.queryByText(/measured/i)).toBeNull();
    expect(screen.queryByText(/not recorded/i)).toBeNull();
  });

  it("shows whether Laya or the model made the routing decision", () => {
    const { rerender } = render(<Transcript run={makeRun({
      routeDecision: { source: "laya", reason: "confident", engageHarness: false, confidence: 0.97, latencyMs: 9.5 },
    })} onResolve={() => {}} />);
    expect(screen.getByText(/decided by Laya/i)).toBeTruthy();
    expect(screen.getByText(/97% confidence/i)).toBeTruthy();

    rerender(<Transcript run={makeRun({
      routeDecision: { source: "model_fallback", reason: "unavailable", engageHarness: true, confidence: null, latencyMs: null },
    })} onResolve={() => {}} />);
    expect(screen.getByText(/decided by model fallback/i)).toBeTruthy();
    expect(screen.getByText(/Laya unavailable/i)).toBeTruthy();
  });

  it("finished with real metrics: real duration, real tokens labelled measured, never 'estimated'", () => {
    const run = makeRun({ totals: { tokens: 19, nodesRun: 1, elapsedMs: 812, tokensEstimated: false } });
    render(<Transcript run={run} onResolve={() => {}} />);
    expect(screen.getByText("0.8s")).toBeTruthy();
    const label = screen.getByText("tokens measured");
    expect(label.getAttribute("title")).toMatch(/provider|reported/i);
    expect(screen.queryByText(/estimated/i)).toBeNull();
    expect(screen.queryByText(/not recorded/i)).toBeNull();
  });

  it("finished with estimated tokens: that, and only that, carries the 'estimated' label", () => {
    const run = makeRun({ totals: { tokens: 19, nodesRun: 1, elapsedMs: 812, tokensEstimated: true } });
    render(<Transcript run={run} onResolve={() => {}} />);
    expect(screen.getByText("tokens estimated").getAttribute("title")).toMatch(/estimated from/i);
    expect(screen.queryByText("tokens measured")).toBeNull();
  });

  it("finished without a captured duration: says so — no '—' elapsed, no fabricated 0", () => {
    const run = makeRun({
      plan: [seg({ nodeId: "reply", label: "Nilo", tokens: 19, latencyMs: undefined, tokensEstimated: false })],
      totals: { tokens: 19, nodesRun: 1, elapsedMs: 0, tokensEstimated: false },
    });
    render(<Transcript run={run} onResolve={() => {}} />);
    const note = screen.getByText("not recorded");
    expect(note.closest("[title]")?.getAttribute("title")).toMatch(/duration/i);
    expect(screen.queryByText("elapsed")).toBeNull(); // no "— elapsed" for a run that finished
    expect(screen.queryByText("0.0s")).toBeNull();
    expect(screen.queryByText("0ms")).toBeNull();
    // Tokens are still real, and the node row's missing latency is not a 0ms either.
    expect(screen.getByText("tokens measured")).toBeTruthy();
    const row = within(screen.getByRole("table")).getByText("Nilo").closest("tr")!;
    expect(within(row).getByText("19")).toBeTruthy();
    expect(within(row).getByText("—")).toBeTruthy();
  });

  it("finished by a log that predates token provenance: unconfirmed, not claimed as estimated", () => {
    const run = makeRun({ totals: { tokens: 19, nodesRun: 1, elapsedMs: 812 } });
    render(<Transcript run={run} onResolve={() => {}} />);
    expect(screen.getByText("tokens unconfirmed")).toBeTruthy();
    expect(screen.queryByText(/estimated/i)).toBeNull();
  });

  it("marks an estimated node's own token cell as approximate", () => {
    const run = makeRun({
      plan: [seg({ nodeId: "a", label: "Alpha", tokens: 42, latencyMs: 300, tokensEstimated: true })],
      totals: { tokens: 42, nodesRun: 1, elapsedMs: 300, tokensEstimated: true },
    });
    render(<Transcript run={run} onResolve={() => {}} />);
    const row = within(screen.getByRole("table")).getByText("Alpha").closest("tr")!;
    expect(within(row).getByText("~42").getAttribute("title")).toMatch(/estimated/i);
  });

  it("flips the label from counting to measured when harness_done arrives mid-view", () => {
    const running = makeRun({ status: "running", totals: { tokens: 900, nodesRun: 1, elapsedMs: 0 } });
    const { rerender } = render(<Transcript run={running} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("counting")).toBeTruthy();
    rerender(<Transcript run={makeRun({ totals: { tokens: 900, nodesRun: 1, elapsedMs: 4000, tokensEstimated: false } })} onResolve={() => {}} elapsed={1_500} />);
    expect(screen.getByText("tokens measured")).toBeTruthy();
    expect(screen.queryByText("counting")).toBeNull();
  });

  it("gives each completed node its own legible latency + token row, not just the aggregate", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    const poRow = within(table).getByText("PO").closest("tr")!;
    const devRow = within(table).getByText("Dev").closest("tr")!;
    const qaRow = within(table).getByText("QA").closest("tr")!;

    expect(within(poRow).getByText("2.20s")).toBeTruthy();
    expect(within(poRow).getByText("1.2k")).toBeTruthy();

    expect(within(devRow).getByText("5.10s")).toBeTruthy();
    expect(within(devRow).getByText("3.4k")).toBeTruthy();

    expect(within(qaRow).getByText("1.30s")).toBeTruthy();
    expect(within(qaRow).getByText("900")).toBeTruthy();
  });

  it("shows an honest placeholder, not a fabricated latency, for a node that errored before finishing", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");
    const secRow = within(table).getByText("Security").closest("tr")!;

    expect(within(secRow).getByText("—")).toBeTruthy();
    expect(within(secRow).getByText("100")).toBeTruthy(); // tokens were still real
  });

  it("badges only the node whose pinned connection genuinely differs from the composer's current default", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    const qaRow = within(table).getByText("QA").closest("tr")!;
    expect(within(qaRow).getByText(/pinned/i)).toBeTruthy();
    expect(within(qaRow).getByText(/Ollama local/)).toBeTruthy();

    // Same connection as the default: no badge.
    const devRow = within(table).getByText("Dev").closest("tr")!;
    expect(within(devRow).queryByText(/pinned/i)).toBeNull();

    // No connectionId at all (the harness-off direct path): no badge.
    const poRow = within(table).getByText("PO").closest("tr")!;
    expect(within(poRow).queryByText(/pinned/i)).toBeNull();

    // Errored, no connectionId either: no badge.
    const secRow = within(table).getByText("Security").closest("tr")!;
    expect(within(secRow).queryByText(/pinned/i)).toBeNull();
  });

  it("never badges a pin when the composer itself has no resolvable default to compare against", () => {
    useProviderStore.setState({ connections: [] });
    useChatProviderStore.setState({ chosenId: null });

    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");

    // QA is pinned to "ol", which is real, but there is nothing honest to
    // call "the default" right now — flagging every pin against nothing
    // configured would be noise, not signal.
    const qaRow = within(table).getByText("QA").closest("tr")!;
    expect(within(qaRow).queryByText(/pinned/i)).toBeNull();
  });

  it("shows a failover indicator, visually distinct from the pinned badge, on a node AC#4 fired for", () => {
    // engine.py only attaches `failover` once an earlier providerIds entry
    // was tried and rejected (AC#4) — QA here served on "ol" only after "an"
    // was tried and rejected first, never a plain pin. Composer default is
    // also "ol" here so the two badges' conditions are isolated: this
    // asserts failover renders on its own vocabulary, not layered under a
    // pinned-mismatch badge that would fire for an unrelated reason.
    useChatProviderStore.setState({ chosenId: "ol" });
    const run = makeRun({
      plan: [
        seg({ nodeId: "po", label: "PO", tokens: 1200, latencyMs: 2200, state: "done" }),
        seg({
          nodeId: "qa",
          label: "QA",
          tokens: 900,
          latencyMs: 1300,
          state: "done",
          connectionId: "ol",
          failover: { attempts: [{ connectionId: "an", reason: "Provider execution failed." }] },
        }),
      ],
    });
    render(<Transcript run={run} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");
    const qaRow = within(table).getByText("QA").closest("tr")!;

    const failoverBadge = within(qaRow).getByText(/failover/i);
    expect(failoverBadge).toBeTruthy();
    // Distinct from the pinned badge's own vocabulary, not just adjacent to it.
    expect(within(qaRow).queryByText(/^pinned:/i)).toBeNull();
    // Hover/tooltip discloses which connection was tried and rejected first.
    const badgeEl = failoverBadge.closest("[title]") ?? failoverBadge;
    expect(badgeEl.getAttribute("title")).toMatch(/anthropic/i);
    expect(badgeEl.getAttribute("title")).toMatch(/provider execution failed/i);
  });

  it("never shows a failover indicator on a node with a plain pin (no failover key at all)", () => {
    render(<Transcript run={makeRun()} onResolve={() => {}} elapsed={500} />);
    const table = screen.getByRole("table");
    const devRow = within(table).getByText("Dev").closest("tr")!; // plain connectionId, no failover
    expect(within(devRow).queryByText(/failover/i)).toBeNull();
  });

  it("renders no rollup at all for a run that has not started — no fabricated zeros", () => {
    render(<Transcript run={emptyRun} onResolve={() => {}} elapsed={0} />);
    expect(screen.queryByText("elapsed")).toBeNull();
    expect(screen.queryByText("tok")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  // SEC gate 2026-09-24 (gates/sec-fe-2026-09-24.md, P2-FE-1): a replayed
  // historical run's approval card used to always read the *global* active
  // run id, not the id of the run it was actually drawing — so approving a
  // pending tool call on a stale, replayed card could silently resume a
  // completely different, currently-live run's HITL gate.
  describe("approval card runId — never controls a run other than the one shown", () => {
    afterEach(() => useActiveRunStore.getState().setRunId(null));

    it("disables the approve/reject buttons when this Transcript's run is not the active one", () => {
      useActiveRunStore.getState().setRunId("some-other-live-run");
      const run = makeRun({
        runId: "historical-run",
        plan: [seg({ nodeId: "n", state: "done", blocks: [{ kind: "tool", call: {
          callId: "c1", name: "exec", args: "{}", argv: ["npm", "run", "test"],
          approval: { reason: "exec", risk: "normal", riskHints: [] },
        } }] })],
      });
      render(<Transcript run={run} onResolve={() => {}} />);
      const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
      expect(approve.disabled).toBe(true);
    });

    it("enables the approve/reject buttons when this Transcript's run is genuinely the active one", () => {
      useActiveRunStore.getState().setRunId("live-run");
      const run = makeRun({
        runId: "live-run",
        plan: [seg({ nodeId: "n", state: "done", blocks: [{ kind: "tool", call: {
          callId: "c1", name: "exec", args: "{}", argv: ["npm", "run", "test"],
          approval: { reason: "exec", risk: "normal", riskHints: [] },
        } }] })],
      });
      render(<Transcript run={run} onResolve={() => {}} />);
      const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
      expect(approve.disabled).toBe(false);
    });
  });
});
