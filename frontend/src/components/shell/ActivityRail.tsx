"use client";
import { useEffect, useState } from "react";
import {
  Boxes,
  Keyboard,
  MessagesSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useShellStore, LEFT_MIN, RAIL_COLLAPSED, type RailSection } from "./shellStore";
import { chordCaps, useIsMac } from "./keys";
import { cn } from "@/lib/utils";
import { appliedTheme, applyTheme, type Theme } from "@/lib/theme";

/* Hallmark · design-system: design.md · designed-as-app */
/**
 * One flat set of destinations — no modes, no reshuffling. Every item opens a
 * real place in the main stage. Chords are Alt+1..6, stable everywhere.
 */
type NavItem = { id: RailSection; label: string; icon: LucideIcon; chord: string };

/* Order = how often you reach for it. Everyday work first, then the thing you
   set up once and rarely revisit. */
const NAV: NavItem[] = [
  { id: "chats", label: "Chats", icon: MessagesSquare, chord: "Alt+1" },
  { id: "studio", label: "Studio", icon: Boxes, chord: "Alt+2" },
  { id: "providers", label: "Providers", icon: Plug, chord: "Alt+3" },
];

/** A hairline before the set-up-once group (Providers). Harnesses lives inside
    Studio now — "Open .ohm" opens the library as a sheet, not a destination. */
const DIVIDER_BEFORE: RailSection = "providers";

function RailButton({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${label} · ${hint}` : label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "oh-focus-inner t-title flex h-control-lg w-full items-center gap-3 rounded-float px-3 text-left transition-colors",
        // Where you are: ink-primary and a signal bar. Where the pointer is:
        // one step of substrate. Hover never reads as "chosen".
        active ? "bg-sub-200 text-ink shadow-[inset_2px_0_0_var(--signal)]" : "text-ink-mute hover:bg-sub-200 hover:text-ink",
      )}
    >
      <Icon size={16} strokeWidth={1.8} absoluteStrokeWidth className="flex-none" />
      <span className="oh-rail-label min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

export function ActivityRail({
  children,
  collapsed = false,
  edge,
}: {
  children?: React.ReactNode;
  collapsed?: boolean;
  /** The resize handle, rendered inside the landmark so it is not stray content. */
  edge?: React.ReactNode;
}) {
  const mac = useIsMac();
  const section = useShellStore((s) => s.section);
  const setSection = useShellStore((s) => s.setSection);
  const setKeymapOpen = useShellStore((s) => s.setKeymapOpen);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const leftWidth = useShellStore((s) => s.leftWidth);
  const hydrated = useShellStore((s) => s.hydrated);
  const toggleLeft = useShellStore((s) => s.toggleLeft);

  // theme-init.js has already applied the saved theme before first paint; this
  // only mirrors it so the toggle shows the right icon and label.
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(appliedTheme()), []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <nav
      aria-label="Destinations"
      style={
        collapsed
          ? { width: RAIL_COLLAPSED, minWidth: RAIL_COLLAPSED }
          : { width: hydrated ? leftWidth : undefined, minWidth: LEFT_MIN }
      }
      className="oh-navigation relative flex w-rail flex-none flex-col items-stretch gap-px border-r border-line bg-sub-100 px-2 pb-2 pt-2.5"
    >
      {NAV.map((item) => (
        <div key={item.id} className="contents">
          {item.id === DIVIDER_BEFORE && <div className="my-1.5 h-px bg-line-soft" aria-hidden />}
          <RailButton
            icon={item.icon}
            label={item.label}
            hint={chordCaps(item.chord, mac).join(" ")}
            active={section === item.id}
            onClick={() => setSection(item.id)}
          />
        </div>
      ))}

      {children ? (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden border-t border-line-soft pt-2">{children}</div>
      ) : (
        <div className="flex-1" />
      )}

      <RailButton
        icon={theme === "dark" ? Sun : Moon}
        label={theme === "dark" ? "Use light theme" : "Use dark theme"}
        onClick={toggleTheme}
      />
      <RailButton icon={Keyboard} label="Keyboard map" hint="?" onClick={() => setKeymapOpen(true)} />
      <RailButton
        icon={leftOpen ? PanelLeftClose : PanelLeftOpen}
        label={leftOpen ? "Hide panel" : "Show panel"}
        hint={chordCaps("Mod+B", mac).join(" ")}
        onClick={toggleLeft}
      />
      {edge}
    </nav>
  );
}
