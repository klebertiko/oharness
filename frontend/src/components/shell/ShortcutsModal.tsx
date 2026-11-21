"use client";

import { useMemo, useState } from "react";
import { KbdChord, Sheet } from "@/components/ui";
import { useI18n } from "@/i18n/store";
import { chordCaps, useIsMac } from "./keys";
import { chordFromEvent, sameChord, useShortcutStore } from "./shortcuts";
import type { Command } from "./commands";

/**
 * Ctrl+/ . One list, taken from the command registry: search by words, or press
 * the shortcut and the row that owns it is what's left. A row can be rebound.
 */
export function ShortcutsModal({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mac = useIsMac();
  const rebind = useShortcutStore((s) => s.rebind);
  const [query, setQuery] = useState("");
  const [chord, setChord] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);

  const rows = useMemo(() => {
    const withChord = commands.filter((command) => command.defaultChord || command.chord);
    if (chord) return withChord.filter((command) => sameChord(command.chord, chord) || sameChord(command.defaultChord, chord));
    const q = query.trim().toLowerCase();
    if (!q) return withChord;
    return withChord.filter((command) => `${command.label} ${command.group} ${command.keywords ?? ""} ${command.chord ?? ""}`.toLowerCase().includes(q));
  }, [commands, query, chord]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        setRecording(null);
      }
      return;
    }
    const pressed = chordFromEvent(e, mac);
    if (!pressed) return;
    if (recording) {
      e.preventDefault();
      e.stopPropagation();
      rebind(recording, pressed);
      setRecording(null);
      setChord(null);
      return;
    }
    // A modifier chord filters the list instead of typing into the field.
    if (pressed.includes("+") || /^F\d+$/.test(pressed)) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
      setChord(pressed);
    }
  };

  const conflict = (next: string, id: string) => commands.find((command) => command.id !== id && sameChord(command.chord, next));

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title={t("shell.shortcuts.title")} className="w-[min(560px,calc(100vw-24px))]">
      <div className="flex flex-none flex-col gap-1 border-b border-line px-3 py-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChord(null);
          }}
          onKeyDown={onKeyDown}
          aria-label={t("shell.shortcuts.searchAria")}
          placeholder={t("shell.shortcuts.search")}
          className="oh-focus-inner t-title h-control-lg w-full bg-transparent text-ink placeholder:text-ink-mute"
        />
        {chord && <p className="text-body text-ink-mute">{t("shell.shortcuts.byKey", { chord: chordCaps(chord, mac).join("+") })}</p>}
        {recording && <p role="status" className="text-body text-signal-text">{t("shell.shortcuts.recording")}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 && <p className="px-2 py-4 text-center text-body text-ink-mute">{t("shell.shortcuts.empty")}</p>}
        <ul className="flex flex-col gap-1" aria-label={t("shell.shortcuts.title")}>
          {rows.map((command) => {
            const other = command.chord ? conflict(command.chord, command.id) : undefined;
            return (
              <li key={command.id} className="flex items-center gap-2 rounded-control px-2 py-1">
                <span className="t-body min-w-0 flex-1 truncate text-ink">{command.label}</span>
                {command.chord && <KbdChord caps={chordCaps(command.chord, mac)} />}
                <button
                  type="button"
                  className="oh-focus-inner h-control-sm rounded-control px-2 text-meta text-ink-dim hover:bg-sub-200"
                  onClick={() => setRecording(command.id)}
                >
                  {recording === command.id ? t("shell.shortcuts.recording") : t("shell.shortcuts.rebind")}
                </button>
                {other && recording === command.id && <span className="text-meta text-warn-text">{t("shell.shortcuts.conflict", { label: other.label })}</span>}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="t-body flex-none border-t border-line-soft bg-sub-200 px-3 py-2 text-ink-mute">{t("shell.keymap.footer")}</p>
    </Sheet>
  );
}
