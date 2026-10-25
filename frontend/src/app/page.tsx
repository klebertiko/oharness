"use client";
import { useEffect, useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Square,
  Save,
  Download,
  Upload,
  Undo2,
  Redo2,
  Trash2,
  PanelLeft,
  PanelRight,
  Keyboard,
  Shuffle,
  LayoutTemplate,
  Sparkles,
  Network,
} from "lucide-react";

import { StudioOverview } from "@/components/studio/StudioOverview";
import { StudioActionsBar } from "@/components/studio/StudioActionsBar";
import { newStudioHarness, openStudioPreset } from "@/lib/studio";
import { BUNDLED_HARNESS_COMMAND_GROUP } from "@/lib/studioExamples";
import { hasStudioDraft, startAutosave } from "@/lib/studioDocuments";
import { Button, EmptyState } from "@/components/ui";
import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/shell/Panel";
import { useShellStore } from "@/components/shell/shellStore";
import type { Command } from "@/components/shell/commands";
import { apiUrl } from "@/lib/apiBase";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { NodePalette } from "@/components/sidebar/NodePalette";
import { StudioSidePanel } from "@/components/copilot/StudioSidePanel";
import { useCopilotStore } from "@/store/copilotStore";
import { HarnessCanvas } from "@/components/canvas/HarnessCanvas";
import { ARRANGE_CHORD } from "@/components/canvas/CanvasDock";
import { ValidateDock } from "@/components/studio/ValidateDock";
import { AgentStage } from "@/components/agent/AgentStage";
import { ThreadsSidebar } from "@/components/agent/ThreadsSidebar";
import { PROVIDERS_PANEL_TITLE } from "@/components/providers/copy";
import { ProvidersList } from "@/components/providers/ProvidersList";
import { Dossier } from "@/components/providers/Dossier";
import { useProviderStore } from "@/components/providers/providerStore";

import { useCanvasStore } from "@/store/canvasStore";
import { useModeStore } from "@/store/modeStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { useHarnessActions } from "@/lib/actions";
import { NODE_TEMPLATES, HARNESS_PRESETS } from "@/lib/templates";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import type { ExecutionMode, HarnessNode, NodeType } from "@/lib/types";

const MODE_ORDER: ExecutionMode[] = ["mock", "live", "local"];

export default function Home() {
  const {
    nodes,
    edges,
    selectedNodeId,
    executionMode,
    isRunning,
    harnessMeta,
    setSelectedNode,
    setExecutionMode,
    setHarnessMeta,
    setRunning,
    addNode,
    deleteSelected,
    undo,
    redo,
    arrangeGraph,
  } = useCanvasStore();

  const setMode = useModeStore((s) => s.setMode);
  const actions = useHarnessActions();
  const { section, studioView, toggleLeft, toggleRight, setKeymapOpen, setPaletteOpen, setSection, setStudioView } =
    useShellStore();
  const connectionCount = useProviderStore((s) => s.connections.length);
  const [backendOk, setBackendOk] = useState(false);
  const isStudio = section === "studio";
  const copilotOpen = useCopilotStore((s) => s.open);
  const openCopilot = useCopilotStore((s) => s.openCopilot);

  // `section` is the single source of truth for what's on screen; keep the
  // legacy modeStore in step so TitleBar and canvas hooks stay coherent.
  useEffect(() => {
    setMode(isStudio ? "studio" : "agent");
  }, [isStudio, setMode]);

  // Every edited harness is saved to the local engine as the person works.
  useEffect(() => startAutosave(), []);

  /* Deep link: /?preset=critic-gate opens a named preset on load. Useful for
     docs links and for handing someone a reproducible starting graph. */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("preset");
    if (!id) return;
    const p = HARNESS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    openStudioPreset(p);
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch(apiUrl("/health"), { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && setBackendOk(Boolean(d.status === "ok" || d.ok)))
        .catch(() => alive && setBackendOk(false));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const loadPreset = (p: (typeof HARNESS_PRESETS)[number]) => {
    openStudioPreset(p);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions are stable references; the palette rebuilds only on the state it displays
  const commands = useMemo<Command[]>(() => {
    const insert: Command[] = NODE_TEMPLATES.map((t) => ({
      id: `insert:${t.type}`,
      label: `Add ${t.label}`,
      group: "Insert node",
      icon: ROLE_ICON[t.type as NodeType],
      meta: t.type,
      role: ROLE_VAR[t.type as NodeType],
      keywords: t.description,
      run: () => {
        const node: HarnessNode = {
          id: `${t.type}-${Date.now()}`,
          type: t.type,
          position: { x: 160 + nodes.length * 28, y: 120 + (nodes.length % 5) * 46 },
          data: { ...t.defaultData } as HarnessNode["data"],
        };
        if (!hasStudioDraft(useCanvasStore.getState())) newStudioHarness();
        setSection("studio");
        setStudioView("editor");
        addNode(node);
        setSelectedNode(node.id);
      },
    }));

    const presets: Command[] = HARNESS_PRESETS.map((p) => ({
      id: `preset:${p.id}`,
      label: p.name,
      group: BUNDLED_HARNESS_COMMAND_GROUP,
      disabled: isRunning,
      icon: LayoutTemplate,
      meta: p.id,
      keywords: p.description,
      run: () => loadPreset(p),
    }));

    // Run/File/Edit/insert/preset commands all act on the canvas graph — on
    // any other destination they're not just idle, they're a wall of actions
    // with nothing to act on, which is what made the palette feel like it
    // dumped "everything" regardless of what screen you were looking at.
    const studioOnly: Command[] = !isStudio
      ? []
      : [
          {
            id: "run",
            label: "Run harness",
            group: "Run",
            icon: Play,
            chord: "Mod+Enter",
            meta: executionMode,
            disabled: isRunning || nodes.length === 0,
            run: actions.run,
          },
          {
            id: "stop",
            label: "Stop run",
            group: "Run",
            icon: Square,
            disabled: !isRunning,
            run: () => {
              void useActiveRunStore.getState().requestStop().then((sent) => {
                if (!sent) setRunning(false);
              });
            },
          },
          {
            id: "mode",
            label: "Cycle execution mode",
            group: "Run",
            icon: Shuffle,
            chord: "Mod+Shift+M",
            meta: executionMode,
            run: () =>
              setExecutionMode(MODE_ORDER[(MODE_ORDER.indexOf(executionMode) + 1) % MODE_ORDER.length]),
          },
          {
            id: "save",
            label: "Save harness",
            group: "File",
            icon: Save,
            chord: "Mod+S",
            run: actions.save,
          },
          {
            id: "export",
            label: "Export graph JSON (advanced)",
            group: "File",
            icon: Download,
            chord: "Mod+Shift+E",
            run: actions.exportJson,
          },
          {
            id: "import",
            label: "Import graph JSON (advanced)",
            group: "File",
            icon: Upload,
            run: actions.importJson,
          },
          {
            id: "copilot",
            label: "Ask Nilo",
            group: "Studio",
            icon: Sparkles,
            chord: "Mod+I",
            keywords: "assistant ai build graph",
            disabled: studioView !== "editor",
            run: openCopilot,
          },
          {
            id: "arrange",
            label: "Auto-arrange graph",
            group: "Edit",
            icon: Network,
            chord: ARRANGE_CHORD,
            keywords: "layout tidy organize organizar layers align clean up",
            disabled: studioView !== "editor" || isRunning || nodes.length < 2,
            run: arrangeGraph,
          },
          { id: "undo", label: "Undo", group: "Edit", icon: Undo2, chord: "Mod+Z", run: undo },
          { id: "redo", label: "Redo", group: "Edit", icon: Redo2, chord: "Mod+Shift+Z", run: redo },
          {
            id: "delete",
            label: "Delete selected node",
            group: "Edit",
            icon: Trash2,
            meta: selectedNodeId ?? undefined,
            disabled: !selectedNodeId,
            run: deleteSelected,
          },
          ...presets,
          ...insert,
          {
            id: "toggle-right",
            label: "Toggle inspector",
            group: "View",
            icon: PanelRight,
            chord: "Mod+Alt+B",
            run: toggleRight,
          },
        ];

    return [
      ...studioOnly,
      {
        id: "toggle-left",
        label: "Toggle left panel",
        group: "View",
        icon: PanelLeft,
        chord: "Mod+B",
        run: toggleLeft,
      },
      {
        id: "keymap",
        label: "Show keyboard map",
        group: "View",
        icon: Keyboard,
        run: () => setKeymapOpen(true),
      },
    ];
  }, [nodes.length, executionMode, isRunning, selectedNodeId, actions, isStudio, studioView, openCopilot]);

  const providersLeft = (
    <Panel title={PROVIDERS_PANEL_TITLE} meta={`${connectionCount}`} className="h-full">
      <ProvidersList />
    </Panel>
  );

  // The contextual left panel. Destinations that own the whole stage don't
  // get one.
  const left =
    section === "providers"
      ? providersLeft
      : section === "studio"
        ? (studioView === "editor" ? <NodePalette /> : null)
        : section === "chats"
          ? <ThreadsSidebar />
          : null;

  const studioStage = studioView === "overview" ? <StudioOverview /> : (
    <div className="flex h-full min-h-0 flex-col">
      <StudioActionsBar />
      <div className="relative min-h-0 flex-1">
        <HarnessCanvas onNodeClick={(id) => setSelectedNode(id)} />
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-4 flex items-center justify-center">
            <EmptyState
              className="pointer-events-auto max-w-[320px] bg-sub-100"
              title="This canvas is empty"
              action={
                // The Blocks list is a side panel; on a phone it is hidden, and the palette lists every block.
                <Button className="sm:hidden" onClick={() => setPaletteOpen(true)}>
                  Add a block
                </Button>
              }
            >
              Add a block from the Blocks list, or use Import .ohm in the bundle bar below.
            </EmptyState>
          </div>
        )}
      </div>
      <ValidateDock />
    </div>
  );

  const stage =
    section === "providers" ? (
      <Dossier />
    ) : isStudio ? (
      studioStage
    ) : (
      <AgentStage />
    );

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
        backendOk={backendOk}
        immersive={isStudio && studioView === "overview"}
        toolbar={
          isStudio && studioView === "editor" ? (
            <Toolbar
              onRun={actions.run}
              onStop={actions.stop}
            />
          ) : null
        }
        left={left}
        stage={stage}
        right={isStudio && studioView === "editor" && (selectedNodeId || copilotOpen) ? <StudioSidePanel /> : null}
        onDismissRight={() => {
          setSelectedNode(null);
          useCopilotStore.getState().close();
        }}
      />
    </ReactFlowProvider>
  );
}
