"use client";
import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Play, LayoutTemplate } from "lucide-react";

import { AppShell } from "@/components/shell/AppShell";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { NodePalette } from "@/components/sidebar/NodePalette";
import { PropertiesPanel } from "@/components/sidebar/PropertiesPanel";
import { HarnessCanvas } from "@/components/canvas/HarnessCanvas";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessActions } from "@/lib/actions";
import { HARNESS_PRESETS } from "@/lib/templates";
import { BUNDLED_HARNESS_COMMAND_GROUP } from "@/lib/studioExamples";
import type { Command } from "@/components/shell/commands";
import type { HarnessNode, HarnessEdge } from "@/lib/types";

/**
 * Canvas bench — a development route for the graph workstream.
 *
 * It mounts the real shell around the real canvas and opens on a preset that
 * is mid-run, so every state the node and wire system has to express (idle,
 * complete with residue, running with a live wire, selected) is on screen at
 * once. It exists to be looked at; the product route is `/`.
 *
 * Query params: `?preset=<id>` picks a preset, `?run=0` opens it cold.
 */
export default function CanvasBench() {
  const loadGraph = useCanvasStore((s) => s.loadGraph);
  const setHarnessMeta = useCanvasStore((s) => s.setHarnessMeta);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const harnessMeta = useCanvasStore((s) => s.harnessMeta);
  const executionMode = useCanvasStore((s) => s.executionMode);
  const isRunning = useCanvasStore((s) => s.isRunning);
  const actions = useHarnessActions();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Seed the dev canvas once on mount; the preset comes from the URL and the store actions are stable
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const preset =
      HARNESS_PRESETS.find((p) => p.id === q.get("preset")) ??
      HARNESS_PRESETS.find((p) => p.id === "critic-gate")!;

    let graphNodes = preset.graph.nodes as HarnessNode[];
    let graphEdges = preset.graph.edges as HarnessEdge[];

    if (q.get("run") !== "0" && preset.id === "critic-gate") {
      const state: Record<string, Partial<HarnessNode["data"]>> = {
        "cg-input": { status: "complete", latencyMs: 4 },
        "cg-memory": { status: "complete", latencyMs: 11 },
        "cg-writer": {
          status: "complete",
          latencyMs: 2140,
          tokens: 612,
          output:
            "OHarness v0.4 adds named ports on every node, so a branch now says what it means on the wire itself.",
        },
        "cg-critic": { status: "running" },
        "cg-review": { status: "paused" },
      };
      graphNodes = graphNodes.map((n) => ({ ...n, data: { ...n.data, ...state[n.id] } }));
      graphEdges = graphEdges.map((e) =>
        e.id === "g3" ? { ...e, data: { ...e.data, live: true } } : e
      );
    }

    loadGraph(graphNodes, graphEdges);
    setHarnessMeta({ id: null, name: preset.name, description: preset.description });
    setSelectedNode("cg-critic");
  }, []);

  const commands: Command[] = [
    { id: "run", label: "Run harness", group: "Run", icon: Play, chord: "Mod+Enter", run: actions.run },
    ...HARNESS_PRESETS.map((p) => ({
      id: `preset:${p.id}`,
      label: p.name,
      group: BUNDLED_HARNESS_COMMAND_GROUP,
      icon: LayoutTemplate,
      meta: p.id,
      run: () => {
        loadGraph(p.graph.nodes as HarnessNode[], p.graph.edges as HarnessEdge[]);
        setHarnessMeta({ id: null, name: p.name, description: p.description });
      },
    })),
  ];

  return (
    <ReactFlowProvider>
      <AppShell
        commands={commands}
        harnessName={harnessMeta.name}
        onHarnessNameChange={(name) => setHarnessMeta({ name })}
        mode={executionMode}
        running={isRunning}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        selectedId={selectedNodeId}
        backendOk={false}
        toolbar={
          <Toolbar
            onRun={actions.run}
            onStop={actions.stop}
          />
        }
        left={<NodePalette />}
        stage={<HarnessCanvas />}
        right={<PropertiesPanel />}
      />
    </ReactFlowProvider>
  );
}
