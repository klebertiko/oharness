/**
 * What a pending proposal looks like on the canvas, without touching it:
 * the live graph plus the selected ops, split into ghosts (new nodes and
 * wires) and marks (edited, removed). Ids are deterministic so the preview
 * does not flicker between renders.
 */
import type { HarnessEdge, HarnessNode } from "../types";
import type { Op } from "./contract";
import { diffMarks, materializeOps } from "./ops";

export type Mark = "added" | "changed" | "proposed" | "removed";

export interface Preview {
  ghostNodes: HarnessNode[];
  ghostEdges: HarnessEdge[];
  marks: Record<string, Mark>;
}

export const EMPTY_PREVIEW: Preview = { ghostNodes: [], ghostEdges: [], marks: {} };

export function selectedOps(ops: Op[], excluded: readonly number[]): Op[] {
  return ops.filter((_, i) => !excluded.includes(i));
}

export function previewProposal(nodes: HarnessNode[], edges: HarnessEdge[], ops: Op[], excluded: readonly number[]): Preview {
  const chosen = selectedOps(ops, excluded);
  if (chosen.length === 0) return EMPTY_PREVIEW;
  let n = 0;
  const next = materializeOps(nodes, edges, chosen, { newId: () => `ghost-${++n}` });
  const liveNodes = new Set(nodes.map((x) => x.id));
  const liveEdges = new Set(edges.map((e) => e.id));
  const ghostNodes = next.nodes.filter((x) => !liveNodes.has(x.id));
  const ghostEdges = next.edges.filter((e) => !liveEdges.has(e.id));
  const marks: Record<string, Mark> = {};
  for (const [id, mark] of Object.entries(diffMarks(nodes, next.nodes))) if (mark === "changed") marks[id] = "changed";
  for (const g of ghostNodes) marks[g.id] = "proposed";
  const kept = new Set(next.nodes.map((x) => x.id));
  for (const x of nodes) if (!kept.has(x.id)) marks[x.id] = "removed";
  return { ghostNodes, ghostEdges, marks };
}
