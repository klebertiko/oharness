# Shell

The frame around every destination. Code: `components/shell/*` and `agent/ThreadsSidebar.tsx`. Layout rules (48px title bar, `w-rail` rail, 24px status bar, 52px rail below 640px) are in `../README.md` § Layout; this file says how each piece behaves.

## Title bar

**Purpose.** Window chrome that names where you are and holds search.

**Anatomy.** The app ships with native decorations off (ADR 0001), so this bar *is* the title bar: it owns the drag region (`data-tauri-drag-region`), the window buttons on Windows and Linux (Minimise, Maximise, Close) and a 68px inset on macOS where the system draws its traffic lights. Left: the Nilo mark and wordmark (`oh-header-brand`, as wide as the rail). Then the context: the destination name ("Chats", "Harness Studio", "Providers") and, in Studio, the editable harness name (`aria-label="Harness name"`, tooltip "Rename this harness") with a "Working…" status while a run is live. Right: **Search** (the label hides first on narrow widths) with its chord in `KbdChord`, which opens the command palette.

**States and breakpoints.** Below 768px the shortcut hint hides; below 640px the wordmark and the search label hide before the document name is squeezed. Browser previews omit the native window buttons.

**Accessibility.** The search button's name carries the chord ("Search and commands (Ctrl+K)"); the harness name is a real input.

## Activity rail

**Purpose.** The flat set of destinations: **Chats** (Alt+1), **Studio** (Alt+2), **Providers** (Alt+3). Navigation never reshuffles between modes. Harnesses live inside Studio ("Open .ohm" opens the library as a sheet).

**Anatomy.** A 36px button per destination: a 16px line icon, `t-title` label. The current one is `ink-primary` on `sub-200` with the `edge-selected` mark and `aria-current="page"`; hover is one substrate step and never reads as chosen. A hairline separates the set-up-once destination (Providers) from the everyday ones. At the foot: **Keyboard map** and the **theme toggle** ("Use dark theme" / "Use light theme"). Below 640px the rail is 52px and the labels hide (the `aria-label` stays).

**Don't.** Add a fourth destination for a feature that belongs inside an existing one; badge the rail with counts.

## Status bar

**Purpose.** What is true right now, in words, with measured values only.

**Anatomy.** A 24px `contentinfo` landmark named "Status": a state square and "Running" or "Ready" (`role="status"`), "{mode} runs", "{n} nodes · {n} connections", "Selected {id}" when a plate is selected; on the right the engine state ("Engine connected" or "Engine offline" in `fault-text`) and **Shortcuts** with a `Kbd` for `?`. Below 640px only the run state and the engine stay.

**Don't.** Repeat what the header says; print internals (an earlier version read `mode Studio · exec mock · section studio`).

## Split handle

**Purpose.** Resize the side panels.

**Anatomy.** A 5px hit area over a 1px visual rule. The rule stays transparent until the pointer is over it (`line-strong`) or it is being dragged (`signal`), so a pointer sweeping the window does not light the frame up.

**Accessibility.** A `separator` (`aria-orientation="vertical"`, `aria-valuenow`, named "Resize navigation panel" or "Resize inspector") that takes the keyboard: the arrow keys move it, because a mouse-only resize is a resize some people cannot perform. The arrows move it 16px, with Shift 48px. Below 1020px the right panel is a sheet.

## Command palette

**Purpose.** Every action in one place, with its shortcut.

**Anatomy.** A `Sheet` hung from the title bar (`placement="top"`), so it reads as the search control expanding downward. The query field is a `role="combobox"` ("Search commands", placeholder "Run a command, add a node, open a harness") over a `role="listbox"` named "Commands". Each row: a 2px bar (the command's role hue, or `signal` for the active row), the label, its `KbdChord`. The active option is announced through `aria-activedescendant`, the result count ("3 results", "No results") through a polite status, and focus returns to the opener on close.

**Don't.** Put an action in the UI that is not in the palette; show an empty list with no sentence (it says "Nothing matches {query}. Try a shorter word.").

## Keymap sheet

**Purpose.** Every chord the shell owns, in the order a person meets them, with the platform's real modifier glyphs. Footer: "Every shortcut is also in the command palette." Open it with `?` or the status bar's Shortcuts. Rows include "Command palette", "Cycle chat permission mode (composer)", "Cycle execution mode", "Ask Nilo (Studio)", "Auto-arrange graph (Studio)", "Toggle inspector (Studio)", "Save harness", "Toggle left panel".

## Threads sidebar

**Purpose.** The chat list beside the conversation. A navigation list, not a listbox: each row is a button, the open chat carries `aria-current`, and the arrow keys move between rows (and open the chat they land on).

**Anatomy.** A shell `Panel` titled "Chats": **New chat** on top, a search field ("Search chats"), chats grouped by recency (Today, Yesterday, Previous 7 days, Older), each row a title with a hover/focus menu button ("Actions for {title}"). The row menu (`role="menu"`) has Rename, Archive and Delete; rename is an inline field (`aria-label="Chat name"`); delete is an inline confirmation (`role="group"`, "Confirm delete": "Delete this chat and its messages?" with Cancel focused). Archived chats sit in a collapsed section at the foot until restored or removed. The open chat carries the `edge-selected` mark.

**States.** empty (`EmptyState` "No chats yet" / "Start one and it shows up here."), no match ("No matching chats."), renaming, confirming a delete.

**Copy.** New chat / Novo chat · Search chats / Buscar chats · Rename / Renomear · Archive / Arquivar · Delete / Excluir.

## Two Panel and ListRow implementations

`components/shell/Panel` and `components/shell/ListRow` (with `StatusDot`, `ListGroup`, `RowAction`) are what the docked regions use today: Runs, Harnesses, Threads, the Studio panels and Cowork (the Providers screen moved to `ui/Panel` and `ui/ListRow`). `components/ui/Panel` and `ui/ListRow` are the specified ones (`primitives.md`). The shell row's contract, which the ui row should absorb: a title, one plain-language line, **at most one state signal** (a `StatusDot`: 7px, `signal` ok, `warn`, `fault`, or `ink-mute` idle, pulsing only while live), hover-revealed actions, and `aria-current` on the selected row. Until they are merged, new work uses `ui/` and never forks a third.
