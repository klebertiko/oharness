"use client";
import { useEffect, useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { previewProposal, type Mark } from "@/lib/copilot/preview";
import { PROPOSAL_STATES } from "@/lib/copilot/rules";
import type { HarnessNode } from "@/lib/types";
import { useCanvasStore } from "@/store/canvasStore";
import { useCopilotStore } from "@/store/copilotStore";

const NONE: { nodes: Node[]; edges: Edge[]; marks: Record<string, Mark> | null } = { nodes: [], edges: [], marks: null };

/**
 * The pending Nilo proposal as extra, inert canvas items. They exist only in
 * the flow's render list: the canvas store (and its undo history) never sees
 * them until Apply.
 */
export function useProposalGhosts() {
  const proposal = useCopilotStore((s) => s.turns.findLast((t) => t.proposal && PROPOSAL_STATES[t.proposal.state].canApply)?.proposal);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  const result = useMemo(() => {
    if (!proposal) return NONE;
    const p = previewProposal(nodes, edges, proposal.ops, proposal.excluded);
    return {
      marks: p.marks,
      nodes: p.ghostNodes.map((n) => ({
        ...n,
        draggable: false,
        selectable: false,
        deletable: false,
        connectable: false,
        // Not in the store, so the flow's own measurements never land on them: give a size to be drawn at all.
        initialWidth: 212,
        initialHeight: 96,
        ariaLabel: `Proposed: ${nodeKind(n)} ${String(n.data.label)}`,
      })),
      edges: p.ghostEdges.map((e) => ({ ...e, selectable: false, focusable: false, deletable: false, data: { ...e.data, ghost: true } })),
    };
  }, [proposal, nodes, edges]);

  // Marks on live nodes follow the live graph, like the ghosts do.
  useEffect(() => {
    if (!result.marks) return;
    const current = useCopilotStore.getState().marks;
    if (JSON.stringify(current) !== JSON.stringify(result.marks)) useCopilotStore.setState({ marks: result.marks });
  }, [result.marks]);

  return result;
}

const nodeKind = (n: HarnessNode) => ({ agent: "Agent", gate: "Gate", hitl: "HITL", skill: "Skill", mcp: "MCP server", tool: "Tool" })[n.type as string] ?? n.type;
