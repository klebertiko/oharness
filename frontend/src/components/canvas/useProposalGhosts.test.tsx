import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Op } from "@/lib/copilot/contract";
import { goldenBaseCanvas } from "@/lib/copilot/testGraph";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore, type Turn } from "@/store/copilotStore";
import { useProposalGhosts } from "./useProposalGhosts";

const ops: Op[] = [
  { op: "addNode", ref: "n1", type: "agent", label: "Reviewer" },
  { op: "connect", from: "g1", fromPort: "fail", to: "n1" },
];

function seed(state: "pending" | "applied" = "pending") {
  const g = goldenBaseCanvas();
  useCanvasStore.getState().loadGraph(g.nodes, g.edges);
  const turn: Turn = { id: "t", role: "assistant", text: "", proposal: { state, ops, lines: [], excluded: [], seq: null } };
  useCopilotStore.setState({ turns: [turn] });
}

afterEach(cleanup);
beforeEach(() => useCopilotStore.getState().reset());

describe("useProposalGhosts", () => {
  it("renders a pending proposal as inert, labelled ghosts", () => {
    seed();
    const { result } = renderHook(() => useProposalGhosts());
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]).toMatchObject({ draggable: false, selectable: false, deletable: false, ariaLabel: "Proposed: Agent Reviewer" });
    expect(result.current.edges.length).toBeGreaterThan(0);
    expect(result.current.edges.every((e) => (e.data as { ghost?: boolean }).ghost && e.selectable === false)).toBe(true);
  });

  it("shows nothing once applied, rejected or when the person dropped every change", () => {
    seed("applied");
    expect(renderHook(() => useProposalGhosts()).result.current.nodes).toEqual([]);
    seed();
    act(() => useCopilotStore.getState().toggleOp("t", 0));
    expect(renderHook(() => useProposalGhosts()).result.current.nodes).toEqual([]);
  });
});
