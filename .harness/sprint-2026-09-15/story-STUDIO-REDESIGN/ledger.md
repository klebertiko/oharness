# Ledger — STUDIO-REDESIGN

Authority: user request via handoff `D:\Development\handoffs\2026-09-17-oharness-next-work-studio-automate-workspace.md`
section 4 (verbatim complaints + named skills), gated on `story-STUDIO-MOCK-CYCLE` (execution bug
fix) being done — confirmed done below. Full redesign of the Studio screen. Skills named by user:
`gauntlet-loop`, `hallmark`, `frontend-design`, `tdd`, and an `implement` skill not found in this
session's skill list (confirmed via the system skill listing — proceeding without it per dispatch
instructions).

Session note: this session shows three sibling agents (`main`, `automate-verify-checkpoint`,
`piece4-finish`). `story-CONNECTION-CONTEXT-GAUNTLET` (`.harness/sprint-2026-09-15/`) has mtime
4 min before this story started (actively hot) — matches `piece4-finish` (handoff's item #6,
pieces 2+4 of that separate gauntlet). `automate-verify-checkpoint` almost certainly maps to the
handoff's item #5 (Automate redesign), a sibling large item, different screen. No collision
expected — different files, different ledgers. Not messaging them unless a file collision is
actually observed (none so far; `git status` at start showed zero frontend files modified, only
backend/*.py + 2 docs, none Studio-related).

## Blocking condition — cleared

`story-STUDIO-MOCK-CYCLE/ledger.md`: Gate-fail retry-loop cycle bug in `backend/engine.py`'s
`topological_sort` fixed and tested (8/8 new+regression tests green, full backend suite
393 passed / 1 pre-existing unrelated failure). Two items left open there, both in my scope:
- `GraphAudit.tsx` "wireable" honesty gap (see Piece 3 below) — confirmed, worse than described.
- Nobody re-ran the exact original screenshot's graph live post-fix — folding into my own live
  verification pass (Piece 1/3 evidence).

## Orientation findings (read before assuming the handoff's screenshots are current state)

The handoff's screenshots (2026-09-13 and 2026-09-17) are stale relative to source on disk *right
now* — confirmed by reading files, not assumed:

1. **Header mode toggle already collapsed from 3-way to 2-way.** `frontend/src/components/toolbar/Toolbar.tsx`
   today has only `Mock` / `Connected` (`MODES` array, lines 19-22) — the `LOCAL` button the
   09-13 screenshot shows no longer exists in source. `executionMode` flows into `api.execute({
   graph_json, mode: s.executionMode })` (`lib/actions.ts` ~line 99) — a true run-level switch.

2. **The Inspector already has a real "Connection pin" control.** `frontend/src/components/sidebar/PropertiesPanel.tsx`
   (this is the component titled "Inspector" in the UI — not named `Inspector*.tsx`, grep on the
   filename finds nothing) lines 296-327: an agent node has a "Connection pin" `<select>` bound
   directly to `d.providerIds?.[0]`, populated live from `useProviderStore().connections`, with
   caption text: *"Applies to this agent only. In chat, a pinned connection overrides the chat
   provider; unpinned agents use the chat default. **Connected Studio runs require an explicit
   pin.**"* That last sentence is a real, already-decided precedence rule for Studio specifically
   (narrower than chat's — no session-default fallback in Studio) and matches
   `backend/providers/resolution.py::resolve_node_provider`'s actual error message verbatim
   ("No provider is set for this node. Pin one on the node, or pick one from the chat provider
   chip and connect it under Providers.") — confirmed by reading both files side by side.

3. **The old "Adapter" field still exists but is already demoted.** Same file, lines 338-394: it's
   now inside a closed-by-default `<details><summary>Legacy bundle settings</summary>` with copy
   *"Preserved for compatibility. Connected runs use the connection pin; simulation calls no
   provider."* — honest, not claiming to drive execution. Still defaults to the literal string
   `"mock"` (`value={d.adapter ?? "mock"}`) if expanded. Its option list
   (`mock/claude/ollama/openai/lmstudio/codex`) doesn't even match the backend's real adapter set
   (`ADAPTER_BY_PROVIDER`: anthropic→claude, openai→codex, ollama→ollama, openrouter→openrouter —
   no `lmstudio`, no bare `openai` key, has `openrouter` which the frontend list lacks). This is a
   genuine leftover mismatch worth a call in Piece 1: repair, or remove entirely now that the
   Connection pin is the real mechanism.

4. **Backend precedence, read verbatim from `backend/providers/resolution.py` (not paraphrased):**
   node pin (`data.providerIds[0]`, already-effective — "the frontend is the single writer of the
   field") → if absent/unknown/disabled/no-chat-capability/no-credential/no-adapter/no-model(for
   HTTP adapters) → `ProviderResolutionError`, always. **Never** silently falls back to mock.
   `execution_mode == "mock"` never reaches this module at all — mock is a separate top-level
   choice, not a fallback within resolution. This is the one real precedence rule; the redesign's
   job is legibility, not invention.

5. **Footer toolbar already renamed "Mock" → "Plan simulation".** `frontend/src/components/studio/ValidateDock.tsx`:
   buttons are `BUNDLE | Validate | Plan simulation | Export .ohm | Import .ohm`. Matches the
   09-17 (newer) screenshot exactly, not the 09-13 one the user quoted "Mock" from — the rename
   already happened. `Validate` calls `validateBundle(compose())`; `Plan simulation` calls
   `mockBundle(compose())` (explicitly "no provider called"); `Export .ohm` calls
   `downloadOHarness(compose())`; `Import .ohm` parses+validates+`openStudioBundle`s a file. None
   of these read as stubs from source — **not yet confirmed live**, the user's claim that
   Export/Import "don't work" needs a real repro before trusting either the old complaint or my
   read of the source.

6. **`GraphAudit.tsx` is worse than the MOCK-CYCLE follow-up implied.** Read in full
   (`frontend/src/components/canvas/GraphAudit.tsx`): `audit()` does *zero* cycle detection of any
   kind — it only checks (a) nodes with an `in` port and no incoming edge (minus the first, treated
   as entry) and (b) non-HITL nodes with an `out` port and no outgoing edge. A Gate-fail retry loop
   satisfies both in+out for every node, so it now (post MOCK-CYCLE fix) happens to say "wireable"
   correctly — by accident, not because it understands retry semantics. A **plain** cycle (no Gate,
   e.g. Agent A → Agent B → Agent A) *also* satisfies in+out for both nodes and would *also* be
   reported "Graph wireable" — but `backend/engine.py` hard-errors on exactly that shape
   (`test_a_plain_two_node_cycle_with_no_gate_is_still_a_hard_error`). This is a live, current,
   reproducible honesty gap, not a historical one. Scoped as Piece 3.

Dev servers confirmed already running at session start: backend `127.0.0.1:8000/health` →
`{"status":"ok"}`; frontend `127.0.0.1:3000` → HTTP 200. Did not start new ones.

## Piece decomposition (reasoned from the 4 verbatim complaints + the MOCK-CYCLE follow-up, not arbitrary)

1. **Provider/mode precedence legibility** — complaint #1. Live-verify the Connection-pin flow
   found above, then decide+implement the Legacy-Adapter-field's fate (repair its option list vs
   remove now that Connection pin is real), polish labeling so header Mock/Connected ↔ per-node
   pin ↔ legacy field read as one coherent, truthful story instead of three unrelated fields.
2. **Footer toolbar clarity + functional truth** — complaint #2. Live-verify Validate/Plan
   simulation/Export/Import actually work (reproduce before trusting either the complaint or the
   source read); redesign the bar's density/labeling/discoverability.
3. **GraphAudit "wireable" honesty** — MOCK-CYCLE follow-up, confirmed live bug (see #6 above).
   Real cycle detection (or an honestly narrower claim than "wireable") — TDD red first.
4. **Node linking / graph-engineering interaction pattern** — complaint #3. The `gauntlet-loop`
   piece: fetch real bar(s) live (screenshots, not memory), compare Studio's canvas
   (`HarnessCanvas.tsx`, `edges/`, `nodes/`, `lib/ports.ts`) against them, close the gap.
5. **Hallmark visual/typographic pass** — anti-AI-slop polish across header/sidebar/canvas/
   inspector/footer as one coherent system, informed by the Piece 4 bar research and an early
   baseline audit (running now, see below).
6. **Coverage pass** — TDD threads through every piece above (red before green, no exceptions);
   this piece is the dedicated end-of-redesign look at mutation/e2e coverage for the two most
   load-bearing bits (provider precedence, export/import round-trip), isolated temp copy only if
   mutation testing happens at all (never the shared checkout — per the Codex handoff's documented
   prior incident).

Order of attack: Piece 3 first (small, self-contained, clearly real, good first TDD slice) →
Piece 1 (verify + finish already-80%-built work) → Piece 2 → Piece 4 (needs bar research, dispatched
in parallel now) → Piece 5 (continuous + final pass) → Piece 6 (threaded + final pass).

## Dispatched in parallel (background subagents, both running now)

- **Live verification agent**: reproduce all 4 complaints against the actually-running app
  (localhost:3000/8000), fresh screenshots, confirm/refute the source-reading above.
- **Bar research agent**: fetch LangGraph Studio, n8n, ComfyUI for real (live screenshots/use, not
  memory) — LangGraph Studio was the prior bar for a past Studio pass per the handoff; confirming
  it still fits or supplementing, logging reasoning either way per gauntlet-loop convention used
  elsewhere in this project.

Status: orientation complete, ledger checkpointed, subagents dispatched. Continuing to hallmark
baseline audit next.
