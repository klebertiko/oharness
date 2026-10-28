import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import type { Op } from "@/lib/copilot/contract";
import { describeOps } from "@/lib/copilot/ops";
import { toCopilotGraph } from "@/lib/copilot/serialize";
import { goldenBaseCanvas } from "@/lib/copilot/testGraph";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore, type Proposal, type Turn } from "@/store/copilotStore";
import { ProposalCard } from "./ProposalCard";

const ops: Op[] = [
  { op: "addNode", ref: "n1", type: "agent", label: "Reviewer" },
  { op: "connect", from: "g1", fromPort: "fail", to: "n1" },
  { op: "updateNode", id: "a1", label: "Writer v2" },
];

function seed(over: Partial<Proposal> = {}) {
  const g = goldenBaseCanvas();
  useCanvasStore.setState({ isRunning: false, _history: [], _historyIndex: -1 });
  useCanvasStore.getState().loadGraph(g.nodes, g.edges);
  const turn: Turn = {
    id: "t1",
    role: "assistant",
    text: "Added a Reviewer.",
    proposal: { state: "pending", ops, lines: describeOps(ops, toCopilotGraph(g.nodes, g.edges)), excluded: [], seq: null, ...over },
  };
  useCopilotStore.setState({ turns: [turn], marks: {}, tab: "copilot", open: true });
  return turn;
}

const Card = () => {
  const turn = useCopilotStore((s) => s.turns[0]);
  return <ProposalCard turnId={turn.id} proposal={turn.proposal!} />;
};
const renderCard = () => render(<ReactFlowProvider><Card /></ReactFlowProvider>);

afterEach(cleanup);
beforeEach(() => useCopilotStore.getState().reset());

describe("ProposalCard", () => {
  it("lists each change with a checkbox, counted Apply, Discard and Refine, and leaves the canvas alone", () => {
    seed();
    renderCard();
    expect(screen.getByText("Proposed changes · 3")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Apply 3 changes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refine" })).toBeTruthy();
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
    expect(screen.getByRole("status").textContent).toMatch(/Nilo proposes 3 changes/);
  });

  it("moves focus to Apply when a proposal arrives", () => {
    seed();
    renderCard();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply 3 changes" }));
  });

  it("unchecking a node drops what depends on it and recounts Apply", async () => {
    seed();
    renderCard();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /Agent "Reviewer"/ }));
    expect(screen.getByText("Proposed changes · 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 1 change" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Gate.*Reviewer/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("Apply commits once and offers Keep and Undo", async () => {
    seed();
    renderCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    expect(useCanvasStore.getState().nodes).toHaveLength(5);
    expect(screen.getByText("Applied 3 changes")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByText("Kept 3 changes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Undo restores the canvas", async () => {
    seed();
    renderCard();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Apply 3 changes" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
    expect(screen.getByText("Undone")).toBeTruthy();
  });

  it("Escape discards a pending proposal", async () => {
    seed();
    renderCard();
    await userEvent.setup().keyboard("{Escape}");
    expect(useCopilotStore.getState().turns[0].proposal!.state).toBe("rejected");
    expect(screen.getByText("Discarded")).toBeTruthy();
    expect(useCanvasStore.getState().nodes).toHaveLength(4);
  });

  it("disables Undo with an explanatory title once the graph changed", () => {
    seed({ state: "applied", seq: -5 });
    renderCard();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).toBe("The graph changed since — use Undo (Mod+Z)");
  });

  it("an out-of-date proposal explains itself and cannot be applied", () => {
    seed({ state: "stale", notice: "The graph changed since Nilo proposed this, so it no longer fits." });
    renderCard();
    expect(screen.getByRole("alert").textContent).toMatch(/no longer fits/);
    expect(screen.queryByRole("button", { name: /^Apply/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("goes out of date by itself when the graph changes under it", async () => {
    seed();
    renderCard();
    useCanvasStore.getState().removeNode("g1");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(useCopilotStore.getState().turns[0].proposal!.state).toBe("stale");
  });

  it("disables Apply while a run owns the graph, says why, and re-enables it afterwards", () => {
    seed();
    renderCard();
    act(() => useCanvasStore.getState().setRunning(true));
    const apply = screen.getByRole("button", { name: "Apply 3 changes" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(screen.getByText("Stop the run to apply changes")).toBeTruthy();
    act(() => useCanvasStore.getState().setRunning(false));
    expect((screen.getByRole("button", { name: "Apply 3 changes" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Stop the run to apply changes")).toBeNull();
  });

  it("only takes focus when the proposal first arrives, not when the panel remounts", () => {
    seed();
    const first = renderCard();
    first.unmount();
    (document.activeElement as HTMLElement | null)?.blur();
    renderCard();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Apply 3 changes" }));
  });

  it("shows the reason when the chosen changes do not fit, and stays pending", () => {
    seed();
    renderCard();
    act(() => useCopilotStore.setState({ turns: [{ ...useCopilotStore.getState().turns[0], proposal: { ...useCopilotStore.getState().turns[0].proposal!, notice: "A graph holds at most 60 nodes" } }] }));
    expect(screen.getByRole("alert").textContent).toBe("A graph holds at most 60 nodes");
  });

  it("clicking Show on a line selects its node without leaving the review", async () => {
    seed();
    renderCard();
    await userEvent.setup().click(screen.getAllByRole("button", { name: /^Show / })[0]);
    expect(useCanvasStore.getState().selectedNodeId).toBeTruthy();
    expect(useCopilotStore.getState().tab).toBe("copilot");
  });
});
