import { describe, expect, it } from "vitest";
import examples from "../../../../backend/studio_copilot/contract_examples.json";
import type { Op } from "./contract";
import { previewProposal } from "./preview";
import { goldenBaseCanvas } from "./testGraph";

const addAndWire = (examples as { cases: { name: string; ops: Op[] }[] }).cases.find((c) => c.name === "add_and_wire")!.ops;

describe("previewProposal", () => {
  it("returns ghosts for new nodes and wires and leaves the live graph alone", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const before = structuredClone({ nodes, edges });
    const p = previewProposal(nodes, edges, addAndWire, []);
    expect(p.ghostNodes).toHaveLength(1);
    expect(p.ghostEdges.length).toBeGreaterThan(0);
    expect(p.marks[p.ghostNodes[0].id]).toBe("proposed");
    expect({ nodes, edges }).toEqual(before);
  });

  it("is stable between calls so the canvas does not flicker", () => {
    const { nodes, edges } = goldenBaseCanvas();
    expect(previewProposal(nodes, edges, addAndWire, []).ghostNodes[0].id).toBe(previewProposal(nodes, edges, addAndWire, []).ghostNodes[0].id);
  });

  it("marks edited and removed nodes, and skips excluded changes", () => {
    const { nodes, edges } = goldenBaseCanvas();
    const ops: Op[] = [
      { op: "updateNode", id: "a1", label: "Writer v2" },
      { op: "removeNode", id: "s1" },
    ];
    expect(previewProposal(nodes, edges, ops, []).marks).toEqual({ a1: "changed", s1: "removed" });
    expect(previewProposal(nodes, edges, ops, [1]).marks).toEqual({ a1: "changed" });
    expect(previewProposal(nodes, edges, ops, [0, 1]).ghostNodes).toEqual([]);
  });
});
