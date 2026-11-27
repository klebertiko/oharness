"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsModal } from "./ShortcutsModal";
import { HarnessLibrarySheet } from "./HarnessLibrarySheet";
import { Resizer } from "./Resizer";
import { useShellStore, type RailSection } from "./shellStore";
import { isEditingTarget, isTypeaheadTarget, matchesChord, chordCaps, useIsMac } from "./keys";
import { shellNavCommands, startSession, type Command } from "./commands";
import { cycleRegion } from "./regions";
import { hydrateShortcuts, useShortcutStore } from "./shortcuts";
import {
  DOCK_MAX,
  DOCK_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_OPEN,
  SIDEBAR_RAIL,
  dockBox,
  flowWidth,
  showsDrawer,
  showsPeek,
  type SidebarMode,
} from "./frame";
import { DockHost } from "@/components/dock/DockHost";
import { useModeStore } from "@/store/modeStore";
import { useProviderStore } from "@/components/providers/providerStore";
import { useLocaleStore, useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";

const DESTINATION: Record<RailSection, MessageKey> = {
  chats: "shell.rail.chats",
  forja: "shell.rail.forja",
  studio: "shell.title.studio",
  plugins: "shell.nav.plugins",
  providers: "shell.rail.providers",
  settings: "shell.nav.settings",
};

function sidebarCopy(mode: SidebarMode, viewport: number, drawerOpen: boolean): MessageKey {
  if (viewport < 768) return drawerOpen ? "shell.sidebar.hide" : "shell.sidebar.show";
  if (viewport <= 1024) return mode === "hidden" ? "shell.sidebar.show" : "shell.sidebar.hide";
  if (mode === "open") return "shell.sidebar.collapse";
  if (mode === "rail") return "shell.sidebar.hide";
  return "shell.sidebar.show";
}

interface Props {
  commands: Command[];
  harnessName: string;
  onHarnessNameChange: (v: string) => void;
  mode: string;
  running: boolean;
  nodeCount: number;
  edgeCount: number;
  selectedId: string | null;
  backendOk: boolean;
  immersive?: boolean;
  toolbar: React.ReactNode;
  left: React.ReactNode;
  stage: React.ReactNode;
  right: React.ReactNode;
  /** Closes the right panel's content. */
  onDismissRight?: () => void;
  breadcrumb?: string;
}

export function AppShell({
  commands,
  harnessName,
  onHarnessNameChange,
  running,
  nodeCount,
  immersive = false,
  toolbar,
  stage,
  right,
  breadcrumb,
}: Props) {
  const mac = useIsMac();
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const shell = useShellStore();
  const bindings = useShortcutStore((s) => s.bindings);
  const shellMode = useModeStore((s) => s.mode);
  const hydrateProviders = useProviderStore((s) => s.hydrate);
  const [viewport, setViewport] = useState(1280);
  const [ready, setReady] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Hydration runs once, deliberately
  useEffect(() => {
    shell.hydrate();
    hydrateShortcuts();
    useLocaleStore.getState().hydrate();
    void hydrateProviders();
    const measure = () => setViewport(window.innerWidth);
    measure();
    setReady(true);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const {
    sidebar,
    sidebarWidth,
    dockOpen,
    dockSuppressed,
    dockWidth,
    drawerOpen,
    paletteOpen,
    keymapOpen,
    toggleLeft,
    toggleRight,
    resizeSidebar,
    resizeDock,
    resetSidebarWidth,
    resetDockWidth,
    setPaletteOpen,
    setKeymapOpen,
    setDrawerOpen,
    dismissOverlays,
  } = shell;

  const flow = ready ? flowWidth(sidebar, viewport, sidebarWidth) : null;
  const drawer = ready && showsDrawer(viewport);
  const peekable = ready && showsPeek(sidebar, viewport);
  const wantsDock = !immersive && dockOpen && !dockSuppressed;
  const dock = dockBox(viewport, flow ?? SIDEBAR_OPEN, wantsDock, dockWidth);
  // An empty dock must not cover the stage. A column can sit beside it; a sheet only when it has content.
  const showDock = dock.kind === "column" || (dock.kind === "overlay" && Boolean(right));
  const sideLabel = t(sidebarCopy(sidebar, ready ? viewport : 1280, drawerOpen));

  const allCommands = useMemo(() => [...shellNavCommands(), ...commands], [commands, locale, bindings]);
  const commandsRef = useRef(allCommands);
  commandsRef.current = allCommands;

  useEffect(() => {
    if (!drawerOpen) return;
    // What had focus when the drawer opened gets it back when it closes (a modal drawer must not drop focus to <body>).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("oh-sidebar");
    const items = () =>
      [...(root?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      const lost = !document.activeElement || document.activeElement === document.body || root?.contains(document.activeElement);
      if (opener?.isConnected && opener !== document.body && lost) opener.focus();
    };
  }, [drawerOpen]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const editing = isEditingTarget(e.target);
      const typing = editing || isTypeaheadTarget(e.target);

      if (matchesChord(e, "Mod+K", mac)) {
        e.preventDefault();
        setPaletteOpen(!useShellStore.getState().paletteOpen);
        return;
      }
      if (matchesChord(e, "Mod+/", mac)) {
        e.preventDefault();
        setKeymapOpen(true);
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        cycleRegion(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "Escape") {
        if (useShellStore.getState().drawerOpen) {
          e.preventDefault();
          setDrawerOpen(false);
          return;
        }
        dismissOverlays();
        return;
      }
      if (useShellStore.getState().paletteOpen || useShellStore.getState().keymapOpen || useShellStore.getState().libraryOpen) return;

      for (const c of commandsRef.current) {
        if (typing && c.chord && !/Mod|Alt/.test(c.chord)) continue;
        if (c.chord && !c.disabled && matchesChord(e, c.chord, mac)) {
          e.preventDefault();
          c.run();
          return;
        }
      }
    },
    [mac, setPaletteOpen, setKeymapOpen, setDrawerOpen, dismissOverlays],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  const sidebarNode = <Sidebar variant={drawer ? "drawer" : flow === SIDEBAR_RAIL || peekable ? "rail" : "open"} />;

  return (
    <div className="oh-shell flex h-screen flex-col overflow-hidden" data-shell-mode={shellMode} data-sidebar={drawer ? "drawer" : sidebar} data-dock={dock.kind} data-vw={viewport} data-side={flow ?? -1}>
      {/* biome-ignore lint/a11y/useValidAnchor: a real in-page link; the handler only moves focus into the main region as well as scrolling to it */}
      <a
        href="#oh-main"
        className="t-body fixed left-2 top-2 z-60 translate-y-[-200%] rounded-control border border-line-strong bg-sub-100 px-3 py-2 text-ink focus:translate-y-0"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("oh-main")?.focus();
        }}
      >
        Skip to main content
      </a>
      <TitleBar
        harnessName={harnessName}
        onHarnessNameChange={onHarnessNameChange}
        mode={shellMode === "agent" ? "Agent" : "Studio"}
        destination={t(DESTINATION[shell.section])}
        running={running}
        nodeCount={nodeCount}
        editingHarness={shellMode === "studio" && shell.studioView === "editor"}
        onOpenPalette={() => setPaletteOpen(true)}
        railCollapsed={flow === SIDEBAR_RAIL}
        sidebarLabel={sideLabel}
        sidebarTooltip={t("shell.sidebar.tooltip", { action: sideLabel, keys: chordCaps("Mod+B", mac).join("+") })}
        onToggleSidebar={toggleLeft}
        onNewSession={startSession}
        clusterWidth={flow === null ? undefined : flow === 0 ? "auto" : flow}
        breadcrumb={breadcrumb}
      />

      {toolbar}

      <div className="relative flex min-h-0 flex-1">
        {!drawer && (
          <div
            className="oh-peek-host relative h-full flex-none"
            style={{ width: flow === null ? "var(--oh-side-w, 280px)" : flow }}
          >
            <div
              id="oh-sidebar"
              role="region"
              aria-label={t("shell.regions.sidebar")}
              tabIndex={-1}
              data-mode={sidebar}
              className={`oh-side relative flex h-full min-w-0 flex-col overflow-hidden bg-sub-100 outline-hidden ${flow === 0 ? "" : "border-r border-line"}`}
              style={{
                width: flow === null ? "var(--oh-side-w, 280px)" : flow,
                minWidth: 0,
                transition: "width var(--duration-base) var(--ease-standard)",
              }}
            >
              {flow !== 0 && sidebarNode}
              {flow !== null && flow > SIDEBAR_RAIL && (
                <Resizer
                  side="left"
                  value={sidebarWidth}
                  min={SIDEBAR_MIN}
                  max={SIDEBAR_MAX}
                  label={t("shell.resize.nav")}
                  onChange={resizeSidebar}
                  onReset={resetSidebarWidth}
                />
              )}
            </div>
            {peekable && (
              <div
                className="oh-peek absolute top-0 z-40 h-full flex-col overflow-hidden border-r border-line bg-sub-100 shadow-(--shadow-float)"
                style={{ left: SIDEBAR_RAIL, width: SIDEBAR_OPEN }}
              >
                <Sidebar variant="open" />
              </div>
            )}
          </div>
        )}

        <main id="oh-main" tabIndex={-1} className="relative min-w-0 flex-1 bg-sub-000 outline-hidden">
          {stage}
        </main>

        {showDock && dock.kind === "overlay" && (
          <aside
            id="oh-dock"
            aria-label={t("shell.dock.label")}
            tabIndex={-1}
            className="fixed bottom-0 right-0 z-40 flex flex-col border-l border-line bg-sub-100 shadow-(--shadow-float) outline-hidden"
            style={{ top: "var(--h-titlebar)", width: dock.width }}
          >
            <DockHost onClose={toggleRight}>{right}</DockHost>
          </aside>
        )}

        {showDock && dock.kind === "column" && (
          <aside
            id="oh-dock"
            aria-label={t("shell.dock.label")}
            tabIndex={-1}
            className="oh-dock-col relative flex min-h-0 flex-none flex-col border-l border-line bg-sub-100 outline-hidden"
            style={{ width: dock.width, minWidth: 0, transition: "width var(--duration-base) var(--ease-standard)" }}
          >
            <Resizer
              side="right"
              value={dock.width}
              min={DOCK_MIN}
              max={DOCK_MAX}
              label={t("shell.resize.dock")}
              onChange={resizeDock}
              onReset={resetDockWidth}
            />
            <DockHost onClose={toggleRight}>{right}</DockHost>
          </aside>
        )}

      </div>

      {drawer && drawerOpen && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-(--overlay-backdrop)" aria-label={t("shell.sidebar.hide")} onClick={() => setDrawerOpen(false)} />
          <div
            id="oh-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.regions.sidebar")}
            className="fixed bottom-0 left-0 z-50 flex flex-col border-r border-line bg-sub-100 shadow-(--shadow-float)"
            style={{ top: "var(--h-titlebar)", width: `min(${SIDEBAR_OPEN}px, calc(100vw - 48px))` }}
          >
            {sidebarNode}
          </div>
        </>
      )}

      <CommandPalette open={paletteOpen} commands={allCommands} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={keymapOpen} commands={allCommands} onClose={() => setKeymapOpen(false)} />
      <HarnessLibrarySheet />
    </div>
  );
}
