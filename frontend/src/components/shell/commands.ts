import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Hammer,
  Keyboard,
  MessagesSquare,
  PanelLeft,
  PanelRight,
  Plug,
  Plus,
  Power,
  PowerOff,
  Puzzle,
  Settings,
  SunMoon,
  Workflow,
} from "lucide-react";
import { tr } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { applyTheme, appliedTheme } from "@/lib/theme";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { cycleRegion } from "./regions";
import { useShellStore, type RailSection } from "./shellStore";
import { useShortcutStore } from "./shortcuts";

/**
 * One command = one thing a person can ask the app to do.
 * The same list feeds the palette, the menus and the shortcut modal.
 */
export interface Command {
  id: string;
  /** Human-written, imperative. */
  label: string;
  /** Grouping kicker shown once per run of commands. */
  group: string;
  icon: LucideIcon;
  /** Chord spec understood by keys.ts, e.g. "Mod+Enter". Effective binding. */
  chord?: string;
  /** Binding before a person rebinds it. */
  defaultChord?: string;
  /** Machine-side detail shown mono at the right. */
  meta?: string;
  /** Extra substrings the matcher should accept. */
  keywords?: string;
  /** Alternate names, searched with the label. */
  aliases?: string[];
  role?: string;
  disabled?: boolean;
  run: () => void;
}

const goTo = (section: RailSection) => () => useShellStore.getState().setSection(section);

interface NavSpec {
  section: RailSection;
  label: MessageKey;
  icon: LucideIcon;
  chord?: string;
  keywords: string;
}

const NAV: NavSpec[] = [
  { section: "chats", label: "shell.cmd.goChats", icon: MessagesSquare, chord: "Alt+1", keywords: "conversation thread session" },
  { section: "forja", label: "shell.cmd.goForja", icon: Hammer, chord: "Alt+2", keywords: "work items inbox" },
  { section: "studio", label: "shell.cmd.goStudio", icon: Boxes, chord: "Alt+3", keywords: "canvas design harness graph" },
  { section: "plugins", label: "shell.cmd.goPlugins", icon: Puzzle, chord: "Alt+4", keywords: "extensions" },
  { section: "settings", label: "shell.cmd.goSettings", icon: Settings, chord: "Alt+5", keywords: "preferences language theme" },
  { section: "providers", label: "shell.cmd.goProviders", icon: Plug, keywords: "models keys" },
];

function bind(id: string, fallback?: string): string | undefined {
  return useShortcutStore.getState().chordFor(id, fallback);
}

export function startSession() {
  useThreadStore.getState().createThread();
  useShellStore.getState().setSection("chats");
  useShellStore.getState().setDrawerOpen(false);
}

/** Shell commands. Studio verbs are added by the page and share this shape. */
export function shellNavCommands(): Command[] {
  const nav = NAV.map(({ section, label, icon, chord, keywords }) => ({
    id: `go:${section}`,
    label: tr(label),
    group: tr("shell.cmd.group.goTo"),
    icon,
    chord: bind(`go:${section}`, chord),
    defaultChord: chord,
    keywords,
    aliases: [section],
    meta: section,
    run: goTo(section),
  }));

  const view: Command[] = [
    {
      id: "session:new",
      label: tr("shell.cmd.newSession"),
      group: tr("shell.cmd.group.session"),
      icon: Plus,
      chord: bind("session:new", "Mod+N"),
      defaultChord: "Mod+N",
      keywords: "chat thread start",
      aliases: ["new chat"],
      run: startSession,
    },
    {
      id: "sidebar:cycle",
      label: tr("shell.cmd.toggleLeft"),
      group: tr("shell.cmd.group.view"),
      icon: PanelLeft,
      chord: bind("sidebar:cycle", "Mod+B"),
      defaultChord: "Mod+B",
      keywords: "collapse hide rail panel",
      run: () => useShellStore.getState().toggleLeft(),
    },
    {
      id: "dock:toggle",
      label: tr("shell.cmd.toggleDock"),
      group: tr("shell.cmd.group.view"),
      icon: PanelRight,
      chord: bind("dock:toggle", "Mod+\\"),
      defaultChord: "Mod+\\",
      keywords: "inspector panel right",
      run: () => useShellStore.getState().toggleRight(),
    },
    {
      id: "dock:toggle-alt",
      label: tr("shell.cmd.toggleDockAlt"),
      group: tr("shell.cmd.group.view"),
      icon: PanelRight,
      chord: bind("dock:toggle-alt", "Mod+Alt+B"),
      defaultChord: "Mod+Alt+B",
      keywords: "inspector",
      run: () => useShellStore.getState().toggleRight(),
    },
    {
      id: "palette:open",
      label: tr("shell.keymap.palette"),
      group: tr("shell.cmd.group.view"),
      icon: Keyboard,
      chord: bind("palette:open", "Mod+K"),
      defaultChord: "Mod+K",
      keywords: "search commands",
      run: () => useShellStore.getState().setPaletteOpen(true),
    },
    {
      id: "shortcuts:open",
      label: tr("shell.cmd.shortcuts"),
      group: tr("shell.cmd.group.view"),
      icon: Keyboard,
      chord: bind("shortcuts:open", "Mod+/"),
      defaultChord: "Mod+/",
      keywords: "keymap keyboard",
      run: () => useShellStore.getState().setKeymapOpen(true),
    },
    {
      id: "regions:cycle",
      label: tr("shell.cmd.cycleRegions"),
      group: tr("shell.cmd.group.view"),
      icon: PanelLeft,
      chord: bind("regions:cycle", "F6"),
      defaultChord: "F6",
      keywords: "focus landmarks",
      run: () => cycleRegion(1),
    },
    {
      id: "theme:toggle",
      label: tr((typeof document === "undefined" ? "dark" : appliedTheme()) === "dark" ? "shell.rail.useLight" : "shell.rail.useDark"),
      group: tr("shell.cmd.group.view"),
      icon: SunMoon,
      keywords: "dark light appearance",
      run: () => applyTheme(appliedTheme() === "dark" ? "light" : "dark"),
    },
  ];

  return [
    ...nav,
    ...view,
    {
      id: "harness:library",
      label: tr("shell.cmd.openLibrary"),
      group: tr("shell.cmd.group.goTo"),
      icon: Workflow,
      keywords: "library bundle ohm import open harnesses",
      run: () => useShellStore.getState().setLibraryOpen(true),
    },
    {
      id: "harness:on",
      label: tr("shell.cmd.harnessOn"),
      group: tr("shell.cmd.group.harness"),
      icon: Power,
      keywords: "enable govern policy",
      run: () => useHarnessSessionStore.getState().setEnabled(true),
    },
    {
      id: "harness:off",
      label: tr("shell.cmd.harnessOff"),
      group: tr("shell.cmd.group.harness"),
      icon: PowerOff,
      keywords: "disable direct passthrough",
      run: () => useHarnessSessionStore.getState().setEnabled(false),
    },
  ];
}

/** Chords the shortcut modal is allowed to show: exactly the registry, nothing else. */
export function chordsIn(commands: Command[]): string[] {
  return commands.flatMap((command) => (command.chord ? [command.chord] : []));
}

export interface Match {
  command: Command;
  score: number;
  /** Index pairs into `label` that matched, for highlighting. */
  hits: number[];
}

/**
 * Subsequence matcher, scored on how early and how contiguously the query
 * lands. The same query must always yield the same top row.
 */
export function matchCommands(commands: Command[], query: string): Match[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return commands.map((command, i) => ({ command, score: 1000 - i, hits: [] }));
  }

  const out: Match[] = [];
  for (const command of commands) {
    const hay = command.label.toLowerCase();
    const extra = `${command.group} ${command.meta ?? ""} ${command.keywords ?? ""} ${(command.aliases ?? []).join(" ")} ${command.chord ?? ""}`.toLowerCase();

    const direct = hay.indexOf(q);
    if (direct >= 0) {
      out.push({
        command,
        score: 1000 - direct * 8 - (hay.length - q.length),
        hits: Array.from({ length: q.length }, (_, k) => direct + k),
      });
      continue;
    }

    const hits: number[] = [];
    let qi = 0;
    let gaps = 0;
    let last = -1;
    for (let i = 0; i < hay.length && qi < q.length; i++) {
      if (hay[i] === q[qi]) {
        if (last >= 0 && i !== last + 1) gaps++;
        hits.push(i);
        last = i;
        qi++;
      }
    }
    if (qi === q.length) {
      out.push({ command, score: 600 - gaps * 20 - hits[0] * 3, hits });
      continue;
    }

    if (extra.includes(q)) out.push({ command, score: 200, hits: [] });
  }

  return out.sort((a, b) => b.score - a.score);
}
