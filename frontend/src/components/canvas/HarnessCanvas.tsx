"use client";
import { useProposalGhosts } from "./useProposalGhosts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  useReactFlow,
  useNodesInitialized,
  useStore,
  ConnectionLineType,
  ConnectionMode,
  SelectionMode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/store/canvasStore";
import { nodeTypes } from "./nodes";
import { edgeTypes, WireTips } from "./edges/HarnessWire";
import { CanvasDock } from "./CanvasDock";
import { GraphAudit } from "./GraphAudit";
import { ROLE_VAR } from "@/lib/roles";
import styles from "./canvas.module.css";
import type { HarnessNode, NodeTemplate, NodeType } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════════════════════
   The bench.

   The ground is ruled, not dotted: a fine 26px cross grid for placement plus a
   heavier 104px line grid behind it. Two frequencies give the canvas a sense
   of scale at any zoom — you can tell a 20% overview from a 200% close-up from
   the ground alone, which a uniform dot field never lets you do.

   Chrome sits on three edges and never the fourth: audit top-right, viewport
   dock bottom-centre, minimap bottom-right. The top-left quadrant is left
   empty on purpose — it is where a graph's entry node lands after a fit, and
   it is the first place the eye goes.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  onNodeClick?: (nodeId: string) => void;
}

export function HarnessCanvas({ onNodeClick }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const addNode = useCanvasStore((s) => s.addNode);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const setNodes = useCanvasStore((s) => s.setNodes);

  const { fitView, screenToFlowPosition } = useReactFlow();
  const initialised = useNodesInitialized();
  // xyflow fits against *its own* cached pane size, not the DOM's. Reading that
  // value is the only reliable signal that a fit will land where we expect.
  const paneWidth = useStore((s) => s.width);
  const fitState = useRef({ key: "", width: 0 });

  const [snap, setSnap] = useState(false);
  const [locked, setLocked] = useState(false);
  const [panMode, setPanMode] = useState(false);

  /* xyflow's snapToGrid only affects the *next* drag — flipping it on with
     nothing being dragged produces zero visible change, which reads as
     broken. Snapping every current node the moment it's turned on gives the
     toggle an immediate, honest effect. */
  const GRID = 26;
  const handleSnapChange = useCallback(
    (v: boolean) => {
      setSnap(v);
      if (v) {
        setNodes(
          nodes.map((n) => ({
            ...n,
            position: {
              x: Math.round(n.position.x / GRID) * GRID,
              y: Math.round(n.position.y / GRID) * GRID,
            },
          }))
        );
      }
    },
    [nodes, setNodes]
  );

  /* `fitView` on <ReactFlow> only runs at mount, so a graph that arrives later
     — a preset, an import, a deep link — would open off-screen at zoom 1.
     Refit when the *set of nodes* changes, and again when the stage is resized
     while the current graph has never been fitted at that width. Keyed on ids
     only: keying on the whole node array refits on every drag frame. */
  const idKey = nodes.map((n) => n.id).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Fit when the graph identity or pane width changes, not on every node-count change
  useEffect(() => {
    if (!initialised || nodes.length === 0) return;
    if (paneWidth < 40) return;
    if (fitState.current.key === idKey && fitState.current.width === paneWidth) return;
    fitState.current = { key: idKey, width: paneWidth };

    /* Fit now, then twice more shortly after. On a cold mount the pane is
       reported at its pre-layout width for a frame or two, and a fit computed
       against that value parks the graph in a corner at minimum zoom. Later
       calls read the settled size and land correctly; repeats are idempotent. */
    const raf = requestAnimationFrame(() => fitView({ padding: 0.16, duration: 0 }));
    const timers = [140, 420].map((ms) =>
      window.setTimeout(() => fitView({ padding: 0.16, duration: 200 }), ms)
    );
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(window.clearTimeout);
    };
  }, [initialised, idKey, paneWidth, fitView]);

  /* "Auto-arrange graph" moves every node at once, usually far from where the
     camera is looking. Re-frame after it lands; the animation is skipped for
     people who asked for reduced motion. */
  const fitSeq = useCanvasStore((s) => s.fitSeq);
  const lastFitSeq = useRef(fitSeq);
  useEffect(() => {
    if (fitSeq === lastFitSeq.current) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Marked as handled only once the frame runs: if this effect is torn down
    // first (a re-render), the next run still owes the fit.
    const raf = requestAnimationFrame(() => {
      lastFitSeq.current = fitSeq;
      fitView({ padding: 0.16, duration: reduce ? 0 : 320 });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitSeq, fitView]);

  /* Selection is owned by the store — the inspector, the command palette and
     the audit strip all set it — so it is mirrored onto the flow rather than
     read from it. One source of truth, no two-way sync to get wrong. */
  const ghosts = useProposalGhosts();
  const flowNodes = useMemo(
    () => [...nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })), ...ghosts.nodes],
    [nodes, selectedNodeId, ghosts.nodes]
  );
  const flowEdges = useMemo(() => (ghosts.edges.length ? [...edges, ...ghosts.edges] : edges), [edges, ghosts.edges]);

  /* A proposal the person cannot see is a proposal they cannot judge: frame the
     ghosts when a new set arrives (not on every toggle of the same ones). */
  const ghostKey = ghosts.nodes.map((n) => n.id).join("|");
  const framed = useRef(false);
  useEffect(() => {
    if (ghostKey === "") {
      framed.current = false;
      return;
    }
    if (framed.current) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Marked as framed only once the frame runs, so a re-run before then still owes it.
    const timers = [0, 160].map((ms) =>
      window.setTimeout(() => {
        framed.current = true;
        fitView({ padding: 0.2, duration: reduce ? 0 : 280 });
      }, ms),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [ghostKey, fitView]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      setSelectedNode(node.id);
      onNodeClick?.(node.id);
    },
    [setSelectedNode, onNodeClick]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  /* Drop lands the node where the pointer is, in *flow* coordinates — the old
     version subtracted a fixed pixel offset from client coordinates, which put
     the node somewhere else entirely at any zoom other than 100%. */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/harness-node");
      if (!raw) return;
      const template: NodeTemplate = JSON.parse(raw);
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const node: HarnessNode = {
        id: `${template.type}-${Date.now()}`,
        type: template.type,
        position: { x: Math.round(p.x - 106), y: Math.round(p.y - 26) },
        data: { ...template.defaultData } as HarnessNode["data"],
      };
      addNode(node);
      setSelectedNode(node.id);
    },
    [addNode, setSelectedNode, screenToFlowPosition]
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for palette drags only; nodes are also added by click and from the command palette, so no keyboard path is lost
    <div
      className={panMode ? `${styles.stage} ${styles.panMode}` : styles.stage}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <WireTips />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={() => setSelectedNode(null)}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.15}
        maxZoom={2.5}
        snapToGrid={snap}
        snapGrid={[26, 26]}
        nodesDraggable={!locked && !panMode}
        panOnDrag={locked ? false : panMode ? true : [1, 2]}
        selectionOnDrag={!locked && !panMode}
        selectionMode={SelectionMode.Partial}
        connectionMode={ConnectionMode.Strict}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={26}
        defaultEdgeOptions={{ type: "harness" }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--sub-000)" }}
      >
        {/* Two frequencies: a heavy 104px rule for scale, a fine 26px cross for
            placement. Both sit a single value step off the ground, so the grid
            is felt more than seen. */}
        <Background
          id="major"
          variant={BackgroundVariant.Lines}
          gap={104}
          lineWidth={1}
          color="var(--sub-100)"
        />
        <Background
          id="minor"
          variant={BackgroundVariant.Cross}
          gap={26}
          size={3}
          lineWidth={0.7}
          color="var(--sub-300)"
        />

        <GraphAudit />
        <CanvasDock
          snap={snap}
          onSnap={handleSnapChange}
          locked={locked}
          onLock={setLocked}
          panMode={panMode}
          onPanMode={setPanMode}
        />

        {/* An overview of nothing is just a black rectangle in the corner. */}
        {nodes.length > 2 && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => ROLE_VAR[(n.type ?? "agent") as NodeType]}
            nodeStrokeWidth={0}
            nodeBorderRadius={1}
            bgColor="var(--sub-100)"
            style={{ width: 132, height: 78 }}
            maskColor="rgb(0 0 0 / 0.58)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
