# Primitives

The set in `frontend/src/components/ui/` (exported from `ui/index.ts`), tested with vitest and axe and shown at `/dev/design-system` in both themes. The runnable specification of Button, Input, Badge, Panel, ListRow and Kbd is `../reference/`; Notice, EmptyState, Skeleton, Segmented and Sheet are documented here first and join the reference in the next step. The Combobox has its own file, `model-picker.md`. `StatusMark` and `ConfirmInline` came with the Providers foundation (ADR 0033, 0034) and are described at the end.

Shared rules, which every entry assumes: sentence case; the 2px `signal` focus ring on `:focus-visible`; control edges are `line-strong`, panel edges `line` or `line-soft`; heights `control-sm` 24, `control-md` 28, `control-lg` 36 (every size rises to 36 below 640px, and to `control-touch` 44 when the primary pointer is touch, `pointer: coarse`, ADR 0033: Button, Input, ListRow and Segmented carry the `pointer-coarse:` classes); disabled is `opacity-45` and always explained nearby; no transition on layout properties; under `prefers-reduced-motion` every transition and animation is instant.

## Button

**Purpose.** Start an action. One `primary` per view at most.

**Anatomy.** Optional leading `icon`, label (`font-medium`, `text-body` at `sm`, `text-title` at `md` and `lg`), a spinner that replaces nothing: the label stays in layout and turns `invisible`, so a loading button keeps its width.

**Variants.** `primary` (`signal` fill, `signal-ink` text), `secondary` (default: `line-strong` edge on `sub-200`), `ghost` (toolbars and panel heads, no edge), `danger` (`fault` edge, `fault-text` label). `iconOnly` makes the button square at its size.

**States.** rest, hover (`sub-300`, primary mixes 12% `ink-primary` in), pressed (`sub-400`, primary `signal-deep`), focus ring, `loading` (`aria-busy`, click ignored, cursor `progress`), disabled.

**Use.** "Approve plan" is the one primary in `PlanArtifactCard`; "Discard plan" beside it is secondary. `RunControls` shows one primary that changes with the run: Run or Run again when idle, Step when a run is parked; while it runs the only button is the `danger` Stop (tooltip "Stop after the current node"), instead of four buttons three of them dead. A destructive confirmation names the act: "Delete harness", never "OK".

**Don't.** Two primaries side by side; a label like "Submit" or "Yes"; a disabled primary with no reason on screen (leave it enabled and explain on press, or put the reason in a `Notice`); swapping the label for "Loading…".

**Accessibility.** A native `<button type="button">`. `iconOnly` requires `aria-label`; the component adds no tooltip, so pass `title` as well (with the chord, if any). `loading` renders a `role="status"` "Working" and sets `aria-busy`. A toggle button uses `role="switch"` with `aria-checked` (the `SubagentToggle`).

**Copy.** Verbs and objects: Use in chat / Usar no chat · Approve plan / Aprovar plano · Discard plan / Descartar plano · Send next / Enviar próxima · Clear queue / Limpar fila · Revert / Reverter · Cancel / Cancelar.

## Input

**Purpose.** A labelled single-line field.

**Anatomy.** `label` above (`text-body`, `font-medium`, `ink-dim`), the field (`control-md` high, `line-strong` edge, `sub-100` fill, `sub-200` on hover, `signal` edge on focus, `fault` edge when invalid), a message row under it that is always one line tall (`min-h-4`) so an error never moves anything. `mono` sets machine data in `t-code`. `compact` drops the message row for a standalone filter.

**States.** rest, hover, focus, invalid (`aria-invalid`, the error replaces the hint and is announced with `role="alert"`), disabled.

**Use.** Forms where an error can appear. For a search or filter box in a toolbar use `compact`.

**Don't.** Placeholder as the label; validation on every keystroke (validate on blur or after 250 ms, `experience.md`); a hairline edge (`line`, `line-soft`) on a field. The guardrail test fails a literal `<input>`, `<textarea>` or `<select>` edged that way.

**Accessibility.** `<label htmlFor>`, `aria-describedby` points at the message row, `aria-invalid` when `error` is set.

**Copy.** Hint says the format: "Paste the key from your Anthropic console" / "Cole a chave do console da Anthropic". Error says what is wrong and what to do: "That key was rejected. Replace it." / "A chave foi recusada. Substitua-a."

**In the app.** `ThreadsSidebar` uses `Input` (the chat search, `compact`). Fields in the Studio inspector are styled by hand (`PropertiesPanel` `inputCls`) and the composer uses its own textarea; `Input` is the one to use for new forms.

## Badge

**Purpose.** Name a status or a node role.

**Anatomy.** 20px, mono `t-meta`, `line-strong` edge, a 8px square marker, then the word. `tone`: neutral, signal, warn, fault (the text turns `warn-text` or `fault-text`). `role`: the marker takes `--role-<name>`.

**Use.** `StudioOverview` marks a bundled harness with a Badge; `StudioActionsBar` shows "Saved harness", "Bundled harness". The marker is never the only signal: the word is always there.

**Don't.** A row of badges ("pill farm"); colour with no word; a badge for a count (use plain `t-meta`).

**Accessibility.** Plain text in a `<span>`; the marker is `aria-hidden`.

**Copy.** One or two words: Bundled harness / Harness incluído · Saved harness / Harness salvo.

## Kbd and KbdChord

**Purpose.** Show a keyboard shortcut.

**Anatomy.** An 18px squared cap: `line` edge, `sub-200` fill, mono `t-meta` in `ink-mute`. `KbdChord` lays caps from `chordCaps()` side by side, which returns the platform's real glyphs (⌘ on macOS, Ctrl elsewhere).

**Use.** `TitleBar` search ("Search" + chord), the `CommandPalette` rows, `Toolbar` undo and redo, the `KeymapSheet`.

**Don't.** Type a shortcut as running text ("press Ctrl K"); a generic "Ctrl" on a Mac.

**Accessibility.** A `<kbd>` element. In a tooltip or `title` write the chord in words as well (`Undo · Ctrl+Z`).

## Panel

**Purpose.** A bounded region.

**Anatomy.** Variants: `panel` (`sub-100`, `line-soft` edge, `radius-panel`, 1px inner top highlight), `float` (`radius-float`, `line` edge, `shadow-float`) and `inset` (`sub-200`, `radius-control`). An optional 32px header carries `t-title`, `meta` (mono, `ink-mute`, pinned right) and `actions`.

**Use.** `title` and `titleId` together make a labelled region (`aria-labelledby`). Only `float` has a shadow.

**Don't.** A shadow to separate two panels (use a value step and `line`); nested panels more than one deep.

**Two implementations.** The shell's docked regions (Harnesses, Runs, Threads, Studio panels, Cowork) still use `components/shell/Panel`, a 32px header with a `t-title` and mono meta, without the labelled-region contract. New work uses `ui/Panel`; merging the two is a follow-up (audit D6).

## ListRow

**Purpose.** A selectable row in a list.

**Anatomy.** 36px minimum (the touch target), `leading` slot (`ink-mute`), `t-title` title, optional `meta` under it in `t-meta` mono, `trailing` slot. Selected: `bg-sub-200`, `ink-primary` and the `edge-selected` mark (a 2px `signal` edge on the leading side, utility `shadow-selected`) with `aria-current="true"`.

**States.** rest, hover (`sub-200`), pressed (`sub-300`), selected, disabled.

**Use.** One title, one plain-language line, at most one state signal. Machine ids and counters belong in the detail view.

**Don't.** Colour as the only selected cue; actions that are visible on every row (show them on hover or focus); a second selected mark.

**In the app.** The shell's variant (`shell/ListRow`, with `StatusDot`, `ListGroup` and `RowAction`) is what Runs, Harnesses and Providers rows use today; `ui/ListRow` is the specified one (audit D6).

## Notice

**Purpose.** Say what happened and what to do next, inline.

**Anatomy.** Icon (info, triangle for warn, circle-alert for fault), optional bold `title`, body in `ink-dim`, optional `action` on the right. Tint: a 10% `warn` or `fault` mix over the surface with a `warn` or `fault` edge; `info` is `sub-200` with a `line` edge. The title text is `warn-text` or `fault-text`, never the raw colour.

**States.** Tones `info`, `warn`, `fault`. Faults are `role="alert"` (announced at once); the others `role="status"` (polite). Override with `role`.

**Use.** `ChatComposer` shows a `warn` Notice when a slash command contains shell syntax: "There is no shell on the other side: | would be passed literally. Run one program at a time." `PlanArtifactCard` shows a `fault` Notice when approving failed.

**Don't.** A Notice for something the person cannot act on and does not need to know; a Notice with no icon; stacking more than two in a view.

**Copy.** Say what happened, then what the person can do, in two short sentences. "Couldn't reach the sidecar. Retry, or open Providers." / "Não foi possível alcançar o sidecar. Tente de novo ou abra Providers."

## EmptyState

**Purpose.** The designed empty state of a list or panel.

**Anatomy.** Dashed `line-strong` border, `radius-panel`, a `t-title` title that says what is true, an optional `ink-mute` line of at most 56ch, one `action`. No mascot (Nilo appears only where `../brand.md` allows).

**Use.** `ThreadsSidebar` ("No chats yet" + "Start one and it shows up here."), `StudioOverview` for "Your harnesses". See `patterns.md` § Empty, error and loading.

**Don't.** "Nothing here" with no action; two actions; an illustration.

**Copy.** "No chats yet" / "Nenhum chat ainda" · "Start one and it shows up here." / "Comece um e ele aparece aqui."

## Skeleton and SkeletonRows

**Purpose.** Reserve the exact size of what will load.

**Anatomy.** `sub-200` blocks with `radius-control` and `animate-pulse` (off under reduced motion). `SkeletonRows` stacks `rows` blocks at 36px, announced once as a `role="status"` with the `label`.

**Use.** Only when there is nothing to show yet. If previous content exists, keep it and mark the region `aria-busy` (`experience.md`). `StudioOverview` shows `SkeletonRows` with the label "Loading your harnesses".

**Don't.** A full-page spinner; a skeleton taller or shorter than the content it stands for (it shifts the layout).

## Segmented

**Purpose.** A single choice among a few options, always visible (up to five; the permission mode is the one sanctioned six, kept in one table).

**Anatomy.** A radiogroup with a `line-strong` edge; each option `control-sm` high, `text-body` `font-medium`; the chosen one is `sub-300` and `ink-primary`, the rest `ink-mute`. One tab stop (roving `tabIndex`), arrow keys move and choose, `aria-checked` says which. `hint` is the tooltip with the consequence; an option can be `disabled`.

**Use.** The composer's permission mode (Plan, Read-only, Ask, Auto, Workspace write, Full, strictest first), where `hint` explains each and the whole group is disabled while a turn runs.

**Don't.** More than five options (use the Combobox); two segmented controls side by side with related meaning; a Segmented for an action (it is a state).

**Copy.** Labels are single words from `permissionModes.json`, the one table the frontend and backend share.

## Sheet

**Purpose.** A modal float for a bounded task: the command palette, the keymap, the tool hooks, the harness library.

**Anatomy.** `Dialog` from Radix: scrim (`overlay-backdrop`), content `radius-float`, `line` edge, `shadow-float`, a `t-title` heading (or `hideTitle` for assistive tech only), optional visible Close. `placement` is `center` or `top` (hung from the title bar, as the palette). Width `min(560px, viewport − 24px)`. Entrance is opacity and an 8px translate at `duration-enter`, none under reduced motion.

**Accessibility.** Focus is trapped, Escape and the scrim close it, and focus returns to whatever opened it even when the sheet was opened from store state (the opener is remembered as the sheet takes focus). `title` is required.

**Don't.** A sheet for a destructive confirmation that fits inline; a sheet that opens another sheet.

**Copy.** Title names the task: "Tool hooks" / "Hooks de ferramentas" · "Keyboard map" / "Mapa de teclado".

## StatusMark

**Purpose.** The one state marker: an 8px square beside the word that names the state. It replaces the two dot vocabularies the Providers audit found (D2).

**Anatomy.** `h-2 w-2`, square (`rounded-none`). Tones: `ok` (`signal`), `warn`, `fault`, `busy` (`ink-dim`, pulsing, still under reduced motion), `idle` (`ink-mute`), `off` (hollow, `ink-mute` edge: nothing configured yet).

**Rules.** Decorative by construction (`aria-hidden`): the word beside it carries the meaning, so colour is never alone, and hollow versus filled keeps "not set up" apart from "tried and failed". One marker per row.

**Status.** Foundation only; the Providers rebuild is its first consumer. The chat picker's 6px tone dots and the shell's 7px `StatusDot` are older vocabularies that fold into it (audit D6).

## ConfirmInline

**Purpose.** Confirm a destructive action where it was asked, not in a dialog.

**Anatomy.** A `role="group"` row: the prompt (wraps from 192px), a secondary **Cancel** that has the focus on arrival, and a `danger` button that names the act ("Remove key", never "OK"), with `loading` while it works. Escape cancels unless busy. Cancel's label comes from the `common.cancel` catalogue key.

**Don't.** A modal for a confirmation that fits in the row; "OK" or "Yes" on the destructive button.

**Copy.** Prompt says what is lost: "Remove the saved key for {connection}?" / "Remover a chave salva de {connection}?"; button: Remove key / Remover chave.

