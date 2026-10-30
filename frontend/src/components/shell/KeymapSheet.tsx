"use client";
import { chordCaps, useIsMac } from "./keys";
import { KbdChord, Sheet } from "@/components/ui";
import { useT } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";

/**
 * The keymap sheet (`?`). Every chord the shell owns, in the order a person
 * meets them, with the platform's real modifier glyphs, not a generic "Ctrl"
 * on a Mac. Nothing here is exclusive: each row also exists in the palette.
 */

const GROUPS: { title: MessageKey; rows: [string, MessageKey][] }[] = [
  {
    title: "shell.keymap.group.command",
    rows: [
      ["Mod+K", "shell.keymap.palette"],
      ["?", "shell.keymap.thisSheet"],
      ["Escape", "shell.keymap.dismiss"],
    ],
  },
  {
    title: "shell.keymap.group.run",
    rows: [
      ["Mod+Enter", "shell.keymap.runHarness"],
      ["Mod+S", "shell.keymap.saveHarness"],
      ["Mod+Shift+M", "shell.keymap.cycleMode"],
      ["Shift+Tab", "shell.keymap.cyclePermission"],
    ],
  },
  {
    title: "shell.keymap.group.goTo",
    rows: [
      ["Alt+1", "shell.rail.chats"],
      ["Alt+2", "shell.rail.studio"],
      ["Alt+3", "shell.rail.providers"],
    ],
  },
  {
    title: "shell.keymap.group.layout",
    rows: [
      ["Mod+B", "shell.keymap.toggleLeft"],
      ["Mod+Alt+B", "shell.keymap.toggleInspector"],
      ["Mod+I", "shell.keymap.askNilo"],
    ],
  },
  {
    title: "shell.keymap.group.graph",
    rows: [
      ["Mod+Z", "shell.keymap.undo"],
      ["Mod+Shift+Z", "shell.keymap.redo"],
      ["Shift+L", "shell.keymap.autoArrange"],
      ["Mod+Shift+E", "shell.keymap.exportJson"],
    ],
  },
];

export function KeymapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const mac = useIsMac();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title={t("shell.keymap.title")} className="w-[min(560px,calc(100vw-24px))]">
      <div className="grid min-h-0 grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto p-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} aria-label={t(g.title)}>
            <div className="mb-1.5 flex items-center gap-2" aria-hidden>
              <span className="t-label text-ink-mute">{t(g.title)}</span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>
            <dl className="space-y-1">
              {g.rows.map(([chord, label]) => (
                <div key={chord} className="flex items-center gap-2">
                  <dt className="flex-none">
                    <KbdChord caps={chordCaps(chord, mac)} />
                  </dt>
                  <dd className="t-body min-w-0 text-ink-dim">{t(label)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="t-body flex-none border-t border-line-soft bg-sub-200 px-3 py-2 text-ink-mute">{t("shell.keymap.footer")}</p>
    </Sheet>
  );
}
