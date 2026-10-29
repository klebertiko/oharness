# Composer

Where a person says what to do and decides how much the machine may do on its own. Code: `agent/ChatComposer.tsx` (text, slash commands, permission), `agent/AgentStage.tsx` (the toolbar under it and the send controls), and the small pieces below. The surface is `oh-agent-composer`: `sub-100`, `radius-composer`, `shadow-soft`, a `signal` ring when it has focus (`:focus-within`).

## Layout

From top to bottom: queued messages (when any), the textarea, the permission row, run notes (workspace tools state), then the toolbar: **Harness switch**, **Subagents**, **model picker**, **workspace chip**, **token ceiling** (only when no harness runs the turn), **Tool hooks**, a flexible gap, then the call to action or the send hint and the send controls. The run settings are one `fieldset` that is disabled while a turn runs (60% opacity), so none of them changes under a running turn. Narrow layouts (below 640px) raise every control to 36px and hide the hint.

**One action per state.** Idle with something to send: Send is the single primary. Running: **Queue** (secondary, large) and **Stop run** (icon-only). Nothing can answer: the call to action from `model-picker.md` takes the hint's place and Send is disabled with the same words as its tooltip.

## Textarea and slash commands

**Anatomy.** A two-row textarea (`t-reading`, 64px minimum, no own border: the wrapper draws the focus ring). Typing `/` opens a floating `listbox` above it (`oh-float`): a header ("Commands, skills & tools · {workspace}" with the keys on the right), rows with the command, a description, an optional hint chip and its kind (Command, Skill, Tool).

**States.** closed, open with results, open with none ("No matching commands. Esc keeps your text."), a run is live (rows are `aria-disabled`, 50%, with "Stop or finish the run to use commands."), no folder ("Choose a folder to use tools."), a skill is being read ("Reading the workspace skill…") or failed (`fault` Notice), a typed `/exec` or `/read` preset, or a `warn` Notice when the text has shell syntax.

**Keyboard.** `↑ ↓` move, `Enter` or `Tab` choose, `Esc` dismisses and keeps the text, `Ctrl/⌘ Enter` sends, `Shift+Tab` cycles the permission mode. IME composition is respected.

**Accessibility.** The textarea is `aria-label="Message OHarness"` with `aria-autocomplete="list"`, `aria-controls` and `aria-activedescendant` on the open list; options are `role="option"` with `aria-selected`.

**Copy.** Placeholder idle: "Ask OHarness… Type / for commands and skills" / "Pergunte ao OHarness… Digite / para comandos e skills". While a turn runs: "A turn is running. Send queues your message to run after it." / "Um turno está em andamento. Enviar coloca a mensagem na fila para rodar depois dele."

## Permission presets and Plan mode

ADR 0021 (presets) and 0022 (Plan). The mode belongs to the conversation, is enforced by the sidecar, and the one table of ids, labels, hints and summaries is `permissionModes.json` (a byte-identical copy exists in the backend and a test pins it). There is no mode that bypasses everything.

**Anatomy.** A `Segmented` named "Permission mode" with six options from strictest to loosest, then the one-line summary of the chosen mode and "Shift+Tab cycles the mode".

| Mode | Label | Summary (as shipped) |
| --- | --- | --- |
| `plan` | Plan | read-only; ends in a plan you approve |
| `read_only` | Read-only | only read-only commands run; writes are refused |
| `ask` | Ask | asks before every command (the default) |
| `auto_workspace` | Auto | read-only commands run on their own |
| `workspace_write` | Workspace write | writes inside the workspace run on their own; anything else asks |
| `full` | Full | commands run without asking, except high-risk ones |

**States.** Disabled while a turn runs. A refused change shows the sidecar's reason in a `fault` Notice ("permissionNotice"). The keyboard cycle is only Ask, Auto, Plan; **Full is never reached by the keyboard**, only by a confirmed choice.

**Full is chosen on purpose.** Picking it opens an `alertdialog` ("Switch to Full") with the consequence in words (runs commands without asking, inside and outside the workspace; high-risk commands and commands naming a secret file still ask), a primary "Use Full" and a "Cancel" that has the focus. Same pattern for **Trust this workspace…** under Auto or Workspace write: a warn-bordered `alertdialog`, "Trust" and an initially focused "Cancel", and a "Revoke trust" once trusted.

**Use.** Say what the mode does in the present tense and name what still asks. The hint (tooltip) is the long form; the summary is the always-visible one.

**Don't.** Colour a mode red or green; hide the mode in a menu; add a "bypass" or "danger" label; let a keyboard shortcut reach Full.

**Copy.** Permission mode / Modo de permissão · Use Full / Usar Full · Trust this workspace… / Confiar neste workspace… · Revoke trust / Revogar confiança. Mode names stay in English in pt-BR (they are the names in the table).

### Plan artifact card

**Purpose.** The end of a Plan-mode turn: the plan, awaiting approval. Nothing has run.

**Anatomy.** A `section` named "Plan awaiting your approval": `line-strong` edge on `sub-100`, the heading "Plan · Nothing has run yet", the plan text in `t-reading` at most 68ch, an optional `fault` Notice, **Approve plan** (primary) and **Discard plan**, and a note: "Approving moves this chat to Ask and sends the plan as the next turn. Commands still wait for your approval."

**States.** pending, `busy` (both buttons disabled), error (Notice), restored after a reload (`GET /chat/tools/plan`). Approving never lands in Plan or Full.

**Copy.** Approve plan / Aprovar plano · Discard plan / Descartar plano · Plan · Nothing has run yet / Plano · Nada foi executado ainda.

## Message queue

ADR 0023. **Purpose.** Let the person send the next message while a turn runs.

**Anatomy.** A `section` named "Queued messages" above the composer: `line-soft` edge on `sub-100`; a `t-meta` header "Queued ({n}): runs after the current turn."; a numbered list (`ol`, `aria-live="polite"`) of one-line messages, each with an icon-only Remove button (`aria-label` quoting the first 40 characters). Up to 20 messages; only plain messages queue.

**States.** running (queued), **paused**: the turn did not finish, the header reads "Queue paused: the turn did not finish. {n} waiting." and **Send next** appears beside **Clear queue**. Nothing ever runs on its own after an error.

**Don't.** Drain the queue after a stop or a failure; queue a `/exec` or `/read` (those wait for the run to end); lose the draft being typed during a drain.

**Copy.** Queue / Enfileirar · Clear queue / Limpar fila · Send next / Enviar próxima · Queued ({n}): runs after the current turn. / Na fila ({n}): roda depois do turno atual.

## Harness switch

ADRs 0011 and 0012. **Purpose.** Which harness runs this chat: a setting of the conversation, valid from the next turn.

**Anatomy.** A `Combobox` trigger with the harness name (or "No harness"), named `Harness: {name}`, up to 260px. The list: **No harness** first ("Talk to the model directly"), then Unavailable (only when the chat points at a deleted harness; disabled and explained), Recent (up to 3, only from 6 harnesses), Your harnesses, Bundled harnesses. Each option has a name and its purpose (the first sentence of the description). A filter appears from 8 options. The only way out is one footer action: "Edit in Studio" (loads the graph of the harness in use) or "Open Studio". Providers never appear here.

**States.** loading ("Loading harnesses…"; No harness stays available), error ("Couldn't load harnesses." + "Try again"), empty ("No harnesses yet. Create one in Studio." + "Open Studio"), no match ("No harness matches that."), unavailable (the trigger reads "{name} (unavailable)" in `warn-text`, **sending is blocked** with a warning and the action "Continue without a harness").

**History stays true.** Each reply records the harness that produced it. Changing it after messages leaves a quiet separator line in the transcript: "Harness changed to {name}. It applies from your next message; earlier replies stay as they were."

**Copy.** Which harness runs this chat / Qual harness roda este chat · Edit in Studio / Editar no Studio · Continue without a harness / Continuar sem harness.

## Workspace chip

**Purpose.** Where this chat works (the workspace folder, passed as the working directory; stored as a Cowork project).

**Anatomy.** A `Combobox` trigger: a 13px folder icon and the folder name (up to 180px), named `Working folder: {name}`. Options: "No folder" (detail "runs in a scratch directory") and each project with its path; the footer "Add folder…" opens the OS dialog in the desktop app and says "Available in the desktop app" in the browser preview.

**States.** none chosen (No folder, an honest option, not an error), chosen, adding, add failed ("Couldn't add that folder — try again").

## Subagents toggle

ADR 0027. **Purpose.** Allow the next turn to hand tasks to subagents.

**Anatomy.** A ghost `sm` Button used as a switch: `role="switch"`, `aria-checked`, the label "Subagents on" or "Subagents off", tooltip "Let this turn hand tasks to subagents". Off by default; harness-off turns only.

**Use.** The tree that results is in `run-surfaces.md`.

## Token ceiling

ADR 0025. **Purpose.** Stop a run that reaches a token total.

**Anatomy.** A label "Token ceiling" (`t-meta`), a numeric text field (`inputMode="numeric"`, placeholder "none", 96px, `line-strong` edge), and an inline `fault-text` message that says what the run uses when the entry is invalid: "{reason} The run uses {n} tokens." or "...no ceiling." An invalid entry never replaces the last valid ceiling.

**States.** empty (no ceiling), valid, invalid (`aria-invalid`, `role="alert"`). Hidden while a harness runs the turn (a per-run ceiling does not apply there yet). The range comes from `runBudgetRules.ts`, mirrored from the backend and pinned by a test.

**Result.** A run that reaches it ends as "Budget exceeded" in the Runs panel.

## Tool hooks

ADR 0026. **Purpose.** Register a program that must exit 0 before a tool runs; anything else blocks it.

**Anatomy.** A ghost "Tool hooks" button opens a `Sheet` with a short explanation ("It must exit 0 for the tool to run; an error or a timeout blocks it. Hooks run without a shell and without your secrets."), the registered hooks as a list (id, tools, timeout, a Remove button; a row that no longer validates says "blocks every tool until replaced"), and a form: Hook id, Program (full path), Arguments (one per line), Timeout (seconds), "Runs before" checkboxes, **Save hook**.

**States.** empty ("No hooks yet."), saved, invalid entry (message above the form), sidecar unavailable ("Hooks are unavailable right now."), removal failed ("Could not remove the hook."). A blocked tool shows "hook {id}: blocked ({reason})" on its card.

**Don't.** Offer to run a hook from the workspace (hooks are registered only through the authenticated sidecar); a shell field.

## Message actions

Under an assistant or user message: ghost `sm` buttons **Copy message** and **Reuse message**, then a polite "Copied" or an alert ("Could not copy. Select the message text and copy it manually."). Reuse puts the text back in the composer and is hidden while a turn runs.
