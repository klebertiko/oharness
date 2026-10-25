# Ledger — STUDIO-MOCK-CYCLE

Bug: Studio canvas mock-mode execution reports a false red "4 errors" badge on a graph shaped
Skill -> Agent -> Gate -> HITL, with the Gate's `fail` port wired back to Agent for a bounded
retry/rework loop. Screenshot: `C:\Users\<user>\Pictures\Screenshots\Captura de tela 2026-09-17
043439.png`.

**Third dispatch attempt at this exact bug.** The first two both died to this session's recurring
rate-limit before a single line of code landed — confirmed both times via `backend/engine.py`'s
mtime sitting unchanged at 2026-09-16 04:39. Per instruction, this attempt wrote and confirmed a
failing RED test *before* anything else, specifically so a real RED test survives on disk if this
attempt also dies.

## 2026-09-17 — checkpoint: RED confirmed, starting implementation

### Root cause (confirmed against current source)

`nodeProvider.ts`'s "Simulation · no provider called" label (mentioned in the parallel session's
diagnosis) is a red herring, confirmed by reading the file — it is a one-line static label
function with no branching logic that could produce this bug.

The real cause, confirmed by reading `backend/engine.py`: `topological_sort` (Kahn's algorithm,
line ~125) has zero awareness of edge/port identity. It builds in-degree from every edge in the
graph, unconditionally. A Gate's `fail` output wired back to Agent creates a structural cycle
Agent -> Gate -> Agent; Kahn's algorithm never zeros Agent's in-degree, so Agent, Gate, and
everything downstream (HITL) land in `unreachable`, forcing `status: "error"` even though this is
a deliberate, named retry shape, not an accidental loop. Verified by hand-tracing the algorithm
against the exact reported graph shape and confirmed live via the RED test below.

Confirmed via grep: `backend/engine.py` has **zero** case-sensitive-or-not references to a "gate"
node type, and zero pass/fail-port routing of any kind — a Gate node today executes exactly like
a plain Agent node (falls through to the generic adapter-backed branch). The engine's existing
`edge.data.condition` substring-match mechanism (PASS/FAIL routing for the unrelated 8-role
oharness bundle graph) is a different mechanism keyed off `data.condition`, which the Studio
canvas's edges never set — canvas edges instead carry `sourceHandle` (`"pass"` / `"fail"`, per
`frontend/src/lib/ports.ts`'s `PORTS.gate`), confirmed by reading `frontend/src/lib/bundleGraph.ts`
and `frontend/src/lib/actions.ts` (`graph_json: { nodes: s.nodes, edges: s.edges }` — raw React
Flow edges, `sourceHandle` intact, sent straight through `ExecuteRequest.graph_json: dict` with no
Pydantic stripping).

`backend/oharness/mock_run.py::test_plan_mock_run_cycle_not_ok` (in `test_mock_run.py`) is a
**separate, unrelated** cycle-detection implementation (`oharness/mock_run.py` has its own local
`topological_sort`, confirmed no cross-import from `engine.py`) for the OHM-bundle role-graph
preview, not the Studio canvas run engine this bug is in. Left untouched — out of scope, not the
same code path.

### RED test (confirmed failing for the right reason)

New file `backend/tests/test_engine_gate_retry_loop.py`:
- `test_gate_fail_loop_does_not_mark_the_graph_unreachable` — reproduces the exact reported graph
  shape. **FAILED as expected**: `assert run_start["unreachable"] == []` got
  `['agent', 'gate', 'hitl']` instead — matches the hand-traced root cause exactly.
- `test_a_plain_two_node_cycle_with_no_gate_is_still_a_hard_error` — regression anchor duplicating
  `test_engine_cycle_handling.py`'s existing guard in this new file too. **PASSED** already
  (asserts today's correct behavior, unchanged).

```
tests/test_engine_gate_retry_loop.py::test_gate_fail_loop_does_not_mark_the_graph_unreachable FAILED
tests/test_engine_gate_retry_loop.py::test_a_plain_two_node_cycle_with_no_gate_is_still_a_hard_error PASSED
```

### Planned fix (about to implement)

1. `topological_sort`: classify each edge whose source is a `gate`-type node with
   `sourceHandle == "fail"` as a *candidate* retry edge; keep it out of Kahn's in-degree
   computation only if excluding it is actually what breaks a cycle (i.e. its target can reach
   its source without it) — a Gate-fail edge that doesn't close a cycle behaves exactly as before.
   Return the accepted retry edges alongside `(order, unreachable)` so the caller knows where to
   loop back to. A plain cycle with no such edge is completely unaffected — preserves both
   existing hard-cycle tests unchanged.
2. `execute_harness`'s node loop: convert the `for index, node_id in enumerate(order)` walk to a
   `pos`-indexed `while` loop (minimal-diff transform — `pos += 1` right after reading `node_id`
   means every existing `continue`/`break` keeps its current meaning unchanged). When a Gate node
   with a registered retry edge decides "fail" (mock: `data.mockOutcome`, default `"pass"` —
   never forced on a graph author; live/local: substring match on real output, same convention
   `edge.data.condition` already uses elsewhere in this file), rewind `pos` to the retry target
   and continue, up to `data.maxIterations` (default 3) attempts; exceeding the cap is a genuine
   runtime error (`node_error` + `STATUS_ERROR`), not a silent pass-through.

Continuing to implementation now.

## 2026-09-17 (later) — GREEN, closed out by Sonnet after the implementing agent died mid-flight

The agent that wrote the plan above died to this session's recurring rate-limit right as it said
"Continuing to implementation now" — no further ledger entry, no handoff. Checked the actual
code and tests rather than assuming the plan above was ever executed: it was. `backend/engine.py`
now has `_GATE_RETRY_HANDLE = "fail"`, a `_reachable_from()` BFS helper, and `topological_sort`
rewritten exactly per the plan (Gate-fail edges that close a cycle excluded from Kahn's in-degree
bookkeeping only when they're actually what closes it; everything else unaffected). `RunControl`
and `execute_harness` carry the bounded-retry loop.

`backend/tests/test_engine_gate_retry_loop.py` exists with 5 tests, independently re-run just
now — **all 5 pass**, plus the 3 pre-existing tests in `test_engine_cycle_handling.py` (the
non-Gate hard-error guard) — **8/8**:
```
test_gate_fail_loop_does_not_mark_the_graph_unreachable PASSED
test_gate_fail_loop_actually_retries_and_can_recover_within_the_cap PASSED
test_gate_fail_loop_exhausting_the_cap_is_a_real_error PASSED
test_a_plain_two_node_cycle_with_no_gate_is_still_a_hard_error PASSED
test_gate_fail_edge_that_does_not_close_a_cycle_behaves_as_a_normal_edge PASSED
```
Full backend suite independently re-run: **393 passed / 1 failed** (the 1 is the long-standing,
pre-existing, unrelated `test_direct_history_survives_a_fresh_detail_request` 404 — not this
story's). The core bug (Studio mock-mode "4 errors" on a Gate-fail retry graph) is fixed and
covered.

**Not done, honestly flagged, not silently dropped:** the secondary UI-honesty gap named in the
original brief — `frontend/src/components/canvas/GraphAudit.tsx` computing "Graph wireable" for a
graph the engine will actually refuse to run as a plain cycle — was never reached
(`GraphAudit.tsx` mtime still 2026-09-11, untouched). This was explicitly deprioritized as
optional in the dispatch brief and the agent ran out of room before starting it, not a decision
to skip it. Left for a follow-up story or the broader Studio redesign to pick up.

**Not done, live verification**: nobody reproduced the exact original screenshot's graph live in
the browser post-fix to visually confirm the "4 errors" badge is gone (the implementing agent
died before this step; Sonnet did not re-do it here to keep this closeout focused on what could
be verified from code+tests alone). Worth a quick live check before treating this as fully closed
for a demo.

Story status: backend fix **complete and tested**; UI-honesty follow-up and live visual
confirmation **outstanding**.
