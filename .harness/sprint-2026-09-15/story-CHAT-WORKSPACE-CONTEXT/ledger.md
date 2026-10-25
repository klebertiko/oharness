# Ledger — CHAT-WORKSPACE-CONTEXT

Date: 2026-09-17. Fixed directly by Sonnet, TDD, no subagent dispatch (small, precisely
diagnosed, backend-only, no overlap with any concurrent agent's active files — confirmed via
`git status` mtimes and a coordination check with `automate-gauntlet-loop` before editing).

Real user bug report, reproduced in a screenshot
(`C:\Users\klebe\Pictures\Screenshots\Captura de tela 2026-09-17 042225.png`): the composer's
toolbar clearly shows "📁 Development" as the selected workspace folder. The user asks "em que
folder estamos agora?" (what folder are we in now?) and OHarness replies "Não tenho
visibilidade do diretório de trabalho daqui. Se quiser, roda `pwd` no terminal e me diz..." (I
have no visibility into the working directory — run `pwd` yourself and tell me). The user then
asks why the agent can't call tools/terminal commands at all — that follow-up went unanswered in
the screenshot. Already logged as item #1 in
`handoffs/2026-09-17-oharness-next-work-studio-automate-workspace.md` (a prior Sonnet session's
triage of 4 screenshots), which flagged it as "provavelmente o menor dos itens, bom candidato pra
começar sozinho e rápido" without having traced root cause yet.

## Investigation (confirmed against current source, not assumed)

Traced the full path: `WorkspacePicker.tsx` (composer chip) → `workspaceStore.ts` → `AgentStage.
tsx`'s `onStart()` (`cwd: workspace?.rootPath || undefined`) → `useRunStream.ts` → `runClient.ts`
→ `POST /execute/direct` (harness off, this screenshot's case) or `POST /execute/` (harness on) →
`routers/execution.py`'s `_validated_project_cwd()` → `resolve_node_provider()`
(`providers/resolution.py`) → `AdapterConfig.extra["cwd"]` / `["cwd_root"]`.

**Every link above already worked**, confirmed by existing passing tests
(`test_execution_cwd.py`, `test_triage.py::test_cwd_is_forwarded_to_resolve_node_provider`) —
this was not a "cwd never reaches the backend" bug, contrary to the initial hypothesis in the
2026-09-17 triage handoff. A parallel session (`development-51`, relayed via the orchestrator)
traced the same path independently and reached the identical conclusion before I'd finished
confirming it myself — cross-checked their claim against the actual current file contents
(`cli_claude.py:72-102`, `openai_compatible.py`'s `invoke`/`stream`, `providers/resolution.py`)
rather than trusting the relay, per this task's own instruction not to trust summaries.

**The actual gap**: `AdapterConfig.extra["cwd"]` reaches two different places and is fully
consumed by both, but neither ever turns it into text the model reads:
- `OpenAICompatibleAdapter.invoke()`/`.stream()` (`adapters/openai_compatible.py`, the screenshot's
  own "Ollama local" provider, and also OpenAI/OpenRouter) **never reads `config.extra` at all** —
  only `system_prompt` and the raw `prompt` build the outgoing `messages`. `cwd`/`cwd_root` are
  silently dropped, completely, for every HTTP-based adapter.
- CLI adapters (`cli_claude.py`, and by the same shared helper `cli_codex.py`) use
  `extra["cwd"]`/`["cwd_root"]` only via `cli_shared.resolve_cwd()` as the **spawned subprocess's**
  actual working directory — never mentioned in the prompt or system prompt text either.

So the model's own input, on every adapter this app has, never named any folder — "Não tenho
visibilidade" was an honest answer to what it actually received, just a misleading one given what
the composer chip told the person was already known.

### Architectural intent — confirmed deliberate, not an unwired feature (per this task's own
required decision point)

Two independent pieces of evidence in the codebase itself, not inferred:
- `triage.py`'s own module docstring: "None of our CLI-backed adapters (claude/codex) expose real
  function-calling... `--tools \"\"` / the read-only sandbox deliberately strip tool use for a
  *chat* connection."
- `cli_claude.py`'s own module docstring: `--tools ""` + `--strict-mcp-config` +
  `--setting-sources ""` — "That is a deliberate security choice, not an oversight: nothing about
  'pick Anthropic in the chat composer' should let a node read or write files on this machine,"
  citing the harness's own SEC-1/SEC-5 gate findings (hostile-settings/hooks bypass, MCP-server
  injection) as the reason.

This confirms the brief's second hypothesis, not the first: plain chat is **intentionally**
conversational-only, no arbitrary command/tool execution, as a considered security posture already
reasoned about (not something merely left unwired). Per the brief's own instruction, the correct
fix is therefore the narrow one — thread the workspace path to the model as *context* it can state,
and make the reply honestly explain the no-execution distinction — **not** wiring real tool-calling
into the chat surface. That broader ask ("chat agêntico com tools", per `development-51`'s relay of
the user's actual eventual want) is written up as a follow-up proposal at the bottom of this file,
for explicit human sign-off + its own threat-model + a fresh-context `harness-sec` gate — not
implemented here.

## Fix

`backend/triage.py`:
- Added `_workspace_context(cwd: str | None) -> str` — one factual sentence naming the chosen
  folder (`This chat's working folder is "<name>" (<full path>).`), empty when no folder is chosen
  so Nilo never invents one (same graceful-degradation shape `_soul()` itself already uses for a
  missing `SOUL.md`).
- `route_message()`'s `AdapterConfig(system_prompt=...)` now joins `_soul()`,
  `_workspace_context(cwd)`, and any node-level `system_prompt` override, dropping empty parts —
  reduces to exactly the old `_soul()`-only behavior when there's no cwd and no override, so no
  existing behavior changes for the common no-folder case.
- Landing this in `system_prompt` (not `extra`) means it now reaches **every** adapter shape
  uniformly for free: `OpenAICompatibleAdapter` already forwards `system_prompt` as the `system`
  chat message, and `cli_claude.py`/`cli_codex.py` already forward it via `--system-prompt` — the
  same mechanism already proven working for Nilo's own SOUL.md voice
  (`test_nilos_voice_is_layered_onto_the_intake_call`).

`SOUL.md`: added a third persistent self-knowledge fact (alongside "not a person" / "not the
crew"): this chat has no hands — she can state a chosen folder's name/path when she's told one, but
cannot open, read, or run anything inside it, and says that plainly if asked rather than going
quiet. This is what lets her honestly answer the screenshot's *second*, unanswered question ("por
que você não pode fazer chamada de tools e comandos no terminal?") regardless of whether a folder
happens to be selected — a persistent identity fact, not a per-request one, so it belongs in
SOUL.md rather than `_workspace_context`. Added a matching "Tone in practice" example mirroring the
exact reported exchange.

## TDD evidence

`backend/tests/test_triage.py`:
- `test_workspace_folder_is_named_in_the_system_prompt_when_chosen` — cwd set to `D:\Development`
  (matching the screenshot's own chip exactly; chosen so the folder name can't coincidentally
  already appear in SOUL.md's prose the way "OHarness" does). Captures the real
  `AdapterConfig.system_prompt` an adapter would receive via a capturing stub adapter (same pattern
  `test_nilos_voice_is_layered_onto_the_intake_call` already used).
  - RED (before the fix): `assert "Development" in system_prompt` failed — system prompt was
    SOUL.md's text alone, no folder mentioned anywhere. Reproduced the reported bug exactly.
  - GREEN (after the fix): passes — both the folder's name and its full path are present, and
    Nilo's own voice is still present too (added to, not replaced).
- `test_no_workspace_line_is_added_when_no_folder_is_chosen` — "No folder" (`WorkspacePicker.tsx`'s
  own first-class option) must not make Nilo invent one. Asserts the specific injected sentence
  (`"This chat's working folder is"`) is absent — not the bare phrase "working folder", which
  legitimately appears in SOUL.md's own new persistent text now and would have made this a false
  regression signal (caught when the SOUL.md edit landed; fixed by targeting the exact injected
  string instead).

Both new tests plus the existing 10 in this file: `pytest tests/test_triage.py` → 12/12 passed.

## Verification

- Full backend suite (`.venv/Scripts/python.exe -m pytest -q`, from `backend/`): **384 passed, 1
  failed.** The 1 failure —
  `test_execution_provider_resolution.py::test_direct_history_survives_a_fresh_detail_request`
  (asserts `GET /execute/logs/{run_id}` returns 200 after a `/execute/direct` run; `run_direct()`
  never writes an `ExecutionLog` row today, so it 404s) — is **not caused by this change**.
  Confirmed: the file is untracked (`?? backend/tests/test_execution_provider_resolution.py` in
  `git status`) with an mtime (2026-09-15 23:27) predating this session; my edits touch only
  `triage.py`/`SOUL.md`, neither reachable from `run_direct()`'s log-writing path. Also
  independently corroborated by `story-STOP-RESPONSIVENESS/ledger.md`'s own Verification section,
  which hit the exact same failure against a *different* change and traced it to Codex's
  in-progress `DIRECT-ADAPTER-RESOLVE` story — two unrelated changes, same pre-existing gap, same
  conclusion.
- Full frontend suite (`npx vitest run --run`, from `frontend/`): **290 passed, 1 failed** — the 1
  failure (`Dossier.test.tsx`, a credential-length assertion) matches exactly the pre-existing,
  already-documented failure in `story-CONNECTION-CONTEXT-GAUNTLET/ledger.md`'s own recon baseline.
  No frontend files were touched by this fix (the cwd plumbing from `WorkspacePicker` to the
  backend was already correct end to end), so this is confirmation of no regression, not new
  ground.
- `npx tsc --noEmit`: clean, no output, exit 0.

### Live verification — attempted, deliberately not completed, reasoning below

Checked `.claude/launch.json`, `preview_list`, and `tabs_context` before touching anything, per
this task's instructions. Both `frontend` (port 3000) and `backend` (port 8000, confirmed via a
`GET /execute/active` returning `401 Missing or invalid sidecar token` rather than a connection
error) were already running — reused, not restarted. Opened my own new background tab (`tab-4`,
not touching the existing `seed`/`tab-1`/`tab-2`/`tab-3` tabs another agent's work was already
using) and loaded the app: it rendered correctly, showing another agent's own recent live-test
chat history ("PO: claude CLI exited 1" — the claude CLI has no real login in this sandbox
either), confirming no frontend regression from this change (expected, since no frontend files
were touched).

Stopped short of driving a real chat turn through the UI for two concrete reasons, not just
caution:
1. **The already-running backend has no `--reload`** (`launch.json`'s uvicorn command). It loaded
   `triage.py` into memory before this fix existed, so it is still serving the *old* behavior;
   observing the fix live would require restarting that shared process. Per this task's explicit
   instruction ("no dev-server restarts unless you determine one is genuinely required, and say so
   rather than just doing it"): another agent's chat history from ~22 minutes prior and a
   newly-appeared active tab (`tab-5`) during this check both show the backend and browser pane
   are in concurrent use right now — restarting would interrupt that. I judged it not genuinely
   required: this fix is a pure, deterministic string-composition function, and the TDD evidence
   above already captures the *exact* `system_prompt` value an adapter receives — strictly more
   precise than a live click-through, whose reply text would additionally depend on a real model's
   instruction-following rather than only on the plumbing this fix changes.
2. The Browser pane itself went **hidden** (`tabs_context` reported `"The Browser pane is
   currently hidden"`) partway through this check — consistent with the user or another agent
   having focus elsewhere — which blocks `computer` click actions regardless of restart decisions.
   Did not fight for pane focus in a shared session; closed the extra tab and moved on rather than
   forcing it.

If a human wants the live exchange re-confirmed end-to-end, restarting the `backend` launch
config (or waiting for its next natural restart) and repeating the screenshot's exact two messages
would do it — flagging this rather than deciding unilaterally to restart a shared process.

## Files touched
- `backend/triage.py` (`_workspace_context()` added; `route_message()`'s `system_prompt`
  composition updated)
- `backend/tests/test_triage.py` (2 new tests)
- `SOUL.md` (third self-knowledge fact + matching "Tone in practice" example)

## Follow-up proposal (not implemented here — needs human sign-off)

`development-51`'s relay reports the user's actual eventual want is "chat agêntico com tools" —
real tool/command execution from the plain chat surface, not just honest context. That is a
materially different, larger, and security-relevant feature: it would mean reopening the exact
`--tools ""` / `--strict-mcp-config` / `--setting-sources ""` posture that `cli_claude.py` and the
harness's own SEC-1/SEC-5 gate findings deliberately closed (hostile-settings/hooks bypass via a
crafted prompt, MCP-server injection). Recommend, if pursued: a dedicated story with its own
`threat-model` pass and an independent fresh-context `harness-sec` gate before any implementation —
explicitly not something to add as a side effect of this bug fix, and not something I've
implemented or scaffolded toward here.
