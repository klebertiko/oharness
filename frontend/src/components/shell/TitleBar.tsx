"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Mark } from "./Mark";
import { useShellStore } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";
import { KbdChord } from "@/components/ui";

/**
 * Window chrome.
 *
 * The app ships with native decorations OFF (see docs/adr/0001), so this bar
 * *is* the window's title bar — not a picture of one. It owns the drag region,
 * the window buttons on Windows/Linux, and a 68px inset on macOS where the
 * system draws its own traffic lights over our surface.
 *
 * Document context stays separate from command search. Browser previews omit
 * native window actions; the desktop shell retains its actual window controls.
 */

interface Props {
  harnessName: string;
  onHarnessNameChange: (v: string) => void;
  mode: string;
  /** Names where the person is ("Chats", "Providers"). Defaults to the mode. */
  destination?: string;
  running: boolean;
  nodeCount: number;
  editingHarness?: boolean;
  onOpenPalette: () => void;
}

function useTauriWindow() {
  const [w, setW] = useState<Record<string, () => void> | null>(null);
  useEffect(() => {
    const g = window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => unknown } } };
    if (!g.__TAURI__?.window?.getCurrentWindow) return;
    setW(g.__TAURI__.window.getCurrentWindow() as Record<string, () => void>);
  }, []);
  return w;
}

function WindowButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        "grid h-titlebar w-11 place-items-center text-ink-mute transition-colors",
        danger ? "hover:bg-fault hover:text-signal-ink" : "hover:bg-sub-300 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  harnessName,
  onHarnessNameChange,
  mode,
  destination,
  running,
  nodeCount,
  editingHarness,
  onOpenPalette,
}: Props) {
  const mac = useIsMac();
  const win = useTauriWindow();
  const { paletteOpen, leftWidth, hydrated } = useShellStore();
  const caps = chordCaps("Mod+K", mac);

  return (
    <header
      data-tauri-drag-region
      className="oh-header relative z-30 flex h-titlebar flex-none items-stretch border-b border-line-soft bg-sub-100 text-ink-dim"
    >
      {mac && win && <div className="w-17 flex-none" aria-hidden />}

      <div
        data-tauri-drag-region
        style={{ width: hydrated ? leftWidth : undefined }}
        className="oh-header-brand flex min-w-0 flex-none items-center gap-2.5 px-4"
      >
        <Mark />
        <span className="oh-wordmark t-title select-none text-ink">
          OHarness
        </span>
      </div>

      <div data-tauri-drag-region className="oh-header-context flex min-w-0 flex-1 items-center gap-3 px-4">
        <span className="oh-header-mode t-body shrink-0 text-ink-mute">{destination ?? (mode === "Studio" ? "Harness Studio" : mode)}</span>
        {/* Name a draft in the editor, including before its first node. */}
        {mode === "Studio" && (editingHarness ?? (nodeCount > 0)) && (
          <>
            <span className="text-ink-mute" aria-hidden>/</span>
            <input
              value={harnessName}
              onChange={(e) => onHarnessNameChange(e.target.value)}
              spellCheck={false}
              aria-label="Harness name"
              title="Rename this harness"
              className="oh-header-name t-title h-control-md w-full min-w-0 max-w-[240px] rounded-control border border-line-strong bg-sub-100 px-2 text-ink transition-colors hover:bg-sub-200 focus-visible:border-signal"
            />
          </>
        )}
        {running && <span role="status" className="t-body shrink-0 text-ink-mute">Working…</span>}
      </div>

      <div data-tauri-drag-region className="flex flex-none items-center px-3">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          aria-label="Search and commands"
          title={`Search and commands (${caps.join("+")})`}
          className="oh-focus-inner flex h-control-lg items-center gap-2 rounded-control px-2 text-ink-mute transition-colors hover:bg-sub-200 hover:text-ink"
        >
          <Search size={15} aria-hidden="true" />
          <span className="oh-header-search-label t-body">Search</span>
          <span aria-hidden="true" className="oh-header-shortcut pl-2">
            <KbdChord caps={caps} />
          </span>
        </button>
      </div>

      {/* ── Window controls ─────────────────────────────────────────────── */}
      {!mac && win && (
        <div className="flex flex-none items-stretch border-l border-line">
          <WindowButton label="Minimise" onClick={() => win?.minimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </WindowButton>
          <WindowButton label="Maximise" onClick={() => win?.toggleMaximize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
            </svg>
          </WindowButton>
          <WindowButton label="Close" danger onClick={() => win?.close?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </WindowButton>
        </div>
      )}
    </header>
  );
}
