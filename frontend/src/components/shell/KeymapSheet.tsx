"use client";
import { chordCaps, useIsMac } from "./keys";
import { KbdChord, Sheet } from "@/components/ui";

/**
 * The keymap sheet (`?`). Every chord the shell owns, in the order a person
 * meets them, with the platform's real modifier glyphs, not a generic "Ctrl"
 * on a Mac. Nothing here is exclusive: each row also exists in the palette.
 */

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Command",
    rows: [
      ["Mod+K", "Command palette"],
      ["?", "This sheet"],
      ["Escape", "Dismiss overlay"],
    ],
  },
  {
    title: "Run",
    rows: [
      ["Mod+Enter", "Run harness"],
      ["Mod+S", "Save harness"],
      ["Mod+Shift+M", "Cycle execution mode"],
      ["Shift+Tab", "Cycle chat permission mode (composer)"],
    ],
  },
  {
    title: "Go to",
    rows: [
      ["Alt+1", "Chats"],
      ["Alt+2", "Studio"],
      ["Alt+3", "Providers"],
    ],
  },
  {
    title: "Layout",
    rows: [
      ["Mod+B", "Toggle left panel"],
      ["Mod+Alt+B", "Toggle inspector (Studio)"],
      ["Mod+I", "Ask Nilo (Studio)"],
    ],
  },
  {
    title: "Graph",
    rows: [
      ["Mod+Z", "Undo"],
      ["Mod+Shift+Z", "Redo"],
      ["Shift+L", "Auto-arrange graph (Studio)"],
      ["Mod+Shift+E", "Export graph JSON (advanced)"],
    ],
  },
];

export function KeymapSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mac = useIsMac();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Keyboard map" className="w-[min(560px,calc(100vw-24px))]">
      <div className="grid min-h-0 grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto p-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <div className="mb-1.5 flex items-center gap-2" aria-hidden>
              <span className="t-label text-ink-mute">{g.title}</span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>
            <dl className="space-y-1">
              {g.rows.map(([chord, label]) => (
                <div key={chord} className="flex items-center gap-2">
                  <dt className="flex-none">
                    <KbdChord caps={chordCaps(chord, mac)} />
                  </dt>
                  <dd className="t-body min-w-0 text-ink-dim">{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="t-body flex-none border-t border-line-soft bg-sub-200 px-3 py-2 text-ink-mute">Every shortcut is also in the command palette.</p>
    </Sheet>
  );
}
