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
  Shuffle,
  LayoutTemplate,
  Sparkles,
  Network,
  Languages,
} from "lucide-react";

import { LOCALES, LOCALE_NAME } from "@/i18n/locale";
import { tr, useLocaleStore, useT } from "@/i18n/store";
import { StudioOverview } from "@/components/studio/StudioOverview";
import { StudioActionsBar } from "@/components/studio/StudioActionsBar";
import { newStudioHarness, openStudioPreset } from "@/lib/studio";
import { hasStudioDraft, startAutosave } from "@/lib/studioDocuments";
import { Button, EmptyState } from "@/components/ui";
import { AppShell } from "@/components/shell/AppShell";
import { useShellStore } from "@/components/shell/shellStore";
import { startSession, type Command } from "@/components/shell/commands";
import { READING_WIDTH } from "@/components/shell/frame";
import { currentPath, parsePath } from "@/components/shell/routes";
import { apiUrl } from "@/lib/apiBase";

import { Toolbar } from "@/components/toolbar/Toolbar";
import { StudioSidePanel } from "@/components/copilot/StudioSidePanel";
import { useCopilotStore } from "@/store/copilotStore";
import { HarnessCanvas } from "@/components/canvas/HarnessCanvas";
import { ARRANGE_CHORD } from "@/components/canvas/CanvasDock";
import { ValidateDock } from "@/components/studio/ValidateDock";
import { AgentStage } from "@/components/agent/AgentStage";
import { useThreadStore } from "@/store/threadStore";
import { ProvidersScreen } from "@/components/providers/ProvidersScreen";
import { ForjaScreen } from "@/factory/ForjaScreen";

import { useCanvasStore } from "@/store/canvasStore";
import { useModeStore } from "@/store/modeStore";
import { useActiveRunStore } from "@/store/activeRunStore";
import { useHarnessActions } from "@/lib/actions";
import { NODE_TEMPLATES, HARNESS_PRESETS } from "@/lib/templates";
import { ROLE_ICON, ROLE_VAR } from "@/lib/roles";
import type { ExecutionMode, HarnessNode, NodeType } from "@/lib/types";

const MODE_ORDER: ExecutionMode[] = ["mock", "live", "local"];

export function Home({ initialPath }: { initialPath?: string }) {
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

  const t = useT();
  const setMode = useModeStore((s) => s.setMode);
  const actions = useHarnessActions();
  const { studioView, setPaletteOpen, setSection, setStudioView } = useShellStore();
  const section = useShellStore((s) => s.section);
  const [path, setPath] = useState(initialPath ?? "/");
  const threads = useThreadStore((s) => s.threads);
  const [threadsReady, setThreadsReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [backendOk, setBackendOk] = useState(false);
  const isStudio = section === "studio";
  const copilotOpen = useCopilotStore((s) => s.open);
  const openCopilot = useCopilotStore((s) => s.openCopilot);

  const loc = parsePath(path);

  useEffect(() => {
    const boot = window.__OH_PATH__;
    const next = boot && boot !== "/" ? boot : (initialPath ?? window.location.pathname);
    if (boot && boot !== "/" && (window.location.pathname === "/" || window.location.pathname === "/index.html") && window.history.state?.path !== boot) {
      window.history.pushState({ oh: 1, path: boot }, "", boot);
      window.__OH_PATH__ = boot;
    }
    setPath(next || "/");
    useShellStore.getState().applySection(parsePath(next || "/").dest);
    const onNav = () => {
      const current = currentPath();
      setPath(current);
      useShellStore.getState().applySection(parsePath(current).dest);
    };
    window.addEventListener("oh-nav", onNav);
    return () => window.removeEventListener("oh-nav", onNav);
  }, [initialPath]);

  useEffect(() => {
    if (!loc.sessionId) return;
    const id = loc.sessionId;
    const select = () => useThreadStore.getState().selectThread(id);
    if (useThreadStore.persist.hasHydrated()) select();
    else return useThreadStore.persist.onFinishHydration(select);
  }, [loc.sessionId]);

  useEffect(() => {
    setMounted(true);
    if (useThreadStore.persist.hasHydrated()) setThreadsReady(true);
    else return useThreadStore.persist.onFinishHydration(() => setThreadsReady(true));
  }, []);

  // A selected block opens the dock unless the person closed it. Navigation does not.
  useEffect(() => {
    const inspector = isStudio && studioView === "editor" && Boolean(selectedNodeId || copilotOpen);
    if (inspector && !useShellStore.getState().dockSuppressed) useShellStore.getState().setRightOpen(true);
  }, [isStudio, studioView, selectedNodeId, copilotOpen]);

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
      group: tr("studio.group.bundled"),
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
        ];

    const languages: Command[] = LOCALES.filter((l) => l !== locale).map((l) => ({
      id: `language:${l}`,
      label: tr("shell.cmd.language", { name: LOCALE_NAME[l] }),
      group: tr("shell.cmd.group.view"),
      icon: Languages,
      run: () => useLocaleStore.getState().setLocale(l),
    }));

    return [...studioOnly, ...languages];
  }, [locale, nodes.length, executionMode, isRunning, selectedNodeId, actions, isStudio, studioView, openCopilot]);

  const missingSession = mounted && threadsReady && Boolean(loc.sessionId) && !threads.some((thread) => thread.id === loc.sessionId);
  const sessionTitle = mounted ? threads.find((thread) => thread.id === loc.sessionId)?.title : undefined;
  const breadcrumb = sessionTitle || (mounted ? loc.itemId || loc.harness : undefined);

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
                <Button className="md:hidden" onClick={() => setPaletteOpen(true)}>
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

  const chatStage = missingSession ? (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        title={t("shell.sessions.missing")}
        action={<Button onClick={() => startSession()}>{t("shell.sessions.missingAction")}</Button>}
      >
        {t("shell.sessions.hint")}
      </EmptyState>
    </div>
  ) : (
    <div className="mx-auto h-full min-h-0 w-full" style={{ maxWidth: READING_WIDTH }}>
      {mounted ? <AgentStage /> : null}
    </div>
  );

  const stage =
    section === "providers" ? (
      <ProvidersScreen />
    ) : section === "forja" ? (
      <ForjaScreen />
    ) : section === "plugins" ? (
      <div className="mx-auto flex w-full flex-col gap-2 p-6" style={{ maxWidth: READING_WIDTH }}>
        <h1 className="t-title text-ink">{t("shell.plugins.heading")}</h1>
        <p className="text-body text-ink-mute">{t("shell.plugins.body")}</p>
      </div>
    ) : section === "settings" ? (
      <div className="mx-auto flex w-full flex-col gap-2 p-6" style={{ maxWidth: READING_WIDTH }}>
        <h1 className="t-title text-ink">{t("shell.settings.heading")}</h1>
        <p className="text-body text-ink">{loc.section || "general"}</p>
      </div>
    ) : isStudio ? (
      studioStage
    ) : (
      chatStage
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
        left={null}
        breadcrumb={breadcrumb}
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
