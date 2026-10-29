# Run surfaces

How a run looks while it happens and after it. Code: `components/agent-run/*` and `components/brand/ThinkingStatus.tsx`, shown inside the chat stage (`agent/AgentStage.tsx`) and Studio's run panel. Decisions: ADR 0017 (`oharness run`, headless), 0018 (resume and fork), 0021 (permission presets), 0024 (turn diff), 0025 (token ceiling), 0026 (hooks), 0027 (subagent tree).

**The marker scale.** Run surfaces mark state with small squares and dots beside a name, never with colour alone. Sizes are 5, 7 and 9px by design (audit D4): a 9px square for a step on the spine, a 7px square for a transport state, 5px for a tool-row bar or an inline dot. **Shape carries state, colour carries role**: a diamond with a `warn` edge is a gate; a filled `fault` square is an error; a hollow square with a 2px role-hue edge is running; a filled role-hue square is done; a dashed `ink-faint` square is a branch not taken; a small hollow `ink-faint` square is pending. A run reads correctly in a screenshot and to someone who cannot separate the role hues.

## Transcript

**Purpose.** The record of one run as a vertical spine of steps (the nodes of a harness, or the single turn of a direct chat).

**Anatomy.** Per step: a marker on the spine (above), the step's name in `t-title`, its state word in `t-meta` (`signal-text` running, `ink-mute` done, `warn-text` waiting, `fault-text` failed), then blocks in order: reasoning (collapsible), the answer in `t-reading` at most 68ch, tool rows, tool cards. A **tool row** is one line: a 2px state bar (`signal` pending, `fault` failed, `ink-faint` done), the tool name, the arguments dimmed and ellipsised (expand when long), the result and its duration on the right edge in mono. Several consecutive calls roll up into a group with a count.

**Roll-up and latency.** At the end, a one-line roll-up (elapsed, tokens, nodes) and a **per-node latency and token table** as a real table. Badges mark a node **pinned** to a connection and a node that **failed over** to another (they are deliberately different). A route decision shows its provenance.

**States.** idle ("No run yet — the plan appears here" in the ladder), running (a live step is pulsing; the answer streams in place without re-mounting earlier steps), gate, error, complete, stopped, saved (replayed from the journal, `Complete history`, `Partial history — the run may have been interrupted.`, `Legacy history — capture coverage is unknown.`).

**Accessibility.** The log region is `role="log"` with `aria-busy` while live; the live answer is a labelled region; the spine markers are `aria-hidden` because every step has the state in words; a long arguments string is a real `<button>` that expands.

**Scroll.** Streaming never moves the scroll position unless the person is already at the bottom.

## Tool card and approval

ADR 0021. **Purpose.** A tool call the broker needs a person to decide on, or a call that was refused, simulated or run. It is a security surface (the approval-fatigue threat), so it is a full card, not a log line.

**Anatomy.** A `radius-panel` card on `sub-200` whose edge says the state: `line-soft` normally, `warn` while waiting for approval, `fault` for high risk. Header: the action in plain words ("Run command", "Read file", "List workspace"), "requested by the model" or "requested by you", an "auto-approved: {mode}" chip when a mode let it run, a **high risk** chip (`fault` fill with `fault-ink` text, the token for text on a fault fill; `signal-ink` is dark in Graphite and fails there; uppercase allowed, one word) and the state on the right. Body: the argv, **one item per line** in mono so nothing hides in a long string; the path; "Risk pattern:" hints; one sentence about what the call is ("This runs locally with your privileges; there is no system sandbox. It runs only if you approve."). Footer: **Approve** (primary) and **Reject**, and an optional note that stays in the history. After: exit code, "output truncated", "{n} secrets redacted", the result in a mono block that expands past 240 characters.

**States (word → tone).** waiting for approval (warn), approved, running (signal), done, failed, timeout, simulated (mute), rejected, no answer, blocked, blocked by hook (fault). Auto-approval names the mode: "workspace mode" or "{preset} preset".

**Don't.** Colour the Approve button by risk (high risk changes the card's edge and adds the chip; it is never a blocker); hide the argv; collapse a pending approval.

**Accessibility.** Buttons are real buttons and become disabled once sent ("sending…"); the note has an `aria-label`; a control only ever targets the live run (a replayed run shows no approve buttons).

**Copy.** Approve / Aprovar · Reject / Rejeitar · waiting for approval / aguardando aprovação · auto-approved: Auto preset / aprovado automaticamente: preset Auto · This path looks like it contains secrets. It is read only if you approve. / Este caminho parece conter segredos. Só é lido se você aprovar.

## Human gate

**Purpose.** The one place the machine stops and cannot continue without a person; the decision must survive.

**Anatomy.** Open: a `radius-panel` card on `sub-200` with a `line` edge and a hazard-hatched strip on top (the only hatching in the product), the label "human gate" in `warn-text`, "the run is blocked here", the question in `t-title`, a toggle "show what it is asking you to approve" (the context, clipped at 260 characters), a note field (`oh-inset`) focused on arrival, **Approve & continue** (primary, with the Enter key) and **Reject & end run** (danger), and "nothing downstream runs until you answer". Resolved: it collapses to one permanent line, "Approved by you — “{note}”" or "Rejected by you", with a 2px bar (`fault` when rejected).

**Accessibility.** The note takes focus when the gate opens; Enter approves, Shift+Enter is a new line. The resolved line is text, not a colour.

**Don't.** Auto-dismiss; reuse the hatching for anything else.

## Transport bar and run ladder

**Anatomy.** A 34px bar: a 7px state square and the state word (`t-label`), a divider, then **one primary that changes with the run**: Run or Run again when idle, Step when a run is parked; while running the only button is **Stop** (danger, tooltip "Stop after the current node"). Metrics on the right, mono and tabular so digits do not shuffle: elapsed, tokens, nodes (`3/7`). State words: idle, opening, running, waiting on you, parked, stopped, complete, faulted.

The **run ladder** under it is the plan as one bar (`role="progressbar"`, "Harness plan progress"): a 3px rung per step in the step's role hue, filled as it completes, an outlined rung when skipped. It doubles as a legend for the markers in the transcript.

**Don't.** Four fixed buttons three of which are dead; invented progress when the plan is unknown (the ladder says "No run yet — the plan appears here").

## Token ceiling and budget stop

The field is in `composer.md`. A run that reaches the ceiling ends with the explicit status **Budget exceeded** (never "failed"), shown in the transport state, the Runs panel and the saved detail. Compaction of older tool results (`context_compacted`) is silent to the person: the transcript is unchanged.

## Runs panel (Activity)

ADRs 0017 and 0018. **Purpose.** Every execution in one list, wherever it started (a chat with a harness on, a direct chat, a Studio test run).

**Anatomy.** A shell `Panel` titled "Activity" with a Refresh icon button. Rows grouped by day (`ListGroup`), each `ListRow`: title (harness name, "Direct chat" or "Ad-hoc run"), subtitle (`Direct · ` + status + duration), one `StatusDot` (pulsing while running). Statuses include "Budget exceeded" and "Interrupted". Opening a row shows its detail: Status, Started, Duration, **Saved outputs** (or "This run kept no output."), the history coverage line and the event count.

**Resume and fork.** A run with a partial journal that is no longer running (interrupted, stopped, failed) shows "Continue this harness run as a new run; its saved events stay as they are." and **Continue as a new run**. The result is a new, linked run: "New run created from event {n} ({id})." and on the new run, "Continues run {id} from event {n}." The original is never edited. A complete run offers nothing.

**States.** loading ("Loading…"), empty ("No activity yet." + "A chat with the harness on, or a test run in Studio, shows up here."), error ("Couldn't reach the activity log"), detail error ("Couldn't load this run"; "Couldn't load this saved output. Try again."), continue failed ("Couldn't continue this run. Try again.").

**Known gaps.** The list loads with plain text instead of `SkeletonRows`, and the Refresh button is a hand-made 24px icon button; both move to the primitives when the Panel merge lands (audit D6).

## Saved run detail

**Purpose.** The run behind a chat message, rebuilt after a reload by replaying the persisted event log through the same reducer the live view uses, so the live and the saved view render identically.

**Anatomy.** One control, **Show run detail** / **Hide run detail** (`aria-expanded`, `aria-controls`), shared by the in-flight stage toggle and the per-message toggle so both speak the same words. The revealed region is labelled.

## Subagent tree

ADR 0027. **Purpose.** Show the parent turn and the children it started, each cancellable on its own.

**Anatomy.** A `section` named "Subagents" on `sub-100` with a `line-soft` edge: "Nilo" (`t-label`) and the run status, then a list under a 1px left rule, one row per child: the task (truncated), its state in words (`running` in `signal-text`, `done` in `ink-dim`, `cancelled` in `ink-mute`, `error` in `fault-text`; `aria-live="polite"`), "{n} chars" while running, and **Cancel** (only while running and the run is live; `aria-label` names the task).

**States and honesty.** Cancelling one child leaves the parent and its siblings running; the model receives "subagent cancelled by the user". If the child had already finished: "This subagent already finished, so nothing was cancelled." If the call failed: "The cancel did not go through. Try again." (`role="alert"`). A run that ends settles any child still shown as running to cancelled. Limits: four children, 300 s each.

**Don't.** A tree deeper than one level (children have no children); a cancel for the whole run inside the tree (Stop is in the transport bar).

## Turn diff

ADR 0024. **Purpose.** What a turn changed in the workspace, with a one-shot revert for each file.

**Anatomy.** A `section` named "Files this turn changed", indented to the spine (24px gutter), `line-soft` edge on `sub-100`, `t-label` heading. One row per file: the path (truncated), its status (added, modified, deleted), `+{added} −{removed}` in `t-meta` (not for binary), a **Diff** toggle (`aria-expanded`, `aria-controls`, `aria-label` "Show diff for {path}") that reveals the unified diff in a `pre` (with "… diff truncated"), and **Revert**. After a revert the button is replaced by the word "reverted".

**States and reasons.** A limit hit shows "This workspace is too large to track completely, so the list may be missing files." in `warn-text`. A file that cannot be reverted says why in place: "binary — no diff, cannot be reverted" or "earlier content not kept — cannot be reverted". A refused revert states the reason (`role="alert"`): "This file changed after the turn, so it was left as it is.", "Already reverted.", "A link on the path blocks the revert, so nothing was changed.", "The earlier content was not kept, so it cannot be restored.", "This change is no longer recorded." More than the listed files: "and {n} more files". There is no "revert all".

**Copy.** Revert / Reverter · Diff / Diff · Hide diff / Ocultar diff · reverted / revertido.

## Thinking status

**Purpose.** Live run status that is personable at the top and honest at the bottom.

**Anatomy.** A face-crop Nilo at 2px per cell, a rotating verb (thinking: Thinking, Hooting, Pondering, Perching on it, Preening the plan, Untangling, Weaving the harness; working: Working, Wiring nodes, Running checks, Typing furiously, Building; waiting: Waiting for you), a `detail` sentence ("Walking the harness graph.", "Waiting on the provider.") and, quietest, mono tabular digits in `ink-mute` for elapsed time and tokens. Three tiers: personality, current step, raw metrics. The moving parts are `aria-hidden`; assistive tech hears one stable `role="status"` line, "OHarness is working". It keeps no clock and never invents a reading: without a token count no token segment renders (never "0 tok").

**Nilo's state.** `thinking` while the provider works, `waiting` while a gate holds the run. See `../brand.md` § Nilo in the run and chat states for the full mapping.

**Reduced motion.** One still pose per state; the verb still changes every three seconds, as text.
