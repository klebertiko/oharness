# Ledger — AUTOMATE-GAUNTLET

Date: 2026-09-17. Lead agent running the `gauntlet-loop` skill per `references/running-the-loop.md`.
Scope: make the Automate screen (`frontend/src/components/automations/AutomationsPanel.tsx` +
backend scheduler/automations router) actually execute real automations instead of
`mock_execute`, with genuinely intuitive/capable UX inspired by real competitor flows — user's
own words: "vamos arrumar tela de automate para ela funcionar de verdade... fazer um melhor UX
DX intuitivo fácil de usar e altamente capaz eficaz e eficiente em automatizações reais e
verdadeiras." Simulation must stay explicitly, visibly separate from real execution at all times
— user was explicit and repeated this.

Progress page (live, updates after every verdict): https://claude.ai/artifact/NMatPP51aVq1odHSRANxvy
("Trigger & Truth" — checked `https://claude.ai/artifact/XxQXFAszaBfQ6aJuBGQtqC` ("OHarness
Gauntlet") first since it shares this project's 🥊 favicon; read it and confirmed it's a
different, unrelated 2026-09-04 run — desktop shell/canvas/agent-UX/providers build-out, 1/4
pieces won, still mid-flight on its own pieces. Not reusable; published fresh rather than
clobbering it.)

## Coordination check (done first, per task brief)

Read `.gauntlet/automate-story.md`, `.gauntlet/automate-recovery.md`,
`handoffs/2026-09-15-oharness-ajustes-codex-para-sonnet.md` (section 5, "Automate: execução
real" — Codex proposed taking this scope but its own doc says explicitly "ainda não concluídas",
a proposal not a lock), and the sibling `story-CONNECTION-CONTEXT-GAUNTLET/ledger.md` (precedent
for format + the mid-flight-second-bar rule).

`git status` (entire repo dirty — this checkout never commits) + `ls -la --time-style=full-iso`
mtimes at recon time (now 2026-09-17 04:51 local):
- `backend/automations/scheduler.py`: **09-09** (oldest of the group — untouched 8 days).
- `backend/routers/automations.py`, `backend/models.py`, `backend/tests/test_scheduler.py`:
  **09-15** (matches Codex's handoff timing exactly — this is the honest-mock-labeling +
  gap-documentation commit `.gauntlet/automate-recovery.md` describes, not real-execution wiring).
- `backend/main.py` (scheduler construction site): **09-13** — untouched since before the
  handoff even existed.
- `frontend/.../AutomationsPanel.tsx`: **09-13**.
- `backend/engine.py` / `backend/routers/execution.py`: **09-16** — confirmed via direct
  SendMessage to `fix-studio-mock-execution` (the agent whose name suggested possible overlap)
  that this is its own Studio-canvas mock-mode fix, not Automate; it explicitly confirmed it has
  not opened `scheduler.py`, `routers/automations.py`, or `main.py`'s scheduler construction.
- `fix-chat-workspace-gap` confirmed no overlap either (scoped to `triage.py`/SOUL.md only).
- Coordinator ("main") independently confirmed: `story-AUTOMATE-GAUNTLET` is genuinely fresh
  (checked before dispatch), the sibling gauntlet's "Codex owns Automate, do not touch" note is
  stale 2026-09-16 recon, and Codex's handoff is a proposal — told to verify disk state myself
  rather than trust either claim, which the mtimes above do: **zero activity on any
  automation-execution file in the 2 days since the handoff. Confirmed clear to proceed.**

**Conclusion:** real, open, non-duplicate work. `.gauntlet/automate-recovery.md`'s prior pass
already made the *simulation* honest (AC1: UI must never claim a live run or success from a
timestamp alone) and explicitly scoped out "scheduler expansion" — that gate must not regress
while this run adds the real-execution half it deliberately deferred.

## Bars fetched (real, this session — see Sources below)

- **Zapier** (already the established candidate bar per prior handoffs — reconfirmed live, not
  from memory): fetched `help.zapier.com`'s own current "Set up your Zap trigger" and "View and
  manage your Zap history" articles (both live-fetched + one screenshotted at
  `help.zapier.com/hc/en-us/articles/8496288188429`, page dated "Updated 3 months ago" — genuinely
  current). Trigger setup: App → Event → Account connect → Configure tab (required fields marked
  with a trailing asterisk) → Test tab → **Test trigger** pulls real sample data, pick a record,
  **Continue with selected record**. Zap History: list (≤10/page), filter by date/Zap
  name/app/folder/owner/status; statuses success/filtered/held/stopped/playing/waiting/errored;
  drill-in shows Zap version + timestamp + full data in/out per step; **Replay** only offered for
  unsuccessful runs (a successful run can't be replayed, only re-fired from a fresh trigger event);
  history is also reachable from inside the editor's own sidebar, not just a separate page.
- **n8n** (added as a second bar — reasoning below): fetched `docs.n8n.io`'s Schedule Trigger node
  page and (after two stale-URL 404s, corrected via fresh search) its executions docs. Schedule
  Trigger: 6 interval types (seconds/minutes/hours/days/weeks/months) + custom cron, **explicit
  timezone resolution priority** (workflow-level setting → instance timezone, with a real stated
  default and Cloud auto-detect behavior), **missed-execution handling** as a named setting
  (don't-run / run-most-recent / run-most-recent-per-rule, configurable grace period). Executions:
  list filterable by workflow/status(Failed/Running/Success/Waiting)/start time; failed rows get
  a retry action (current config or as-saved); "workflow history" (versions) is explicitly a
  **different concept** from "executions" (runs) — two lists, not one. Manual execution
  (canvas "Execute workflow" button) is functionally distinct from production (trigger-fired) but
  — important nuance, stated honestly — n8n's manual execution is **still real**, not a mock/fake
  mode; n8n has no true zero-cost simulate mode the way OHarness's own `mock` adapter does.

**Second-bar reasoning (logged, not silently swapped, per the skill's rule and this project's own
precedent for adding one mid-flight):** OHarness automations run *harness graphs* — the same
node/edge/schedule shape as an n8n workflow, not Zapier's single linear app-trigger→app-action
Zap. n8n's schedule-trigger taxonomy, timezone transparency, and Executions-vs-History split are
directly, structurally comparable to what this screen needs; Zapier remains the stronger bar for
setup-flow clarity (required-field marking, real test-data preview before you commit) and for
History's drill-in/replay UX. Both stay in play; each piece's critic uses whichever bar (or both)
is the more relevant comparator, stated in that piece's brief.

**Real-vs-simulation honesty has no external bar at all** (logged now, shapes the Gate below):
neither Zapier nor n8n has a genuine zero-cost "this doesn't really call anything" preview mode —
Zapier's Test pulls real sample data, n8n's manual execution is a real run. OHarness's `mock`
adapter (Studio's own authoring/testing mode, confirmed in `routers/execution.py`'s comments) is
a bar-*exceeding* feature, not something either competitor demonstrates. So honesty-of-labeling
can't be blind-judged against either bar — it's a pass/fail gate, same reasoning the sibling run
used for its own preservation gate.

Sources: help.zapier.com/hc/en-us/articles/8496288188429-Set-up-your-Zap-trigger;
help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history;
docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger;
docs.n8n.io/build/understand-workflows/understand-executions/view-all-executions;
docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow.

## Recon — key facts that shaped the piece plan (fresh reads, this session)

- **`AutomationJob` has no instruction/prompt field and no connection field at all**
  (`backend/models.py:69-81`: id, name, cron, project_id, harness_bundle_id, harness_enabled,
  status, last_run_at — that's the whole row). A harness-enabled job is fine — the harness graph's
  own `input` node already carries a stored prompt, exactly like a normal harness run
  (`routers/execution.py`'s `_apply_instruction` docstring). But **"Direct — no harness" jobs have
  nothing to execute** — no prompt, no chosen connection. Real execution literally cannot do
  anything for that path until this is fixed. This is a genuine data-model gap, not just a UI gap.
- **The create/edit form never sets `projectId` either** — `AutomationsPanel.tsx`'s `Detail`
  component has no project/cwd picker at all, even though the field exists on the model and
  `routers/execution.py`'s `_validated_project_cwd` is exactly the function that would turn it
  into a real, validated cwd. `WorkspacePicker.tsx` (chat composer's own project picker) is the
  pattern to reuse, not rebuild.
- **The real-execution primitives already exist and are proven in production** (`routers/execution.py`):
  `resolve_node_provider` (raises `ProviderResolutionError` — the house rule, confirmed also by
  `fix-studio-mock-execution` directly: never silently falls back to mock), `get_adapter`,
  `usage_tracking.enforce_budget_or_raise`, `_validated_project_cwd`, `engine.execute_harness`,
  `usage_tracking.record_usage`/`record_usage_rows`, `providers.outcomes.failure_details`
  (structured auth/transport/generic error mapping). Piece 1 and Piece 6 must **reuse these
  exactly**, not reinvent parallel logic — that reuse is itself part of what "real" means here.
- **Run history is not persisted at all.** `scheduler.py`'s `run_job` stashes
  `job._last_result` with an explicit comment "not persisted" — only `status` and `last_run_at`
  survive; a restart loses every result detail, and there has never been more than one
  attempt's worth of history to look at. Neither fetched bar has this limitation.
- **A ready-built, unused helper already solves half of Piece 3**: `scheduleCron.ts`'s `nextRun()`
  exists (daily/weekdays/hourly) but `AutomationsPanel.tsx` never imports it — the Trigger section
  only calls `describeSchedule`/`parseSchedule`/`toCron`. Same "already built, never wired" pattern
  the sibling run found with `RunControls.tsx`.
- **Existing pinned tests currently assert the mock behavior as correct**
  (`test_scheduler.py::test_run_now_endpoint_mock_execute`,
  `::test_run_now_ignores_an_exhausted_budget` — the latter's docstring is itself a precise,
  intentional description of today's gap). These are exactly the RED tests Piece 1 must confront:
  either they get superseded by new tests pinning real-mode behavior while a still-real
  test/simulate path keeps the $0-budget-doesn't-block-a-mock-run guarantee, or they're rewritten
  deliberately — never silently deleted.
- **`.gauntlet/automate-recovery.md`'s AC1 is already won** (simulation is honestly labeled,
  UTC is disclosed, last-attempt-unknown renders correctly) — this is the Gate's starting point,
  not a piece to re-win from scratch.

## Piece decomposition (6 blind-judged pieces + 1 pass/fail gate)

1. **Real execution engine** — `backend/automations/scheduler.py`, `backend/routers/automations.py`
   (`/run` wiring), `backend/main.py` (scheduler construction), `backend/tests/test_scheduler.py`.
   Bar: n8n "Execute workflow" reaching real nodes / Zapier "Test action" hitting a real API —
   judged on whether a run genuinely reaches a real adapter with no silent mock fallback, honest
   error on failure, budget-gated, using the same resolver/cwd/ledger as the rest of the app.
2. **Action definition (creation/edit flow)** — extends `AutomationJob`/`JobCreate`/`JobUpdate`
   with instruction + connection for Direct-mode jobs, adds the missing project/cwd picker
   (reusing `WorkspacePicker.tsx`), `AutomationsPanel.tsx` Detail form. Bar: Zapier's
   Setup/Configure/Test tabs (required-field asterisks, real test-data preview) / n8n's node
   parameter panel.
3. **Trigger/schedule configuration UX** — `frontend/src/lib/scheduleCron.ts`,
   `AutomationsPanel.tsx` Trigger section. Bar: n8n's Schedule Trigger (interval taxonomy +
   explicit timezone transparency) vs today's static "Schedules use UTC" sentence and unused
   `nextRun()`.
4. **Execution history & results** — new persisted run-history (backend model + endpoint +
   scheduler write), `AutomationsPanel.tsx`'s "Last attempt" tab becomes a real history list.
   Bar: Zapier's Zap History (drill-in: version, timestamp, full data in/out) / n8n's Executions
   list (status filter, retry).
5. **Manual run / test affordance** — distinct, honestly-labeled "Run now" (real) vs "Test /
   Simulate" (mock, free) controls. Bar: n8n's manual Execute Workflow (real, ad-hoc) / Zapier's
   Test-before-Publish step.
6. **Error & failure handling** — structured, actionable failure per run (auth / transport /
   budget-exceeded / unresolved-connection / invalid-cwd), reusing `failure_details` and the
   app's existing vocabulary rather than a bare "error" string. Bar: Zapier's per-step error +
   replay / n8n's retry-with-current-or-saved-config.

**Gate — Real-vs-simulation honesty (checked pass/fail across pieces 1/2/4/5, not blind-judged —
no external bar has this shape, reasoning above):** at every surface — list status dot, detail
tab, both run buttons, every history row — mock/test results must be visually and textually
unmistakable from real ones; never claim a live run or success from a timestamp alone. Carries
forward `.gauntlet/automate-recovery.md` AC1; must not regress it while wiring real execution in
alongside it.

## Build sequencing (stated, not assumed — file topology forces it)

Unlike the sibling run's cleanly disjoint files, almost every piece here touches
`backend/routers/automations.py` and/or `AutomationsPanel.tsx`. Dispatching all 6 as independent
parallel builders would race the same files. Resolution: pieces stay independently **judged**
(separate fresh critic per piece, as the skill requires) but builder **dispatch** is batched by
real file/data dependency, same principle the sibling ledger used when it sequenced its piece 2
behind piece 1 for sharing one file:

- **Wave 1 (now, parallel — genuinely disjoint files):** Backend-pass builder, Piece 1 → 2(backend
  half) → 4(backend half) → 6(backend half) in that causal order (2's new fields feed 1's
  execute_fn; 4's history needs 1's real result shape; 6's error classification needs 1's real
  failure paths — one coherent backend agent, red→green per slice, beats four agents fighting over
  `scheduler.py`/`automations.py`/`models.py` at once). **Piece 3** builder in parallel — pure
  frontend, zero backend dependency, scoped strictly to the Trigger section of
  `AutomationsPanel.tsx` + `scheduleCron.ts` only.
- **Wave 2 (after Wave 1 backend-pass + Piece 3 both report done):** Frontend-pass builder, Piece
  2(frontend half) → 5 → 4(frontend half) → 6(frontend half), each its own TDD slice, each
  independently critiqued as it lands.
- Each piece gets its own fresh-context critic the moment its slice (backend+frontend as
  relevant) is complete — critics only read/test, never edit, so they run freely regardless of
  what else is still building.

**Blinding caveat, stated up front (known limitation in this environment, per the sibling ledger's
own experience):** this session's browser tooling has no reliable region-crop, so pixel-level
blind A/B isn't fully achievable when a critic can see a localhost URL next to a public product
URL. Mitigation: critics are told to judge only the specific control/flow in question and
disregard any branding/URL they notice, and for the more behavioral pieces (1, 6) the comparison
leans on fetched documented behavior/evidence rather than a pure screenshot diff. Logged so no
verdict here is over-trusted as fully rigorous.

Next entries in this file log each round's WINNER/GAP/EVIDENCE verdict, and Wave dispatch status,
as they land.

## Resumption — post rate-limit death (2026-09-17, ~09:17 local)

Prior session died mid-dispatch before Wave 1 builders were actually spawned. Re-verified every
Wave-1-target file's mtime just now against this ledger's own 04:51 recon: identical to the
second on every file (`scheduler.py` still 09-09 06:37; `routers/automations.py`/`models.py`/
`test_scheduler.py` still 09-15 ~07:21-23:22; `test_cowork_automations_api.py` still 09-15
23:21:51 exactly; `AutomationsPanel.tsx` still 09-13 20:28; `execution.py`/`engine.py` still
09-16, already attributed above to `fix-studio-mock-execution`, not Automate). **Zero new
activity — nothing landed before the death.** Decomposition, bars, and sequencing above stand
as-is; not re-derived. Live progress page unchanged (still 0/6, pieces 1 &amp; 3 marked
"building" from before the death) — left alone rather than republished on a timer; will update
on the first real verdict, per the skill's own rule.

**Second coordination artifact found, not caught by the original check:**
`.harness/sprint-2026-09-15/story-AUTOMATE-REAL/story.md` (mtime 09-15 02:56 — predates even the
Codex handoff doc the original pass read) claims "Status: In Progress", user sign-off ("pode
fazer"), and ownership of `backend/automations/*`, `routers/automations.py`, automation
tests/UI under named owners "Kepler" (that scope) / "Pascal" (usage/budget model) / "Parent"
(engine.py/execution.py). Judged **stale, not a live claim**, on four points: (1) no
`ledger.md`/`qa.md`/evidence exists for it, unlike every other actively-worked story in this same
sprint folder — only the original story.md, untouched since creation. (2) "Kepler"/"Pascal"
appear nowhere else in the repo (`grep -r` — one file, zero other hits) — no ledger, commit, or
handoff corroborates either name doing anything here. (3) Its claimed files show zero mtime
activity beyond the single 09-15 23:21 honest-mock-labeling commit already accounted for above —
no AC-by-AC progress (no new history-model module per its AC5, `scheduler.py` per its AC6 still
8 days stale). (4) Substantively this reads as the same 09-15 Codex proposal
(`handoffs/2026-09-15-oharness-ajustes-codex-para-sonnet.md` §5) the original coordination
check already read and correctly weighed as "a proposal, not a lock" — just also filed as a
story.md that pass didn't enumerate. This session's live-agent roster (`main`,
`fix-studio-mock-execution-v2`) has no Kepler/Pascal to coordinate with. Logged rather than
silently ignored; flagged again in the resumption report to main.

**Proceeding to Wave 1 dispatch now** — backend-pass builder (piece 1 → 2(BE) → 4(BE) → 6(BE))
+ piece 3 builder, in parallel, per the plan above, unchanged.

## Wave 1 — piece 3 progress

### 2026-09-17 (third dispatch attempt) — green, integrated, strictly scoped

Recon before coding, per the task's own sequencing rule: re-checked `git status` and mtimes
against this ledger's own resumption recon — identical (`scheduleCron.ts` still untracked,
2026-09-10 20:56; `AutomationsPanel.tsx` still modified, 2026-09-13 20:28). No new activity;
clear to proceed. First action after that check was writing one failing test (below) — no
broader investigation or design writeup before it existed and was confirmed RED.

**Files touched** (all within the mandated scope — `scheduleCron.ts` + the Trigger section only
of `AutomationsPanel.tsx` — Harness configuration, buttons, and the Last-attempt tab were not
touched):
- `frontend/src/lib/scheduleCron.ts`
- `frontend/src/lib/scheduleCron.test.ts`
- `frontend/src/components/automations/AutomationsPanel.tsx` (Trigger section + its two imports)
- `frontend/src/components/automations/AutomationsPanel.test.tsx`

**Test commands + results:**
- Mandated first slice, written and run alone before any implementation: new test "shows a real
  UTC next-run time for a daily schedule, computed via the wired nextRun helper" in
  `AutomationsPanel.test.tsx` → confirmed RED (`getByText(/Next run/)` found nothing — the Trigger
  section imported no such helper yet). Full command + tail of that solo run is in this session's
  transcript.
- `npx vitest run src/lib/scheduleCron.test.ts` → **7/7 passed** (after fixing a real bug found
  while wiring — see below; one new UTC-explicit assertion was genuinely RED first: "expected 11
  to be 8", i.e. exactly this machine's UTC-3 offset, before the fix).
- `npx vitest run src/components/automations/AutomationsPanel.test.tsx` → **4/4 passed** (1
  pre-existing test deliberately updated, not silently broken — see below; 1 new slice-1 test; 1
  new manual/custom honesty test).
- `npx vitest run` (full frontend suite) → **300/301 passed.** The 1 failure is the pre-flagged,
  not-mine `Dossier.test.tsx` credential-length test. 2 other suites failed to resolve
  `./pinnedConnection` / `./rollup` imports under `src/components/agent-run/` — checked mtimes:
  both test files were written at 14:26 local, the same minute as this piece's own test runs —
  another agent's in-flight RED state on unrelated files, not caused by or related to this piece.
- `npx tsc --noEmit` → 2 pre-existing errors, both in the same unrelated `agent-run/*.test.ts`
  files above (consistent with their missing-module failures). Zero typecheck errors in any file
  this piece touched.

**Deliberate pinned-test change (not silent):** `AutomationsPanel.test.tsx`'s first test asserted
`getByText(/Schedules use UTC/)` against the old static sentence. That sentence is gone — UTC is
now disclosed at the point of use instead of a footnote. Updated the assertion to check the time
input's new `aria-label="Trigger time (UTC)"` and the computed `"09:00 UTC"` next-run text for the
same fixture job, which is strictly more meaningful (proves real computed disclosure, not just a
label's presence).

**What a fresh blind critic needs to know, judged against the fetched n8n Schedule Trigger bar:**

1. `nextRun()` is now actually imported and rendered — the Trigger section shows a computed
   "Next run: …" line for daily/weekdays/hourly schedules, where before it showed nothing but a
   static UTC disclaimer.
2. **A real, verified latent bug was found and fixed while wiring this in, not invented for
   flavor:** `nextRun()` previously computed using the browser's *local* `Date` getters/setters
   (`setHours`/`getDay`, etc.), but `backend/automations/scheduler.py`'s `cron_matches` (read
   directly, not assumed) matches the cron's hour/minute fields against
   `datetime.now(timezone.utc)` — i.e. the HH:MM a person picks is a UTC time server-side, not
   their local time. Left as-was, a wired-in "Next run" preview would have been confidently wrong
   by the viewer's UTC offset — worse than the static disclaimer it replaced. Fixed `nextRun()` to
   compute in UTC throughout (`setUTCHours`/`getUTCDay`/etc.); confirmed via a test that was
   genuinely red against the old implementation ("expected 11 to be 8" — exactly this machine's
   UTC-3 offset) before the fix.
3. Next-run is now shown as **both** the UTC clock time and the viewer's own resolved local time
   + IANA zone name (`Intl.DateTimeFormat().resolvedOptions().timeZone`, e.g.
   "America/Sao_Paulo") via a new `formatNextRun`/`localTimeZoneLabel` pair in `scheduleCron.ts` —
   this is the piece's answer to the bar's "explicit timezone" criterion. **Honest limitation,
   stated plainly:** OHarness has no per-job or instance timezone *setting* at all (confirmed —
   `AutomationJob` has no such field, scheduler always runs in UTC) — so unlike n8n there is no
   workflow-setting → instance-timezone → Cloud-auto-detect *resolution chain* to expose. There's
   exactly one fixed reality (always UTC), and the UI now states that plainly and shows what it
   means in the viewer's own clock, rather than fabricating a selector with nothing behind it.
4. The time input itself now carries the UTC label directly (a visible "UTC" suffix plus
   `aria-label="Trigger time (UTC)"`), not just a separate footnote sentence — closer to n8n's
   pattern of disclosing the relevant fact at the point of entry, and an accessibility improvement
   in its own right (previously the only accessible name came from the loose surrounding "at"
   label text).
5. Manual (on-demand) and custom-cron kinds each get an explicit, honest statement instead of
   silence or a guess: manual — "No scheduled next run — this automation only runs when you start
   it."; custom — "Next run isn't previewed for custom cron — it still evaluates in UTC on the
   server." `nextRun()` returns `null` for both, by contract, and the component never calls
   `formatNextRun` on a null.
6. **Real gaps against the bar, not hidden:** (a) n8n's 6-interval taxonomy
   (seconds/minutes/hours/days/weeks/months) is not matched — `KINDS` is still
   manual/daily/weekdays/hourly/custom, unchanged; widening it means new `toCron`/`parseSchedule`
   shapes, judged outside this piece's named gap (wire up `nextRun()` + timezone transparency) and
   not attempted. (b) Missed-execution handling (n8n's don't-run / run-most-recent /
   run-most-recent-per-rule + grace period) is not implemented — there is no backend field to
   persist such a setting and this piece is deliberately zero-backend-dependency; a UI control for
   it would be a decorative toggle that saves nothing, judged a worse Honesty Gate violation than
   the gap itself, so it was left out rather than faked.

Not self-critiqued further — a fresh-context critic judges this blind against the fetched n8n bar
per the skill's rule.

## Wave 1 — dispatched (2026-09-17, ~14:14 local, third attempt)

Re-verified both target mtimes myself immediately before dispatch, independently of the
09:17 resumption note above — identical to the second: `backend/routers/automations.py`
2026-09-15 23:22:07 (still untouched, ~38.8h), `frontend/src/lib/scheduleCron.ts` 2026-09-10
20:56:46 (still untouched, ~6.7 days). Zero new activity. Confirmed dev servers already running
(:3000 frontend, :8000 backend, both LISTENING with established connections) — builders instructed
not to start new ones. Progress page re-read and left as-is (still 0/6, pieces 1 &amp; 3
"building") — updates only on a real verdict, not on this dispatch itself, per the skill's rule.

Dispatched, both backgrounded, both instructed to get a RED test for their first slice on disk
*before* any broader investigation or design writeup (given two straight rate-limit deaths pre-code):

- **`automate-be-wave1`** (harness-be) — backend halves of pieces 1 → 2 → 4 → 6, causal order, one
  coherent TDD pass, `backend/**` only. Told to checkpoint this ledger under a
  `## Wave 1 — backend pass progress` section after each piece slice goes green, not only at the end.
- **`automate-fe-piece3`** (harness-fe) — piece 3 only, `frontend/src/lib/scheduleCron.ts` +
  `AutomationsPanel.tsx` Trigger section only, strictly scoped to avoid colliding with Wave 2's
  later frontend work on the same file. Told to checkpoint under `## Wave 1 — piece 3 progress`
  when green.

Both told: reuse `routers/execution.py` primitives (piece 1/2/4/6), wire the existing unused
`nextRun()` helper (piece 3), never silently delete the two mock-pinning tests in
`test_scheduler.py`, uphold the honesty gate, and never commit/stash/checkout--/clean in this
shared checkout. Waiting on their checkpoints/completion now before dispatching per-piece fresh
blind critics.

## 2026-09-18 — checkpoint técnico Codex (peças 1/2/4/6)

Base: leitura integral deste ledger + git diff HEAD das implementações. Nenhuma feature Automate foi alterada nesta auditoria. Estatísticas reais: scheduler.py +329/-8; models.py +136/-1 (inclui providers/usage anteriores); routers/automations.py +80/-12. main.py conecta AutomationScheduler(SessionLocal, app_state=app.state).

| Peça | Veredito | Evidência e limites |
|---|---|---|
| 1 — execução real | **parcial** | real_execute usa resolve_node_provider, cwd validado e budget; run_job/tick escolhem real por default, mock só explícito. tests/test_scheduler.py::test_run_now_live_mode_reaches_real_adapter_not_mock e ::test_run_now_configured_direct_job_reaches_real_adapter; novo test_scheduler_real_execute.py cobre default manual e agendado sem execute_fn substituto. Ainda não pronto end-to-end: FE envia /run sem body a partir de botão Run simulation; scheduler não oferece controle de HITL/stop externo para seu RunControl; não há migração de instruction/connection_id em bancos existentes (database.init_db usa apenas create_all). |
| 2 — definição da ação | **parcial** | models.AutomationJob e JobCreate/JobUpdate/public_job carregam instruction/connectionId e projectId. Teste de direct real exercita instrução/conexão; CRUD cobre projectId. FE automationsApi.ts ainda não tipa instruction/connectionId; Detail não oferece definição de instrução/conexão/workspace. harnessBundleId do FE usa biblioteca OHM, enquanto BE consulta db.get(Harness, id); não há ponte documentada/testada de bundle manifest → Harness salvo. |
| 4 — histórico/resultados | **parcial** | AutomationRun e run_job gravam tentativa/mode/status/result_json/error_json/timestamps em tabela própria. Não existe GET /automations/{id}/runs (nem outra listagem de AutomationRun) em routers/automations.py; public_job ainda usa _last_result volátil. FE mostra Last attempt, sem histórico persistido recuperável. Não há teste de recuperação desse histórico por API/restart. |
| 6 — falhas | **parcial** | _automation_failure_details reutiliza outcomes e adiciona budget/unresolved/invalid-cwd. tests/test_scheduler.py cobre unconfigured_direct e exhausted_budget. Direct real_execute ignora AdapterResult.error (cli_claude.invoke retorna erro nesse campo), podendo devolver ok true/complete em timeout/falha CLI. Falha harness grava error_json mas perde events parciais no histórico; budget no harness é inferido por substring. Testes de falha auth/transporte e cwd inválido específicos de automação ausentes. |

### Cobertura efetivamente encontrada

- **Timezone:** cron_matches e tick testados com relógio UTC em test_cron_matches_every_minute e test_scheduler_tick_fires_cron_job_once. Não existe timezone salvo por job; conversão de relógio timezone-aware não-UTC, DST e política de missed runs **sem cobertura**. O default de produção é UTC.
- **Dedup:** test_scheduler_tick_fires_cron_job_once e novo caso scheduled-default cobrem dois ticks sequenciais no MESMO scheduler/minuto. _fired vive só em memória, marca depois do await; não é claim atômico. Reinício, dois schedulers, tick concorrente e corrida manual/agendado **sem cobertura/garantia**.
- **Budget:** test_run_now_live_mode_blocked_by_exhausted_budget (harness) e test_run_now_mock_mode_ignores_an_exhausted_budget. real_execute direct chama gate, mas integração direct automation com custo desconhecido/falha parcial **sem cobertura**. Usage retorna tokens via invoke no direct; erro que levanta antes de retornar não preserva tokens parciais.
- **cwd:** novo test_scheduler_real_execute.py observa config.extra.cwd == raiz real do projeto tanto manual quanto agendado; _resolve_job_cwd é a implementação. Projeto removido/path fora/symlink em automações **sem cobertura dedicada**.
- **Enable/disable:** AutomationJob não tem enabled; status não é filtrado no tick. API permite cron=None para desagendar, coberto por test_api_rejects_invalid_update_and_supports_clearing_schedule. Não afirmar que um botão enable/disable já governa scheduler.
- **Persistência/migração:** tabela nova criada em DB novo; create_all não adiciona novas colunas em automation_jobs existente. Não reiniciar backend vivo assumindo upgrade resolvido.

### Comandos reais / sensibilidade do teste

- backend/.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests/test_scheduler_real_execute.py tests/test_scheduler.py tests/test_automation_validation.py tests/test_cowork_automations_api.py → **58 passed in 2.17s**.
- O teste novo nasceu GREEN: implementação real já existia. Nenhum RED de produto foi inventado.
- Mutação semântica isolada em D:/Development/.worktrees/oharness-audit-20260918-f33b839c: substituir somente default return await real_execute(...) por return await mock_execute(j). Rodar test_scheduler_real_execute.py → **2 failed, 1 passed in 1.55s** (manual-default e scheduled-default falham; explicit-mock continua passando). Fonte restaurada em finally. Log backend/automation-all-mock-mutation.log.
- BDD da auditoria: testes parametrizados Given configured job / When triggered / Then only explicit mock skips provider. Não é alegado score geral de mutmut nem E2E visual.
- **Crítico fresh-context: pendente**, conforme bloqueio combinado até 20/09. Nenhuma peça foi declarada pronta e nenhum WINNER foi fabricado.
- **Pedido ao Claude:** explicitar mode=mock no FE do botão Simulate antes de usar integração real. Registrado no STATUS do sprint atual.

### Atualização do checkpoint — correção FE recebida
Claude corrigiu o pedido 01:50: automationsApi.runNow agora envia JSON {mode}, default mock, e o painel passa mock explícito. Verificado por leitura do arquivo; Claude reporta RED 2 -> GREEN 9 tests. O descompasso Simulation/execução real apontado acima está corrigido no checkout. As demais lacunas da auditoria continuam abertas; não foi feita validação E2E dessa alteração aqui.
