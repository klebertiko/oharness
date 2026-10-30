# Studio

The Graph Workshop. A person describes a harness, sees it as a graph, edits it, checks it and puts it to work in a chat. Code: `components/studio/*`, `canvas/*`, `toolbar/Toolbar.tsx`, `sidebar/*`, `copilot/*`, `harnesses/*`, `cowork/CoworkPanel.tsx`. Decisions: ADR 0007 (graph auto layout), 0009 (describe first, conversation in a side panel), 0010 (the proposal lifecycle). The assistant is **Nilo**; the word "Copilot" never appears in the interface.

## Overview

**Purpose.** The way in. It answers "what do I do first?" and "where did I leave off?".

**Anatomy.** One `t-display` heading ("Harness Studio") and a sentence ("Design a workflow. Connect its agents. Share it as OHM."). The **describe box** (`oh-studio-welcome`: `radius-hero`, `line` edge, `sub-100`, `shadow-float`) with the label "Describe the harness you want", a `t-reading` textarea and **Draft with Nilo** (primary). Below, **Your harnesses** (a list of documents with one line of state under each: "Edited 2h ago", "Open · saving…", "Open · last changes not saved") and **Starting points**, a `ScrollRail` of equal-height cards, each with a `Badge` "Bundled harness", a name, a purpose and **Open harness**. A single "Continue editing {name}" returns to the open draft.

**States.** loading (`SkeletonRows`, "Loading your harnesses"), empty ("A new harness is saved here as soon as you edit it."), draft open, unsaved ("Not saved yet — the local engine is unreachable. It saves as soon as it can."), error with a Retry ("Could not load the bundled harness. Check that the local engine is available, then try again."; "Could not open this harness."; "Nilo could not start."), delete confirmation inline (Delete / Cancel, naming the harness).

**One action.** Drafting is the primary; Continue editing is the secondary when a draft is open. Back from the editor returns here and keeps the draft.

**Accessibility.** The rail is a labelled region; previous and next buttons disable at the ends; wheel and arrow keys travel it; reduced motion scrolls instantly. Each card's open button names its harness (`aria-label="Open harness: …"`).

**Copy.** Describe the harness you want / Descreva o harness que você quer · Draft with Nilo / Rascunhar com Nilo · Starting points / Pontos de partida · Your harnesses / Seus harnesses · Continue editing / Continuar editando.

## Actions bar and run bar

**Purpose.** Document verbs in one bar, run verbs in another, so nothing is offered twice.

**Actions bar.** The harness name (editable in the title bar, "Rename this harness"), the save state word ("Saved harness", "Unsaved changes", "Not saved yet", "Not saved — engine unreachable"), **Save**, **Save as…** (a copy name field, "Save copy"), **Open bundled harness** (opens an editable copy: "Bundled harnesses are never overwritten."), **Use in chat**, **Ask Nilo**, **Back to Studio**, and the destructive ones behind an inline confirmation: **Discard changes** (Discard / Cancel, "The original stays as it is.") and **Delete harness**. Labels give way to icons on narrow layouts; the name stays for assistive tech.

**Run bar** (`Toolbar`, `role="toolbar"`, "Run controls"): Run is the editor's single primary ("Add a node to run" explains a disabled one), undo and redo with their chords in the tooltip, and the **execution mode** (`Segmented`): a deterministic replay "no provider is called" or a run "with each node's pinned provider, local or cloud". Everything here is also in the command palette.

## Canvas, node plates and wires

**Purpose.** The graph, at frame rate (60 fps with 200 nodes: memoised plates, no layout reads in drag handlers).

**Node plate.** A fixed-width plate on `sub-100`: a 3px role-hue bar down the left edge, a 26px header with a 16px role glyph and the node's label, optional spec/summary rows with a `line-soft` rule above each, and port rows (`ROW_H`) with a handle at each side. Roles map one-to-one to the `role-*` tokens; the role is also written as a word, never colour alone. A selected plate gets four 8px corner brackets in `signal`; a running plate gets a 1px `signal` tick that sweeps left to right (a tick reads as throughput, a pulse reads as decoration). Failed plates carry the error in `fault-text` under the body.

**Wires.** 1px `line` strokes, `signal` when selected or hovered, a dashed march (620ms) while live, and a `t-meta` label in a small bordered chip. Ports are 7px `sub-300` handles with a `line` edge, turning `signal` on hover and while connecting.

**Viewport dock** (`CanvasDock`): one horizontal strip bottom centre, because the library's vertical stack sits in a corner where nobody's hand is. It states the zoom as a number ("Reset zoom, now 100%"), and holds **Fit graph to view**, **Auto-arrange graph** (a chord), **Snap to grid**, and **Lock the canvas** / **Unlock the canvas**; the pan tool says what it does ("Pan tool on — drag anywhere to move the canvas"). Viewport facts live here; document verbs live in the bars above.

**Reduced motion.** Camera moves and the wire march become instant; auto-arrange and fit jump.

**Accessibility.** The dock buttons carry names and chords, every graph action also exists in the command palette, and the graph audit (below) gives a keyboard route to a faulty plate. Known gap: the canvas itself is pointer-first; a full keyboard model for moving and wiring plates is not specified yet.

## Graph audit and ValidateDock

**Graph audit** (top right, floating, 188px). **Purpose.** Three faults actually stop a run, checked on every change: **No input node** (nothing can start), **never reached** (a second start that nothing points at), **dead end** (a node that has outputs but none connected, except a terminal approval). Each fault is a button that selects and centres the plate. When clear it says "All nodes wired". It never lists an advisory: a panel full of warnings is a panel nobody reads.

**ValidateDock** (the bottom bar of the editor, `section` named "Bundle"). **Purpose.** Check, simulate, export and import the bundle without leaving the editor. Actions (ghost `sm` buttons with icons that fall back to icon-only on narrow layouts): **Validate**, **Plan simulation** ("Simulation plan · {n} step(s) · no provider called"), **Export .ohm**, **Import .ohm**.

**Result line** (`role="status"`, right side): `signal-text` for success ("Bundle valid", "Downloaded .ohm", "Saved to {name}", "Imported · {id}"), `fault-text` for a failure ("Validation failed", "Simulation rejected", "Import failed validation", "Not a recognizable .ohm bundle", "Operation failed"), `ink-mute` while working ("Validating…", "Planning simulation…", "Exporting…"). The details drop below as a list (errors in `fault-text`, simulation steps in `t-meta`, at most 120px tall before scrolling). A result belongs to the draft it was made for and disappears when the draft changes; "Imported" reports an event and stays until the next action.

**Don't.** Run a dock action while a run is live (they disable); offer Export twice.

## Inspector, palette and field assist

**Inspector** (`PropertiesPanel`, right column, tab "Inspector · 1 selected"). Sections for the selected node's fields, its wiring read straight off the graph ("1 in · 2 out"), the connection pin and the **ordered failover chain** (a node whose primary connection fails or errors before any output walks the list; the pin is edited above, the fallbacks here), the model, and a token limit. Fields are `control-md`, `line-strong` edge, `sub-200` fill (`styles.fieldControl`); machine values are mono. A field the catalogue marks assistable carries the **field assist** toggle: a quiet pen row that offers **Improve**, **Review** or, for an empty field, **Draft** ("What should it do?"). The suggestion appears in a bordered block marked "Offline draft" when no provider answered, and is applied only on **Use this** (or **Improve with these** for review notes); **Discard** drops it. While a run is live the toggle is disabled with "Stop the run to edit this field".

**Node palette.** A list of node types with their role marker and "1 in · 2 out" (the fact that decides whether a node can go where you want).

**Cowork project panel.** Folder path, instructions, memory and the per-project harness; the session harness is the default for new projects.

## The agentic panel (Nilo) and proposals

ADRs 0009 and 0010. **Purpose.** The conversation lives in one place, beside the canvas. The side column has two tabs, **Inspector** and **Nilo** (`role="tablist"`, one visible at a time); below 1020px the same column opens as a sheet.

**Panel.** A heading "Build the graph in plain language", three starter prompts ("Build a research → writing → review workflow", "Add a skill with a clear outcome and a human approval gate", "Add an agent and help me define how it should behave"), a field "Describe the change…" ("Enter to send · Shift+Enter for a new line") and a quiet **provider line** that names which provider Nilo uses and opens the same picker as the composer. With none ready the line offers the honest **offline draft** instead of a dead end ("Connect a provider to send").

**Proposal card.** One proposal, one lifecycle. While **pending**, the canvas is not touched: new plates appear as dashed ghosts (`aria-label="Proposed: …"`, with the word "proposed"), changed plates carry an "edited" mark, removals fade with a "removal" mark. The card says "Nilo proposes {n} changes. Apply them or press Escape to discard.", lists each change with a checkbox (unchecking an added node unchecks what depends on it; each line can reveal its node on the canvas), and offers **Apply {n} changes** (focused on arrival), **Discard** (Esc) and **Refine**. **Applied** is one undo step with **Keep** and **Undo**; Undo disables once the graph has moved on, with the tooltip "The graph changed since — use Undo (Mod+Z)". Terminal states are one quiet line: "Kept {n} changes", "Undone", "Discarded", "Replaced by a newer request". **Stale**: the graph changed in a way that no longer fits, so the card says why and offers only Discard and Refine. A running graph disables Apply with the reason written. Arrival is announced (`role="status"`); an error is `role="alert"` with Try again.

**Safety.** Nilo only emits the validated operations in the table; credentials, providers, executable fields and the working directory are refused by the validator and never leave the browser.

**Don't.** Apply on arrival; let a new prompt silently discard an applied change (it keeps it and replaces only the pending one).

## Harness library

**Purpose.** Pick a harness bundle as a step inside Studio, never a destination.

**Anatomy.** A `Sheet` over the canvas ("Open .ohm") holding `HarnessLibrary`: the bundled Agile Harness first, then the person's imports, each row a name and a purpose line, the full description on hover. Choosing a row puts it in use, closes the sheet and returns focus to the control that opened it.

**States.** loading ("Loading bundled harnesses…"), empty ("No bundled harnesses available."), error with Retry.

## Density

Studio is the dense surface: `t-body` (12px) and `t-title` (13px), `control-sm` and `control-md`. It still honours the 24px minimum target on desktop and the 36px target on narrow layouts. The overview and the describe box are the airy part: `t-reading`, `space-6` and up.
