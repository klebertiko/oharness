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
  Languages,
} from "lucide-react";

import { LOCALES, LOCALE_NAME } from "@/i18n/locale";
import { tr, useLocaleStore } from "@/i18n/store";
import { StudioOverview } from "@/components/studio/StudioOverview";
import { StudioActionsBar } from "@/components/studio/StudioActionsBar";
import { newStudioHarness, openStudioPreset } from "@/lib/studio";
import { BUNDLED_HARNESS_COMMAND_GROUP } from "@/lib/studioExamples";
import { hasStudioDraft, startAutosave } from "@/lib/studioDocuments";
import { Button, EmptyState } from "@/components/ui";
import { AppShell } from "@/components/shell/AppShell";
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
import { ProvidersScreen } from "@/components/providers/ProvidersScreen";

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

  const locale = useLocaleStore((s) => s.locale);
  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions are stable references; the palette rebuilds only on the state it displays
  const commands = useMemo<Command[]>(() => {
    const insert: Command[] = NODE_TEMPLATES.map((t) => ({
      id: `insert:${t.type}`,
      label: tr("shell.cmd.add", { label: t.label }),
      group: tr("shell.cmd.group.insert"),
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
            label: tr("shell.cmd.run"),
            group: tr("shell.cmd.group.run"),
            icon: Play,
            chord: "Mod+Enter",
            meta: executionMode,
            disabled: isRunning || nodes.length === 0,
            run: actions.run,
          },
          {
            id: "stop",
            label: tr("shell.cmd.stop"),
            group: tr("shell.cmd.group.run"),
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
            label: tr("shell.cmd.cycleMode"),
            group: tr("shell.cmd.group.run"),
            icon: Shuffle,
            chord: "Mod+Shift+M",
            meta: executionMode,
            run: () =>
              setExecutionMode(MODE_ORDER[(MODE_ORDER.indexOf(executionMode) + 1) % MODE_ORDER.length]),
          },
          {
            id: "save",
            label: tr("shell.cmd.save"),
            group: tr("shell.cmd.group.file"),
            icon: Save,
            chord: "Mod+S",
            run: actions.save,
          },
          {
            id: "export",
            label: tr("shell.cmd.export"),
            group: tr("shell.cmd.group.file"),
            icon: Download,
            chord: "Mod+Shift+E",
            run: actions.exportJson,
          },
          {
            id: "import",
            label: tr("shell.cmd.import"),
            group: tr("shell.cmd.group.file"),
            icon: Upload,
            run: actions.importJson,
          },
          {
            id: "copilot",
            label: tr("shell.cmd.askNilo"),
            group: tr("shell.cmd.group.studio"),
            icon: Sparkles,
            chord: "Mod+I",
            keywords: "assistant ai build graph",
            disabled: studioView !== "editor",
            run: openCopilot,
          },
          {
            id: "arrange",
            label: tr("shell.cmd.arrange"),
            group: tr("shell.cmd.group.edit"),
            icon: Network,
            chord: ARRANGE_CHORD,
            keywords: "layout tidy organize organizar layers align clean up",
            disabled: studioView !== "editor" || isRunning || nodes.length < 2,
            run: arrangeGraph,
          },
          { id: "undo", label: tr("shell.cmd.undo"), group: tr("shell.cmd.group.edit"), icon: Undo2, chord: "Mod+Z", run: undo },
          { id: "redo", label: tr("shell.cmd.redo"), group: tr("shell.cmd.group.edit"), icon: Redo2, chord: "Mod+Shift+Z", run: redo },
          {
            id: "delete",
            label: tr("shell.cmd.delete"),
            group: tr("shell.cmd.group.edit"),
            icon: Trash2,
            meta: selectedNodeId ?? undefined,
            disabled: !selectedNodeId,
            run: deleteSelected,
          },
          ...presets,
          ...insert,
          {
            id: "toggle-right",
            label: tr("shell.cmd.toggleInspector"),
            group: tr("shell.cmd.group.view"),
            icon: PanelRight,
            chord: "Mod+Alt+B",
            run: toggleRight,
          },
        ];

    const languages: Command[] = LOCALES.filter((l) => l !== locale).map((l) => ({
      id: `language:${l}`,
      label: tr("shell.cmd.language", { name: LOCALE_NAME[l] }),
      group: tr("shell.cmd.group.view"),
      icon: Languages,
      run: () => useLocaleStore.getState().setLocale(l),
    }));

    return [
      ...studioOnly,
      ...languages,
      {
        id: "toggle-left",
        label: tr("shell.cmd.toggleLeft"),
        group: tr("shell.cmd.group.view"),
        icon: PanelLeft,
        chord: "Mod+B",
        run: toggleLeft,
      },
      {
        id: "keymap",
        label: tr("shell.cmd.showKeymap"),
        group: tr("shell.cmd.group.view"),
        icon: Keyboard,
        run: () => setKeymapOpen(true),
      },
    ];
  }, [locale, nodes.length, executionMode, isRunning, selectedNodeId, actions, isStudio, studioView, openCopilot]);

  // The contextual left panel. Destinations that own the whole stage don't
  // get one.
  const left =
    section === "providers"
      ? null
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
      <ProvidersScreen />
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
