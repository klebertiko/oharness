"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { ActivityRail } from "./ActivityRail";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { KeymapSheet } from "./KeymapSheet";
import { HarnessLibrarySheet } from "./HarnessLibrarySheet";
import { useShellStore, LEFT_MIN, LEFT_MAX, RIGHT_MIN, RIGHT_MAX, type RailSection } from "./shellStore";
import { isEditingTarget, isTypeaheadTarget, matchesChord, useIsMac } from "./keys";
import { Sheet } from "@/components/ui";
import { shellNavCommands, type Command } from "./commands";
import { useModeStore } from "@/store/modeStore";
import { useProviderStore } from "@/components/providers/providerStore";
import { useLocaleStore } from "@/i18n/store";

/**
 * Split handle. 5px hit area over a 1px visual rule — the standard trick, but
 * the rule only takes on signal while actually dragging, so a pointer sweeping
 * across the window does not light the frame up like a christmas tree.
 * Arrow keys move it 16px at a time, because a mouse-only resize is a resize
 * some people cannot perform.
 */
function Resizer({
  side,
  value,
  min,
  max,
  onChange,
}: {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const dragging = useRef(false);
  const el = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    el.current?.setAttribute("data-dragging", "true");
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    onChange(side === "left" ? e.clientX - rect.left : rect.right - e.clientX);
  };
  const end = () => {
    dragging.current = false;
    el.current?.removeAttribute("data-dragging");
  };

  return (
    <div
      ref={el}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize navigation panel" : "Resize inspector"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (side === "left" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (side === "left" ? step : -step));
        }
      }}
      className={`group absolute inset-y-0 z-10 w-[5px] cursor-col-resize bg-transparent ${side === "left" ? "right-[-3px]" : "left-[-3px]"}`}
    >
      <span className="pointer-events-none absolute inset-y-0 left-[2px] w-px bg-transparent transition-colors group-hover:bg-line-strong group-data-dragging:bg-signal" />
    </div>
  );
}

/** What the header calls each destination. */
const DESTINATION: Record<RailSection, string> = {
  chats: "Chats",
  studio: "Harness Studio",
  providers: "Providers",
};

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
  /** Closes the right panel's content. Below 1020px the panel is a sheet and this is what dismissing it does. */
  onDismissRight?: () => void;
}

export function AppShell({
  commands,
  harnessName,
  onHarnessNameChange,
  mode,
  running,
  nodeCount,
  edgeCount,
  selectedId,
  backendOk,
  immersive = false,
  toolbar,
  left,
  stage,
  right,
  onDismissRight,
}: Props) {
  const mac = useIsMac();
  const shell = useShellStore();
  const shellMode = useModeStore((s) => s.mode);
  const hydrateProviders = useProviderStore((s) => s.hydrate);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Hydration runs once, deliberately
  useEffect(() => {
    shell.hydrate();
    useLocaleStore.getState().hydrate();
    void hydrateProviders();
  }, []);

  /* Narrow-window policy. A stated preference is never overwritten — the
     panels are *suppressed* while the window is too small to hold them and
     come back at full width, so resizing a window never silently loses the
     layout someone chose. */
  const [narrow, setNarrow] = useState<{ right: boolean; left: boolean }>({
    right: false,
    left: false,
  });
  useEffect(() => {
    const measure = () =>
      setNarrow({ right: window.innerWidth < 1020, left: window.innerWidth < 640 });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const {
    hydrated,
    leftOpen: leftPref,
    rightOpen: rightPref,
    leftWidth,
    rightWidth,
    paletteOpen,
    keymapOpen,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    setPaletteOpen,
    setKeymapOpen,
    setSection,
    dismissOverlays,
  } = shell;

  const leftOpen = leftPref && !narrow.left;
  const rightOpen = rightPref && !narrow.right;

  const allCommands = useMemo(() => [...shellNavCommands(), ...commands], [commands]);

  const commandsRef = useRef(allCommands);
  commandsRef.current = allCommands;

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const editing = isEditingTarget(e.target);
      const typing = editing || isTypeaheadTarget(e.target);

      // Overlay-owning chords first: the palette must open from anywhere,
      // including from inside the harness-name field.
      if (matchesChord(e, "Mod+K", mac)) {
        e.preventDefault();
        setPaletteOpen(!useShellStore.getState().paletteOpen);
        return;
      }
      if (e.key === "Escape") {
        dismissOverlays();
        return;
      }
      if (useShellStore.getState().paletteOpen || useShellStore.getState().keymapOpen || useShellStore.getState().libraryOpen) return;

      if (!editing && e.key === "?") {
        e.preventDefault();
        setKeymapOpen(true);
        return;
      }
      if (matchesChord(e, "Mod+B", mac)) {
        e.preventDefault();
        toggleLeft();
        return;
      }
      if (matchesChord(e, "Mod+Alt+B", mac)) {
        e.preventDefault();
        toggleRight();
        return;
      }
      // Alt+1..3 — the destinations, same order as the rail, everywhere.
      const NAV_CHORDS: [string, RailSection][] = [
        ["Alt+1", "chats"],
        ["Alt+2", "studio"],
        ["Alt+3", "providers"],
      ];
      for (const [chord, target] of NAV_CHORDS) {
        if (matchesChord(e, chord, mac)) {
          e.preventDefault();
          setSection(target);
          return;
        }
      }
      for (const c of commandsRef.current) {
        // A bare (or Shift-only) chord is a letter someone may be typing, in a
        // field or in a typeahead widget (Select, menu, listbox, combobox).
        if (typing && c.chord && !/Mod|Alt/.test(c.chord)) continue;
        if (c.chord && !c.disabled && matchesChord(e, c.chord, mac)) {
          e.preventDefault();
          c.run();
          return;
        }
      }
    },
    [
      mac,
      setPaletteOpen,
      setKeymapOpen,
      toggleLeft,
      toggleRight,
      setSection,

      dismissOverlays,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <div
      className="oh-shell flex h-screen flex-col overflow-hidden"
      data-shell-mode={shellMode}
    >
      {/* First tab stop: lets a keyboard user skip the header and rail. */}
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
        destination={DESTINATION[shell.section]}
        running={running}
        nodeCount={nodeCount}
        editingHarness={shellMode === "studio" && shell.studioView === "editor"}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {toolbar}

      <div className="flex min-h-0 flex-1">
        <ActivityRail
          collapsed={narrow.left}
          edge={!narrow.left ? <Resizer side="left" value={leftWidth} min={LEFT_MIN} max={LEFT_MAX} onChange={setLeftWidth} /> : null}
        >
          {leftOpen && !immersive ? left : null}
        </ActivityRail>

        <main id="oh-main" tabIndex={-1} className="relative min-w-0 flex-1 bg-sub-000 outline-hidden">{stage}</main>

        {rightOpen && !immersive && right && (
          <aside
            aria-label="Inspector"
            className="relative min-h-0 flex-none border-l border-line"
            style={{ width: hydrated ? rightWidth : undefined, minWidth: RIGHT_MIN }}
          >
            <Resizer side="right" value={rightWidth} min={RIGHT_MIN} max={RIGHT_MAX} onChange={setRightWidth} />
            {right}
          </aside>
        )}
      </div>

      {shellMode === "studio" && shell.studioView === "editor" && (
        <StatusBar
          mode={mode.charAt(0).toUpperCase() + mode.slice(1)}
          running={running}
          nodeCount={nodeCount}
          edgeCount={edgeCount}
          selectedId={selectedId}
          backendOk={backendOk}
        />
      )}

      {/* Too narrow for a column: the same panel opens as a sheet, so a node can
          still be inspected and Nilo still reached on a phone or a small window. */}
      <Sheet
        open={narrow.right && !immersive && Boolean(right) && Boolean(onDismissRight)}
        onOpenChange={(v) => !v && onDismissRight?.()}
        title="Inspector"
        hideTitle
        showClose
        className="h-[min(640px,calc(100dvh-var(--h-titlebar)-20px))] w-[min(520px,calc(100vw-24px))]"
      >
        <div className="min-h-0 flex-1">{right}</div>
      </Sheet>

      <CommandPalette
        open={paletteOpen}
        commands={allCommands}
        onClose={() => setPaletteOpen(false)}
      />
      <KeymapSheet open={keymapOpen} onClose={() => setKeymapOpen(false)} />
      <HarnessLibrarySheet />
    </div>
  );
}
