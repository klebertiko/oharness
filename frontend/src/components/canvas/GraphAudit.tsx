"use client";
import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvasStore";
import { PORTS } from "@/lib/ports";
import type { HarnessNode, NodeType } from "@/lib/types";

/**
 * Graph audit — top right, floating.
 *
 * A visual editor that will happily let you draw a harness that cannot run is
 * a drawing tool. These are the three faults that actually stop a run, checked
 * against the real graph on every change, and each one is a button that
 * selects and centres the offending node. Nothing here is advisory or
 * stylistic: if the strip is clear, the graph is wireable.
 */

interface Fault {
  nodeId: string;
  label: string;
  note: string;
}

/**
 * A graph with no faults still has exactly one node nothing points at (where
 * the run starts) and, once a HITL node exists, exactly one node that points
 * nowhere (the terminal approval — nothing consumes a merge). Flagging those
 * unconditionally means every valid harness shows warnings, which is worse
 * than showing none: it trains a person to stop reading this panel, and a
 * real fault then hides in the noise. Only the *excess* — a second orphaned
 * start, or a non-terminal node with nowhere to go — is actually wrong.
 */
function audit(nodes: HarnessNode[], edges: { source: string; target: string }[]): Fault[] {
  const faults: Fault[] = [];
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));

  const unreached = nodes.filter((n) => PORTS[n.type as NodeType].in.length > 0 && !hasIn.has(n.id));
  // The first one is the graph's entry point, not a fault — every valid
  // harness has exactly one. Any more than that are genuinely disconnected.
  for (const n of unreached.slice(1)) {
    faults.push({ nodeId: n.id, label: String(n.data.label ?? n.id), note: "never reached" });
  }

  for (const n of nodes) {
    const type = n.type as NodeType;
    if (type === "hitl") continue; // a terminal approval is *meant* to lead nowhere
    const schema = PORTS[type];
    if (schema.out.length > 0 && !hasOut.has(n.id)) {
      faults.push({ nodeId: n.id, label: String(n.data.label ?? n.id), note: "dead end" });
    }
  }
  return faults;
}

export function GraphAudit() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const { setCenter, getNode } = useReactFlow();

  const faults = useMemo(() => audit(nodes, edges), [nodes, edges]);
  const noEntry =
    nodes.length > 0 && !nodes.some((n) => n.type === "agent" || n.type === "gate");

  if (nodes.length === 0) return null;

  const reveal = (nodeId: string) => {
    setSelectedNode(nodeId);
    const n = getNode(nodeId);
    if (n) setCenter(n.position.x + 106, n.position.y + 50, { zoom: 1, duration: 260 });
  };

  const clean = faults.length === 0 && !noEntry;

  return (
    <div className="pointer-events-none absolute right-[10px] top-[10px] z-10 flex w-[188px] flex-col items-end gap-[5px]">
      <div role="status" className="oh-float pointer-events-auto flex min-h-control-sm w-full items-center gap-2 px-2">
        <span aria-hidden className={`h-1.5 w-1.5 flex-none rounded-none ${clean ? "bg-signal" : "bg-warn"}`} />
        <span className="t-body flex-1 text-ink-dim">
          {clean ? "All nodes wired" : `${faults.length + (noEntry ? 1 : 0)} not wired`}
        </span>
      </div>

      {noEntry && (
        <div className="oh-float pointer-events-auto flex w-full items-center gap-2 px-2 py-1">
          <span className="t-body flex-1 truncate text-ink-mute">No input node</span>
          <span className="t-meta flex-none text-warn-text">entry</span>
        </div>
      )}

      {faults.slice(0, 4).map((f) => (
        <button
          key={f.nodeId}
          type="button"
          onClick={() => reveal(f.nodeId)}
          className="oh-float oh-focus-inner pointer-events-auto flex min-h-control-md w-full items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-sub-200!"
        >
          <span className="t-body flex-1 truncate text-ink-dim">{f.label}</span>
          <span className="t-meta flex-none text-warn-text">{f.note}</span>
        </button>
      ))}

      {faults.length > 4 && (
        <span className="t-meta pr-1 text-ink-mute">+{faults.length - 4} more</span>
      )}
    </div>
  );
}
