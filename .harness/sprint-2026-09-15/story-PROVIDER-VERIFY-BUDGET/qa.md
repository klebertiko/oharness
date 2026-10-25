# Independent QA — PROVIDER-VERIFY-BUDGET (Story 1: provider status truth, Story 2: token/cost/budget)

Date: 2026-09-15. Independent fresh-context QA. Read the two stories' asks and the
2026-09-13 provider-status handoff before reading implementation code. Builder
agents crashed on a session rate limit before their own QA gate; this is the
first QA pass either story has received.

Status: **QA Bounce — Story 2 only, route @FE.** Story 1 (provider connection
status) is verified clean end to end and needs no rework. Story 2's backend
(cost/budget/usage-tracking/engine enforcement) is also verified clean; two
specific, fixable frontend defects in the Providers/Dossier display block full
approval. Neither defect touches Story 1's files.

## Test execution (independently run, not trusted from the task brief)

- `frontend/`: `npm test -- --run` → **254/254 tests passed, 57/57 files**, 10.55s. Matches the prior count exactly; independently re-run, not assumed.
- `frontend/`: `npm run typecheck` → `tsc --noEmit`, exit 0, no errors.
- `backend/`: `.venv/Scripts/python.exe -m pytest -q` → **321/321 passed**, 7 warnings (pre-existing `datetime.utcnow()` deprecation notices and two harmless `.pytest_cache` permission warnings — unrelated to this story), 17.55s.
- No test or suite approached the ~30s hang threshold the task flagged (longest suite 17.55s total; longest individual test ~2.5s). No mutation-testing tool was run.
- Raw output saved at `evidence/test-results.txt`.
- **Operational note, not a code defect:** checked read-only after the test runs (Git Bash `curl` and PowerShell `Invoke-WebRequest`/`Get-NetTCPConnection`, both independently), neither `:3000` nor `:8000` was accepting connections. QA issued no command capable of stopping either process — only `npm test`, `npm run typecheck`, and `pytest`, each a separate short-lived process, and `backend/tests/conftest.py` redirects the pytest DB/secrets to a fresh `tempfile.mkdtemp()` root with a hard runtime assertion that it never resolves under the real `backend/data/` (verified by reading that file), so the pytest run could not have touched the live server's database. A frontend test (`AgentStage.composition.test.tsx`) independently logged `ECONNREFUSED 127.0.0.1:8000` in stderr while still passing, consistent with the backend already being unreachable during the run. Most likely the servers were already down or exited independently before/during this pass. Flagging for Sonnet/the user; QA did not attempt a restart.

---

## Story 1 — provider connection status truth: PASS, no rework needed

**Claim to verify:** a real successful run calls `reportRunOutcome` with the right connection id end to end, and `isProviderLevelFailure` doesn't create false positives/negatives.

**Trace, confirmed by reading the actual call chain (not just the store in isolation):**

1. `AgentStage.tsx:150-156` — `onStart()` calls `start({ ..., providerId: provider.id })`, where `provider = pickChatProvider(connections, chosenProviderId)` (line 49-52).
2. `useRunStream.ts:130` — `start()` captures `providerIdRef.current = providerId ?? null` at send-time (comment at line 39-44 explains why: a new pick mid-run must not retroactively change credit).
3. `useRunStream.ts:100-113` — once the run ends (`!live`), a dedicated `useEffect` walks `run.plan`, and for every segment that reached `state:"done"` with a real (non-`mock`) adapter, calls `useProviderStore.getState().reportRunOutcome(s.connectionId ?? fallbackId, { ok: true })`.
4. `s.connectionId` is populated by `runReducer.ts:116-117` from the `node_start` SSE event's `connection_id` field, which `backend/engine.py:437` only sets for a real (non-mock) resolution — `node_view["connection_id"] = resolved.connection_id`, i.e. the actual connection id a node used, not a re-derived guess.
5. `providerStore.ts:496-517` — `reportRunOutcome`: `ok:true` flips `health` to `"live"` unless the connection is disabled or a probe is already in flight (both correctly guarded); there is no caller of the `ok:false` branch anywhere in the codebase (confirmed by `grep reportRunOutcome` across `frontend/src` — only `useRunStream.ts`, the store itself, and its test call it).

**Evidence this is actually tested, not just plausible:**
- `frontend/src/components/agent-run/useRunStream.test.ts` (9 tests, all passing) is a dedicated wiring test, not a store-only test. It specifically covers: direct-mode fallback to the composer's `providerId` (`:89-98`); a harness node's own `connection_id` taking precedence (`:100-115`); the cross-attribution case — a graph node pinned to a *different* connection than the composer's chosen one gets credited correctly, and the composer's own idle connection is untouched (`:117-148`, explicitly logged in the file's own docstring at `:26-33` as a real defect a prior QA/SEC pass caught and fixed); five separate "must NOT fault" cases — unrelated content error, an auth-looking error string, user Stop, HITL rejection with a note that reads like a transport failure, and a silent mock fallback (`:150-223`).
- `frontend/src/components/providers/providerStore.runOutcome.test.ts` (9 tests, all passing) pins `reportRunOutcome`'s and `isProviderLevelFailure`'s contract directly, including verbatim strings from `backend/providers/resolution.py`'s `ProviderResolutionError` (`:50-53`) asserted `false` (not a provider fault).
- `backend/tests/test_engine_token_limits.py::test_node_start_carries_the_resolved_connection_id` (`:109-115`) and `backend/tests/test_execution_provider_resolution.py::test_run_harness_resolves_pinned_connection_to_real_adapter` (`:75-98`) independently confirm the backend side of the same `node_start.connection_id` contract the frontend consumes.

**On `isProviderLevelFailure` specifically:** the task asked me to check it against real error strings this codebase produces. I did — I manually checked every message `providers/resolution.py`'s `ProviderResolutionError` can raise (10 distinct messages, e.g. `"No provider is set for this node..."`, `"'X' is disconnected..."`, `"'X' has no default model set..."`) against `PROVIDER_FAILURE_SIGNATURES` (`providerStore.ts:361-374`) and confirmed none match — no false positives. But the more important finding is structural, not string-level: **`isProviderLevelFailure` is not called anywhere except its own test.** `providerStore.ts:376-393`'s doc comment explains why — a 2026-09-13 SEC review found `Segment.error` is always free-form prose (model output, an HITL note, a token-limit message) that can coincidentally contain a matching substring, and since "fault" is sticky (blocks the connection from auto-pick until a manual Test), a false fault is worse than the bug this story fixes. So the classifier exists as a tested, documented, *deliberately unwired* primitive for a future story — this is a scope decision made and disclosed in the code, not an oversight, and `useRunStream.test.ts` explicitly re-confirms "there is no failure path here at all" as intentional (`:162-177`, `:191-209`). The practical consequence: a connection that goes stale (key revoked mid-session after being verified) will keep reading "Verified" until someone clicks Test — the same direction of staleness the codebase already tolerated before this story, just not made worse. This is a real, honestly-disclosed limit, not a defect I'm bouncing on.

**`ChatProviderPicker.tsx` dot/checkmark:** unchanged by this story and still correct. The dot (`:34-35`) is `bg-signal` only when `connection.health === "live"` **and** a provider resolves — exhaustively tested across all five health states plus disabled in `ChatProviderPicker.test.tsx:77-90`. The checkmark is intentionally keyed off `chosenId` (an explicit pick), unrelated to health — that's by design (marks "what you picked," not "is it healthy"), documented in the 2026-09-13 handoff and unchanged here. Since `reportRunOutcome` is the only new way `health` reaches `"live"` outside an explicit probe, and the dot already keys off `health`, the original bug (two successful replies sitting next to "Not verified") is actually closed by this wiring — confirmed by the trace above, not assumed.

**Verdict: PASS.** No findings. No rework needed on Story 1's files.

---

## Story 2 — token/cost/budget tracking: 2 findings, route @FE

### Verified correct (backend — no findings)

1. **Cost frozen at write time, never recomputed from a live catalog price.** `usage_tracking.py:107` computes `compute_cost(tokens_total, model)` once and stores both `cost_usd` and `price_per_mtok` directly on the `UsageRecord` row (`models.py:113-124`, docstring at `:91-94` states the intent explicitly). Every read path (`total_spend_usd` at `usage_tracking.py:143`, `routers/usage.py:69-70,81`) sums the stored `cost_usd` column — none re-joins against `adapters/catalog.py`'s `MODEL_PRICES` at read time. Directly tested: `test_usage_tracking.py::test_record_usage_writes_a_row_with_cost_computed_at_write_time` (`:86-106`).
2. **Budget check runs before both real-spend entry points.** `routers/execution.py:252-256` (`POST /execute/`) and `:387-391` (`POST /execute/direct`) both call `usage_tracking.enforce_budget_or_raise(db)` before any adapter call, both correctly map `BudgetExceededError` to HTTP 402, and both correctly exempt `mode == "mock"`. The routing/triage call (which itself spends real tokens) happens *after* the budget check (`execution.py:266`), not before. Tested end-to-end: `test_execution_budget_enforcement.py::test_direct_run_refused_when_budget_already_exceeded` (`:126-140`), `::test_harness_run_refused_when_budget_already_exceeded` (`:166-174`), `::test_harness_run_emits_warning_event_at_80_percent` (`:182-201`).
3. **Per-agent token limit stops only the node, honestly, never truncates silently.** `engine.py:513-554`: an over-limit node gets a `node_error` carrying the real (already-spent) token count and a message naming the actual number and the limit; `status` is marked `error` but the loop does **not** `break` — the walk continues to downstream nodes. Exhaustively tested: `test_engine_token_limits.py::test_usage_at_limit_stops_the_node_honestly_not_the_run` (`:151-165`) and `::test_usage_over_limit_still_lets_a_downstream_node_run` (`:167-193`, a downstream node genuinely still runs and produces output after the over-limit node's error). Warn-at-80%/hard-stop-at-100% thresholds match between the per-agent check and the global budget by sharing one constant (`usage_tracking.WARN_THRESHOLD`), per `engine.py:1-29` import and `:510-511` comment.
4. **No-catalog-price connections are billed $0.00, not fabricated.** `adapters/catalog.py:224-239`'s `MODEL_PRICES` table has zero entries for any Ollama model (local or cloud) or for OpenAI, with an explicit comment (`:212-223`) that this is deliberate — no adapter has ever measured a real price for either, so inventing one would be fabrication. `compute_cost` returns `(0.0, None)` in that case, distinctly from a genuine $0 rate (tested: `test_usage_tracking.py::test_compute_cost_unknown_model_is_honestly_free_not_fabricated`, `:70-75`), and a usage row is still written (not dropped) so the ledger stays complete (`test_usage_api.py::test_summary_aggregates_by_connection_and_source`, `:70-102`, explicitly seeds an "unpriced, local" Ollama row and asserts `costUsd == 0.0`, `unpricedTokens == 50_000`).

### Finding 1 — Dossier.tsx's "unpriced" caveat contradicts its own "free" label for local connections. Route @FE.

The backend deliberately cannot distinguish "genuinely free, local" from "cloud, catalog just doesn't have this price yet" — both produce `price_per_mtok: null` (`models.py:98-103`, `usage_tracking.py` module docstring `:1-24`, `routers/usage.py:54-59` all say, in matching language, that this distinction is the **frontend's** job, made using the connection's `residence`).

`frontend/src/components/providers/Dossier.tsx` does this correctly in one place and not in the other, for the *same* connection, in the *same* panel:
- `spendStamp()` (`:35-43`) correctly calls `formatCost(usage.costUsd, c.residence === "local")`, so a local Ollama connection's cost line correctly reads **"free"**.
- The separate "unpriced" caveat block a few lines below it (`:232-240`) fires on `usage.unpricedTokens > 0` alone, with no `c.residence` check at all — even though `c` is in scope and used for exactly this purpose one Block up. Since Ollama has no catalog entry at all, *any* real Ollama-local usage makes `unpricedTokens === tokensTotal`, so this block always fires for a working local connection.

Net effect, reproducible for any local Ollama connection with real usage: the Dossier simultaneously shows **"cost: free"** and **"unpriced: N tokens billed at an unknown rate — not included above, so this total may understate real spend."** The second line is false for this case — there is no hidden real spend to understate on a local, on-device model — and it directly contradicts the "free" line one row above it. This is the same class of dishonesty the story's own design comments (three separate places) say must not happen, just relocated from the primary cost figure (which is correct) to the adjacent caveat (which isn't).

`ProvidersList.tsx`'s row-level `rowCostLabel()` (`:43-46`) does not have this problem — it only calls `formatCost`, with no separate unpriced caveat. This is scoped to `Dossier.tsx`.

No test covers this: there is no `Dossier.test.tsx` at all (confirmed — no such file exists), and no test anywhere renders the unpriced-caveat block against a local connection with real usage.

Suggested direction (not a prescribed fix): the caveat at `Dossier.tsx:232` needs to also account for `c.residence === "local"` before implying uncounted real spend — a genuinely free local connection with 100%-unpriced tokens should not carry the same "may understate real spend" language as a cloud connection with unpriced tokens.

### Finding 2 — Providers screen usage numbers never refresh after a run. Route @FE.

`frontend/src/components/providers/usageStore.ts`'s `hydrate()` fetches once per app session (`hydrated` flag, same pattern as `providerStore.ts`'s own hydrate-once). `refresh()` exists and is exercised in `usageStore.test.ts`, but I checked every call site in the frontend (`grep -rn "\.refresh()\|useUsageStore(" frontend/src`) and found **zero production call sites** — it is only ever called from inside `setBudget()` (as a side effect of saving a budget) and from the store's own test. Neither `AgentStage.tsx` nor `useRunStream.ts` imports `usageStore` at all.

Practical consequence: once a person opens the Providers/Dossier panel at least once in a session (hydrating usage), any tokens/cost spent afterward via chat or a harness run will not appear there until the budget is edited (which happens to trigger a reload as a side effect) or the app is restarted. This directly undercuts the "contagem de tokens" part of the original ask — the screen is correct only at the moment it first loads, not afterward. This sits right next to Story 1's own fix for the identical class of problem (a UI reading stale info after something real just happened) — Story 1 solved it for provider health via `reportRunOutcome`; Story 2 has not yet solved the analogous problem for usage numbers.

Suggested direction (not a prescribed fix): something on the real-run-completion path (`useRunStream.ts`'s existing post-run `useEffect`, or a sibling of it) should call `useUsageStore.getState().refresh()` after a run that actually spent tokens, the same way it already calls `reportRunOutcome`.

---

## DoD

| Item | Verification |
|---|---|
| Full frontend regression | PASS, independent 254/254, 57 files. |
| Typecheck | PASS, independent, exit 0. |
| Full backend regression | PASS, independent 321/321. |
| TDD ledger (RED/GREEN per slice) | **Not found** — no `ledger.md`/`tdd-*.md` exists yet under this story's directory (it didn't exist before this QA pass created it); the builder crashed before writing one, per the task brief. Evidence of iteration exists inside the test files themselves (`useRunStream.test.ts:26-33` documents a QA/SEC-caught cross-attribution defect from "the first pass" and its fix), but I'm not treating that as a substitute for a real ledger — flagging the gap honestly rather than inferring a ledger that doesn't exist. |
| Coverage | Not measured — no percentage asserted. |
| Enforcement thresholds (80%/100%) | Implemented exactly as specified for both the per-agent limit and the global budget, and explicitly disclosed in code as "not yet confirmed with the user" (`usage_tracking.py:19-24`) — QA is not the gate for that confirmation, only for whether the code does what the thresholds say. |
| Docs / handoff | No new handoff written yet for this pass's specific work (`reportRunOutcome`, usage/budget) — expected, since Sonnet is waiting on this QA pass and a parallel SEC pass before writing the consolidated handoff, per the task brief. The existing `2026-09-13-oharness-provider-status-astra.md` covers only the earlier label-fix layer of Story 1, not `reportRunOutcome`. |
| No commit/merge/backend restart/killed servers | QA performed none of these. See the operational note above re: both dev servers being unreachable when independently checked — not caused by any command QA ran. |

## Verification limits

- Concurrency race on the global budget: **real, and honestly disclosed in the code itself**, not something I'm newly flagging as hidden. `usage_tracking.py:202-224`'s own docstring states the `asyncio.Lock` only serializes the check for callers inside one process, and does not close the window between two run-starts that both check before either commits its spend (the commit only happens in each run's own completion — `routers/execution.py`'s `finally` block). I confirmed this is accurately the mechanism (the lock wraps only `get_budget_status`, not the eventual write) and that no test exercises true concurrency (`test_usage_tracking.py` and `test_execution_budget_enforcement.py` are both sequential). One nuance worth naming precisely: the window is not a literal single instant — it spans the **entire duration** of any run(s) already in flight when a new check happens, since commit only happens at run completion, not run start. For a multi-node harness run that can be tens of seconds to minutes, so the practical overshoot bound is "the cost of every run started but not yet finished," which can be more than one run if several are fired in quick succession. The code's own phrasing ("at the exact same moment") reads a little narrower than that in isolation, though its substance ("at most the cost of whichever run(s) were already in flight at that instant") does cover it correctly if "instant" is read as "whenever the check happens to run." Not a bounce — explicitly out of scope per the code's own docstring ("Not built here; see the handoff") — just making the actual width of the window explicit for whoever decides if that's acceptable.
- I did not run a browser/E2E pass against the live UI — both dev servers were unreachable at check time (see operational note above), so I could not visually confirm the composer chip flipping to "Verified" after a real send, or the Dossier/Providers screens rendering. Everything in this report is verified from the actual source and the automated test suites, not from driving the app.
- I did not independently re-derive the `WARN_THRESHOLD = 0.8` / hard-stop-at-100% product decision — I verified the code implements exactly what the task described as "Sonnet specified, not yet confirmed with the user," and no more.
- Scope was Story 1 and Story 2's own files as described in the task; I did not review `backend/automations/*` in depth beyond confirming (by grep) that neither `scheduler.py` nor `pr_watch.py` currently calls any adapter/spend path, so the global budget's "covers everything, harness or not" requirement has no live gap there today — there is simply nothing else that spends tokens yet.

---

## Re-review — 2026-09-15 (bounce-fix verification pass)

Independent fresh-context re-verification of the FE fix in `ledger.md` for this story's
two Story 2 findings above. Read `ledger.md` for the implementer's claims, then verified
each from source, the actual test run, and file-modification timestamps — not taken on
report, same standard as the original pass.

### Finding 1 — Dossier.tsx unpriced caveat vs local "free" label: RESOLVED, verified

Read `frontend/src/components/providers/Dossier.tsx:232` directly (not just the presence
of a test file). Current condition:

```
{usage.unpricedTokens > 0 && c.residence !== "local" && (
```

Byte-for-byte match to the ledger's claimed diff. `Residence` is a closed union —
`export type Residence = "local" | "cloud";` (`frontend/src/components/providers/catalog.ts:27`)
— so `c.residence !== "local"` is exhaustively equivalent to "cloud only," not a check
that happens to work for the two cases a test covers; there is no third value that could
leak through unguarded. `spendStamp()` (`:35-43`, unchanged) already gated `formatCost` on
the same field, so the caveat now uses the identical distinction as the cost line four
lines above it instead of contradicting it.

`Dossier.test.tsx` (new, 2 tests) exercises both branches directly: a local Ollama
connection with `unpricedTokens: 50_000` must show "free" and must NOT show "may
understate real spend" (`:67-87`); a cloud connection with genuinely unpriced tokens must
still show the caveat (`:89-105`). Both pass in the full suite run (below), not just in
isolation.

### Finding 2 — useRunStream.ts usage refresh wiring: RESOLVED, verified, no Story 1 regression

Read `frontend/src/components/agent-run/useRunStream.ts:101-124` in full. The crediting
loop is unchanged from my original trace (`s.state !== "done" || !s.adapter || s.adapter
=== "mock"` filter, `reportRunOutcome(id, { ok: true })` per matching segment, `credited =
true`). The new call sits inside the *same* `if (credited)` block that Story 1 already
used to set `reportedRunIdRef.current`:

```ts
if (credited) {
  reportedRunIdRef.current = run.runId;
  void useUsageStore.getState().refresh();
}
```

This is exactly "the same branch that already calls `reportRunOutcome` for Story 1" — not
a parallel condition that could drift from it, since `credited` is only ever set inside the
identical per-segment loop `reportRunOutcome` itself runs in.

**Story 1 regression check, independent:** `useRunStream.test.ts`'s first `describe` block
("useRunStream -> providerStore run-outcome wiring") still has its original 9 tests, and
reading each of the 9 bodies against what I documented in the original pass (direct-mode
fallback; harness node's own `connection_id`; the cross-attribution case at `:123-154`;
the five must-not-fault cases) shows the assertions themselves are untouched — the only
addition is `useUsageStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) })` in
the shared `beforeEach` (`:92`), required because `useRunStream.ts` now unconditionally
imports `usageStore` and would otherwise fire a real `fetch` as a side effect in every
Story-1 test. That's test scaffolding, not a behavior change. A second `describe` block
("useRunStream -> usageStore refresh wiring") adds 4 new tests pinning: refresh called
once on a real direct-mode completion; refresh called once via a harness node's own
`connection_id` even when the composer's own connection differs; refresh NOT called on a
silent mock fallback; refresh NOT called when a run errors with no segment reaching
"done". File total 13/13 passed in the full run. `providerStore.runOutcome.test.ts` (9/9)
and `runReducer.test.ts` (6/6) — Story 1's other dedicated contract tests — are also still
green, confirming nothing in the attribution chain regressed.

**File-scope corroboration (independent of the ledger's own narrative):** compared
`ls -la --time-style=full-iso` across the touched and claimed-untouched files.
`Dossier.tsx` (02:26:38), `Dossier.test.tsx` (02:26:16), `useRunStream.ts` (02:27:39) and
`useRunStream.test.ts` (02:27:19) all cluster on 2026-09-15 in the early-morning window
this fix pass ran in. `runReducer.ts` (2026-09-13 23:25:33) and `usageStore.ts`
(2026-09-13 23:22:23) both predate that window by roughly 27 hours — i.e. last touched
during Story 1's original implementation, not this bounce-fix pass. This is filesystem
evidence, not the ledger's own prose, that the claimed file-scope boundary is real.

### Test execution (independently re-run)

- `frontend/`: `npm test -- --run` → **58 files passed (58), 260 tests passed (260)**,
  8.73s wall. Longest individual test 2317ms (`AutomationsPanel.test.tsx`) — nothing close
  to the ~30s hang bar. 260 = the prior 254 + 2 (`Dossier.test.tsx`) + 4 (new
  `useRunStream.test.ts` describe block), matching the ledger's arithmetic exactly. Same
  `ECONNREFUSED 127.0.0.1:8000` stderr on `AgentStage.composition.test.tsx` as my original
  pass — the backend dev server is still down (unchanged, environmental, not this pass's
  concern per the task) — and the test still passes despite it, as before.
- `frontend/`: `npm run typecheck` → `tsc --noEmit`, **exit code 0** (captured explicitly,
  not inferred from silence), 4 lines of output (just the npm script banner).
- `backend/`: `.venv/Scripts/python.exe -m pytest -q` → **321 passed**, 7 warnings, 16.69s
  wall — identical count to my original pass (321/321) and to SEC's independent run (321
  passed). Warnings are the same pre-existing `datetime.utcnow()` deprecations and
  `.pytest_cache` Windows-permission warnings as before, nothing new. Confirms the backend
  is genuinely unaffected, as expected for a frontend-only fix. No test or suite anywhere
  near the 30s hang threshold (321 tests / 16.69s ≈ 52ms/test average, makes a hidden
  per-test hang arithmetically impossible at this aggregate).
- Both dev servers (`:3000`/`:8000`) were left exactly as found — down, per the prior
  pass's operational note — no restart attempted, consistent with the task's instruction.

### Known gap disclosed in ledger.md: accurate, genuinely out of scope

Ledger's claim: a run whose only segment hits its per-agent token limit never triggers a
refresh, because `runReducer.ts`'s `node_error` case doesn't copy `action.data.tokens`
onto the segment. Read `runReducer.ts:193-203` directly:

```ts
case "node_error":
  return {
    ...patch(state, String(d.node_id), (s) => ({
      ...s,
      state: "error",
      phase: "",
      error: String(action.data.error ?? "Unknown error"),
      endedAt: Date.now(),
    })),
    status: "error",
  };
```

Confirmed: no `tokens` field, unlike the `node_done` case three cases above it
(`:171-182`, `const tokens = Number(action.data.tokens ?? 0); ... tokens,`). Since the
crediting/refresh loop in `useRunStream.ts` only considers `s.state === "done"`, a
token-limit-only run (which ends its sole segment in `"error"`, per `engine.py:513-554`'s
documented non-truncating behavior) never sets `credited`, so neither `reportRunOutcome`
nor `refresh()` fires. The description matches the code exactly.

On "genuinely out of scope, not an excuse": this is not a new hole cut to dodge work — it
is symmetric with a limitation Story 1's own (already QA-approved) `reportRunOutcome`
crediting already had, since both features share the identical `state === "done"` gate.
The fix piggybacks on that pre-existing gate rather than inventing a narrower one, so it
inherits the limitation instead of creating a new one. Closing it for real would mean
changing how `node_error` populates a segment in `runReducer.ts` — a file that renders
every run in the app, not a file either QA finding touched — which is a reasonable line to
draw for a two-finding bounce-fix pass. Correctly flagged for the backlog rather than
silently dropped; not a blocking condition for this gate.

### SEC review (parallel, independent): noted, not gated here

`security.md` in this directory independently reached **FAIL** (4×P2, 4×P3, no P0/P1),
none of which overlap the two findings re-verified in this pass (its P2-1 has a
`useRunStream`-adjacent half routed to FE separately from this bounce; the rest are
backend). That verdict stands unchanged by anything in this re-review — I did not
re-verify or supersede it, per the task's instruction not to fold it in. Flagging here only
so it isn't silently absent from this record: **QA approval below covers only the two
Story-2 findings this pass re-checked; it does not clear the story for merge on its own.**
Both the QA and SEC gates must be clear before HITL merge, per the routing table.

### Verdict

Both Finding 1 and Finding 2 are resolved, independently verified against actual source
(not test-file presence alone), with passing, non-trivial tests pinning each, and no
regression anywhere in either full suite (260/260 frontend, 321/321 backend, typecheck
clean). The disclosed known gap is accurately described and legitimately out of this
pass's file scope, not an excuse.

**QA gate verdict: Approved for Architecture Review — Story PROVIDER-VERIFY-BUDGET / Story
2 (both bounced findings resolved, evidence above).** This is the QA axis only. The
parallel SEC FAIL in `security.md` is untouched by this approval and remains a separate,
outstanding gate — Sonnet is consolidating both into one handoff once the SEC-routed
backend fixes land.

---

## Closing re-verification — 2026-09-15 (all four SEC P2/P3 backend items + P2-1 FE half)

Independent fresh-context QA, third pass on this story today. Scope: the five items named in
the task brief (P2-1 both halves, P2-2/P2-3, P2-4, P3-2, P3-4), verified against **current disk
state**, not against `ledger.md`'s or `security.md`'s narrative — every claim below cites a
file:line I read myself this pass, and every test-count is from a suite I ran myself this pass.
`security.md`'s parallel SEC re-pass was not read, consulted, or coordinated with, per the task's
instruction. Read `qa.md` (this file, my own two prior passes above) and the full `ledger.md`
(all four sections: FE bounce-fix pass, then the BE pass's four items, then its closing summary)
before touching code.

### Test execution (independent, cold, this pass's own numbers)

```
backend/   .venv/Scripts/python.exe -m pytest -q          354 passed, 7 warnings, 20.41s
frontend/  npm test -- --run (vitest)                      58 files / 262 tests passed, 8.20s
frontend/  npm run typecheck                                tsc --noEmit, exit 0, clean
```

354 and 262/58 match `ledger.md`'s closing-summary counts exactly — independently reproduced, not
assumed. No suite or individual test came anywhere near the ~30s hang bar (backend total 20.41s;
frontend total 8.20s, longest single file `AutomationsPanel.test.tsx` at 2142ms). No hang
observed; nothing stopped early. Same pre-existing warnings as every prior pass this story
(`datetime.utcnow()` deprecation ×2, Windows `.pytest_cache` permission ×2) — unrelated to this
story, unchanged. `AgentStage.composition.test.tsx` still logs `ECONNREFUSED 127.0.0.1:8000` to
stderr while passing — the dev server is still down, environmental, not a code defect, consistent
with every prior pass.

### Item 1 — P2-1, both halves: CONFIRMED, both sides verified independently

**Backend half.** `backend/engine.py:118-142`:
```python
_INTRINSIC = {"input", "output", "router", "hitl"}

def _node_view(node: dict) -> dict:
    data = node.get("data", {})
    node_type = node.get("type", "llm")
    is_intrinsic = node_type in _INTRINSIC
    return {
        ...
        "adapter": "mock" if is_intrinsic else data.get("adapter", "mock"),
        ...
        "intrinsic": is_intrinsic,
    }
```
Forces `"mock"` from the engine's own knowledge of `node_type`, never from graph-author-supplied
`data`, for all four intrinsic types, unconditionally. `backend/tests/test_engine_intrinsic_adapter_spoofing.py`
read in full (162 lines, 3 tests): drives `execute_harness` directly in mock mode with every
intrinsic node's `data.adapter` spoofed to `"claude"` and asserts both `run_start.order` and
`node_start` report `"mock"` for all of input/router/output (`:64-106`) and for a HITL gate
specifically, stopping the generator right after that node's `node_start` with no hang risk
(`:109-133`); a control test confirms an actual `llm` (adapter-backed) node is unaffected by the
narrowing (`:136-161`). All 3 pass, part of the 354 green above.

**Frontend half — read fresh, confirmed substantially rewritten as flagged.**
`frontend/src/components/agent-run/useRunStream.ts` no longer contains the post-run `run.plan`
walk with a `providerIdRef` fallback that both my first pass and `ledger.md`'s FE section
described — that mechanism is gone, not gated. Crediting is now entirely event-driven, inside the
SSE handler itself (`:85-93`):
```ts
const onEvent = (event: string, data: Record<string, unknown>) => {
  const id = data.connection_id;
  if (event === "node_done" && data.provider_verified === true && typeof id === "string" && id.trim()) {
    useProviderStore.getState().reportRunOutcome(id, { ok: true });
  }
  dispatch({ type: "sse", event, data });
};
```
Both conditions are required — `data.provider_verified === true` AND a non-empty string
`connection_id` — with no fallback branch of any kind. Confirmed this is the *only* place
`reportRunOutcome` is called from production code: `grep -rn "reportRunOutcome" frontend/src`
returns exactly the same 4 files as my first pass found (`useRunStream.ts` + its test,
`providerStore.ts` + its test) — no new caller was introduced.

Confirmed the backend only ever sets both fields together, only on a genuinely completed,
non-mock adapter call, in both real-spend paths:
- `backend/engine.py:562-572` (harness path) — inside the success branch, after
  `adapter.stream_events` already completed without raising, gated on `execution_mode != "mock"`:
  `node_done_data["connection_id"] = resolved.connection_id; node_done_data["provider_verified"] = True`.
  `resolved` only exists in this branch (from `resolve_node_provider`, called a few lines above,
  itself only reached when `execution_mode != "mock"`) — never derived from `data.adapter` or any
  other graph-author-supplied field.
- `backend/routers/execution.py:584-595` (direct-mode path) — same shape:
  `"connection_id": connection_id, "provider_verified": connection_id is not None`, where
  `connection_id` (`:471`) comes from `resolved.connection_id`, itself from a genuine server-side
  `resolve_node_provider(...)` call (`:462-471`) keyed off `body.connection_id`, not echoed
  unvalidated from the request.

Backend regression coverage for exactly this contract:
`backend/tests/test_execution_provider_resolution.py::test_only_real_harness_turn_has_provider_evidence`
(`:271-284`) asserts an intrinsic `input` node's `node_done` carries no `provider_verified` at all
while the real adapter-backed node's does, with a real `connection_id`; a sibling test (`:265-268`)
confirms mock mode never emits `provider_verified` anywhere in the stream.

Frontend regression coverage: `useRunStream.test.ts` — read in full (332 lines). Substantially
rewritten alongside the implementation, not stale: every test now constructs `node_done` payloads
using the new `connection_id`/`provider_verified` shape rather than the old segment-based one. 15
tests total (confirmed via the actual vitest run above: `useRunStream.test.ts (15 tests) 67ms`,
all green) — 9 in the original provider-store-wiring `describe` (direct-mode fallback, a harness
node's own `connection_id`, the cross-attribution case, five must-not-fault cases), 4 in the
usageStore-refresh `describe`, and 2 standalone. The most directly on-point:
`"requires explicit completion evidence, never node_start or composer metadata"` (`:321-331`) —
puts `connection_id`/`provider_verified: true` on `node_start` instead of `node_done` and asserts
health stays `"setup"` (not credited), proving the guard is keyed specifically to `node_done`
carrying both fields, not to their mere presence anywhere in the stream. This is a real,
independently-meaningful regression test, not a rename of an old one.

The separate post-run usage-refresh `useEffect` (`:62-67`, unrelated to the security-sensitive
crediting decision) still keys off `s.adapter !== "mock"` rather than the two stricter fields —
harmless: it only triggers an extra `usageStore.refresh()` fetch, never a trust-signal write, and
since `_node_view` now forces intrinsic-node `adapter` to `"mock"` unconditionally, a spoofed
intrinsic node can no longer trip it either way. Not a finding.

### Item 2 — P2-2/P2-3: CONFIRMED, NaN/Infinity/-Infinity/1e400 all rejected

`backend/usage_tracking.py:157` (`set_budget_limit`) and `:178` (`_status_from`) both guard with
`not math.isfinite(limit_usd) or limit_usd < 0`. Read `backend/tests/test_budget_fixes.py` in full
(65 lines) rather than trust its name:
- `test_nonfinite_budget_preserves_valid_limit` (`:31-37`) is parametrized over exactly
  `['NaN', 'Infinity', '-Infinity', '1e400']`, sent as raw body content (not through Pydantic's
  normal JSON coercion, so it reaches the parser exactly as SEC's original exploit did). For each:
  sets a valid $5 budget first, then asserts the malformed PUT returns **400** (not 200), the
  budget is **still $5** afterward (not cleared, not corrupted), and `/usage/summary` still
  returns 200 (not the 500 cascade SEC originally found for `Infinity`). All four values covered
  by one parametrization, all four pass.
- `test_legacy_infinite_budget_reads_safely_and_blocks` (`:39-54`) seeds a pre-existing `inf` row
  directly (simulating data written before this fix existed) and confirms it now reads back as
  `state: "invalid"` / `limitUsd: null` rather than crashing, `/usage/summary` still works,
  `enforce_budget_or_raise` correctly raises (fails closed, not open) against it, and a fresh valid
  PUT recovers it to `state: "ok"`.
`backend/routers/usage.py:44-51`'s `PUT /usage/budget` handler catches the `ValueError` these
guards raise and converts it to `HTTPException(400, ...)` — traced end to end, not assumed.

### Item 3 — P2-4: mechanism CONFIRMED correct and wired; narrow-tradeoff claim NOT fully accurate

**Mechanism, read fresh:** `backend/usage_tracking.py:205-278`,
`enforce_budget_or_raise(db, *, model=None, residence=None)`. The added check (`:265-277`):
```python
if (
    status.limit_usd is not None
    and model
    and residence != "local"
    and blended_price_per_mtok(model) is None
):
    raise BudgetExceededError(...)
```
Exactly as described: budget set + non-local residence + uncatalogued model → refused; any budget
already exceeded/invalid still refuses first (unchanged prior checks above it); no model/residence
passed → behavior unchanged. Wired into both real-spend entry points:
- `run_harness`: `backend/routers/execution.py:276-284`, via
  `_first_provider_model_and_residence(graph, connections or {})` (`:112-132`), gated on
  `body.mode != "mock"`.
- `run_direct`: `backend/routers/execution.py:444-453`, same gate, model/residence derived from
  `body.model`/the resolved connection's `defaultModel`/`residence`.

**The specific sanity-check the task asked for:** yes, `claude-opus-5`, `claude-sonnet-5`,
`claude-fable-5-1`, and `claude-haiku-4-5` are all four literally present in
`backend/adapters/catalog.py:226-229`'s `MODEL_PRICES`. That narrow factual claim is true.

**But the broader claim it's used to support is not well-supported for two of the three named
connections.** The ledger's claim is: *"a subscription-billed cloud connection (anthropic/cursor/
openai)... the built-in catalog models for all three... are already priced, so this only bites a
hand-typed exotic model string... not normal use."* Traced each of the three:
- **anthropic** — fine, as claimed. Its 4 standard models are priced.
- **openai** — not fine. `catalog.py:219-223`'s own comment states pricing was *deliberately never
  populated* for OpenAI ("nothing in this codebase has ever read a real price for either of
  those [OpenAI or Ollama Cloud]... inventing numbers here would be exactly the fabricated-price
  mistake this feature is required to avoid"). `MODEL_PRICES` has zero bare OpenAI/Codex model
  entries (the one `"openai/..."` key present is an OpenRouter-routed id, a different connection
  entirely). Two real sub-cases, traced through `backend/providers/resolution.py:149-154` and
  `backend/adapters/cli_codex.py`:
  - If a person sets a `defaultModel` on their OpenAI connection (an ordinary configuration step,
    not a "hand-typed exotic" one) — e.g. whatever their Codex/ChatGPT subscription actually
    runs — `model` is truthy, `residence` is `"cloud"` (`catalog.py:104`), and since no OpenAI
    model is ever priced, **every single run on that connection is refused once any budget is
    configured.** This is normal use, refused every time, not an edge case.
  - If no `defaultModel` is set (also very plausible — `resolution.py:143-146`'s own comment says
    "The CLI adapters (claude/codex) tolerate that and fall back to their own default"), `model`
    resolves to `""`/`None` at the pre-run gate, the `model and ...` check short-circuits, and
    **the new refusal never fires at all** — the connection silently keeps the exact pre-fix
    bypass (real spend, $0.00 recorded, budget never sees it) this item was written to close.
  Either way, "only bites a hand-typed exotic model string, not normal use" does not hold for
  OpenAI.
- **cursor** — the claim is moot rather than true or false: `catalog.py:80` gives Cursor
  `capabilities: ["agent"]`, not `"chat"`, and `resolution.py:106-113` refuses any node with a
  non-chat provider outright (`"...does not serve chat turns, so a {node_type} node cannot target
  it"`). I found no `"delegate"`/agent-node execution path in `engine.py` at all (`grep -in
  "delegate" backend/engine.py` — no matches), so Cursor does not appear to be reachable through
  either budget-gated entry point today regardless of this fix.

  **Separately, a pre-existing, unrelated latent bug** (not touched by this story, not blocking
  this gate) makes the "no default model" case above possible in the first place:
  `resolution.py:49` defines `_HTTP_ADAPTERS_REQUIRE_MODEL = {"ollama", "openrouter", "openai"}`,
  but the membership test at `:150` checks it against `adapter_name`, and
  `ADAPTER_BY_PROVIDER["openai"] == "codex"` (`:38`) — not `"openai"`. `"codex" in
  {"ollama", "openrouter", "openai"}` is always `False`, so the "has no default model set" guard
  can never fire for an OpenAI connection, contrary to what the set's own membership plainly
  intends. Confirmed no test exercises this (`grep "no default model"` in `backend/tests/` finds
  only an Ollama case, `test_provider_resolution.py:112-116`). I'm not bouncing on this — it
  predates this story and `resolution.py` was read but not modified by any round today — but it's
  exactly why the "silently stays bypassed" sub-case above is real today, not hypothetical.
  Flagging separately for the backlog (see below), not as part of this story's gate.

**Disposition:** the P2-4 *mechanism* is correctly implemented, correctly wired, and does exactly
what its own docstring says — this is not an AC failure and I'm not bouncing on it. What needs
correcting is the *characterization* the implementer's own ledger uses to argue the residual gap
is narrow — it is narrow for Anthropic, moot for Cursor, and not narrow for OpenAI (refuses normal
use when configured, silently unenforced when not). This is squarely the disclosed-tradeoff
re-review the implementer already asked PO/SEC to hold — I'm supplying the accurate basis for it,
per the task's explicit request to sanity-check rather than take the claim on faith. Whether
"residence-only" remains acceptable, or OpenAI's `billing: "subscription"` should also exempt it
the way `residence: "local"` does, is a product call for PO, not QA.

### Item 4 — P3-2: CONFIRMED, exactly one usage row per real intake call either way

**`triage.py` half**, read in full (227 lines). `RouteResult` (`:100-122`) now carries
`tokens`/`connection_id`/`model` on every return past the point `invoke()` returns a result:
the `result.error` branch (`:195-202`) and the empty/engage-token branch (`:210-217`) both now
populate them from `result`/`resolved` — previously discarded, per `ledger.md`'s description,
confirmed by reading the diff context (both branches are clearly patched onto the dataclass's
result fields, not left at defaults). The two branches that never call `invoke()` at all — no
provider pinned (`:135-136`), `ProviderResolutionError` (`:153-156`) — correctly still return
all-zero defaults (nothing to carry). `invoke()` itself raising (`:181-182`) also correctly stays
all-zero (no result object exists to salvage from). The pre-existing `engage_harness=False` reply
path (`:219-226`) is unchanged.

**`routers/execution.py` half**, read in full context (`:135-167` `_reply_only_events`, `:170-213`
`_usage_rows_from_events`, `:292-407` the `run_harness` handler and its usage-row assembly).
Traced both paths concretely:
- **`engage_harness=False`** (reply-only): `_reply_only_events` (`:331-336`) synthesizes a full
  `node_start`/`node_done` pair carrying `routed.tokens`, appended to `events`.
  `_usage_rows_from_events(events, ..., source="harness")` (`:377-379`) turns that pairing into
  exactly one row. The new triage-row append (`:391`) is gated on `routed.engage_harness`, which
  is `False` here, so it does not fire. **One row, source="harness". Confirmed by
  `test_triage_reply_only_path_is_still_recorded_exactly_once`**
  (`test_execution_budget_enforcement.py:340-363`, read in full): asserts `"triage" not in
  by_source` and `by_source["harness"]["tokensTotal"] == 8`. Passes (part of the 354 green above).
- **`engage_harness=True`**: the real `execute_harness(...)` graph walk (`:338-352`) produces its
  own `events` for the harness's own nodes → its own rows via `_usage_rows_from_events` (source=
  "harness") — entirely separate spend from the triage/intake call. The new check (`:391`),
  `if routed is not None and routed.engage_harness and routed.tokens > 0`, appends exactly one
  *additional* row (source="triage") for the intake call itself when it actually spent tokens —
  additive to, never overlapping with, the harness nodes' own rows, because they are genuinely two
  different adapter calls. **Confirmed by
  `test_triage_intake_spend_is_recorded_when_it_engages_the_harness`**
  (`test_execution_budget_enforcement.py:312-337`, read in full): a stub adapter returns 42 tokens
  on the intake prompt and 100,000 on the harness node; asserts `by_source["triage"]["tokensTotal"]
  == 42`, `by_source["harness"]["tokensTotal"] == 100_000`, `summary["totalTokens"] == 100_042` —
  both counted, cleanly separately, sum correct. Passes.

No double-count, no drop, in either direction.

### Item 5 — P3-4: CONFIRMED, docstring is honest and the regression test is real (with one nuance)

`backend/models.py:127-150`, `BudgetConfig`'s docstring, read in full. States automations are
**not** covered, names the exact call sites checked, states why, cites the pinning test by name,
and states what must change before the docstring can honestly say "automations" again. Verified
each factual claim independently, not just that the prose reads honestly:
- `backend/main.py:38` — `AutomationScheduler(SessionLocal)`, no `execute_fn` argument.
- `backend/routers/automations.py:152` — `run_job(db, job_id)`, no `execute_fn` argument either.
- `backend/automations/scheduler.py:104,133` — both `run_job` and `AutomationScheduler.__init__`
  default `execute_fn` to `mock_execute` when none is passed.
Both production call sites confirmed to use the default. The docstring's claim is accurate today.

`backend/tests/test_scheduler.py::test_run_now_ignores_an_exhausted_budget` (`:57-75`), read in
full: sets a $0 budget (blocks all real spend per `_status_from`), runs a harness-enabled
automation job, asserts 200/`"complete"`/`result.mode == "mock"`. Passes today (part of the 354
green). **Nuance worth naming precisely, since the task asked me to confirm this would "actually
fail" on a future gap, not just that it passes today:** this test is an indirect tripwire, not a
direct one. It does not assert anything about budget enforcement directly — it pins `mode ==
"mock"`. The moment a real executor becomes the default `execute_fn` (the change this docstring is
guarding against), that assertion breaks, because a really-executed job's result would no longer
report `mode: "mock"` — regardless of whether budget gating was also wired in at the same time.
That's still a genuine, real trip-wire (a developer cannot silently swap in a real executor without
this test breaking and forcing them to look at it, and its own docstring right there explains why),
but it fires on *any* move away from mock execution, not specifically on a missing budget gate. An
honest distinction, not a defect — I'm not bouncing on it, just not overstating what it mechanically
guarantees.

### New backlog item flagged (not blocking this gate)

Filed as a background suggestion rather than folded into this story: the `_HTTP_ADAPTERS_REQUIRE_MODEL`
dict-key/adapter-name mismatch in `backend/providers/resolution.py` (described in Item 3 above) —
pre-existing, untouched by any round of this story, but directly relevant to why the P2-4 tradeoff
is wider than described for OpenAI connections with no default model configured.

### DoD

| Item | Verification |
|---|---|
| Full backend regression | PASS, independent, 354/354, 20.41s. |
| Full frontend regression | PASS, independent, 262/262, 58 files, 8.20s. |
| Typecheck | PASS, independent, exit 0. |
| Hang check (~30s bar) | Clear — longest suite 20.41s total; no individual test flagged. |
| P2-1 backend (intrinsic adapter forcing) | CONFIRMED, `engine.py:118-142`, tested 3/3. |
| P2-1 frontend (dual-field crediting guard) | CONFIRMED, `useRunStream.ts:85-93`, tested 15/15, rewrite is not stale. |
| P2-2/P2-3 (NaN/Infinity/1e400 budget) | CONFIRMED, `usage_tracking.py:157,178`, tested 5/5 across both cases. |
| P2-4 (unpriced-model budget refusal) | Mechanism CONFIRMED correct and wired both call sites; narrow-tradeoff claim corrected for PO/SEC (see Item 3). |
| P3-2 (triage spend recording, no double-count) | CONFIRMED both paths, tested with explicit sum assertions. |
| P3-4 (automations docstring + regression pin) | CONFIRMED honest; regression test real but indirect (see Item 5 nuance). |
| Commit/merge/server state | QA made no commits, no merges, did not touch either dev server. |
| SEC parallel re-pass | Not read, not coordinated with, per task instruction — separate gate. |

### Verdict

All five items hold up against current disk state, independently re-derived from source (not
taken on any report's word), each backed by passing tests I traced and, where feasible, read in
full rather than trusted by name. Fresh full-suite run is clean in both stacks with no hang. One
substantive correction is owed to the implementer's own disclosed-tradeoff framing for P2-4 (Item
3 above) — real, but not a defect in what was built, and already the subject of a PO/SEC re-review
the implementer itself requested; I'm supplying accurate grounds for that review, not blocking on
it. One new pre-existing, out-of-scope bug flagged separately for the backlog, not gating this
story.

**QA gate verdict: Approved for Architecture Review — Story PROVIDER-VERIFY-BUDGET, all five
closing items (P2-1 both halves, P2-2/P2-3, P2-4, P3-2, P3-4).** This is the QA axis only, covering
this pass's five items on top of the two Story-2 findings approved above. The parallel SEC re-pass
in `security.md` is independent and unread by this pass — Sonnet's consolidated handoff needs both
verdicts before HITL merge. Sonnet should carry the P2-4 tradeoff correction (Item 3) into that
handoff verbatim rather than the ledger's original "narrow" framing — it changes what PO/SEC are
actually being asked to accept.

## Re-verification — 2026-09-15 (P2-4 positional-bypass fix + the OpenAI-shaped empty-model gap)

Fourth independent fresh-context QA pass on this story. Narrow scope, per the task: re-verify, against
current disk state, the fix for the positional bypass `security.md`'s re-review found in the closing
pass above (`## Re-verification of the original four P2s` → `### P2-4 — NOT CLOSED`), plus Sonnet's
direct follow-up fix for the empty-model gap. Read `ledger.md`'s `## Item 2 — P2-4` (the original,
gap-containing fix) and `## Sonnet direct fix — 2026-09-15` (its newest section) and `security.md`'s
`### P2-4 — NOT CLOSED` + `## The SEC-P2-4 tradeoff` sections before touching code. Items 1-5 from my
prior closing pass above stand approved and were not re-litigated — only item 3/P2-4 was in scope.

**One attribution correction for the record, not a finding.** The task brief framed both the
positional-bypass gap and the OpenAI empty-model gap as things "you [QA] sharpened." Checking my own
prior section above: I only explicitly named the OpenAI/billing-tradeoff mischaracterization (the
"narrow-tradeoff claim NOT fully accurate" heading) and its "silently stays bypassed" sub-case when no
`defaultModel` is set. I did not flag the first-node-only sampling architecture as its own defect —
I described the mechanism then in front of me as "correctly implemented, correctly wired." The
positional/decoy-node finding is `security.md`'s (`### P2-4 — NOT CLOSED`, reproduced with the
priced→unpriced, majority-unpriced, decoy-intrinsic, and decoy-residence cases). Keeping this straight
because the empty-model gap Sonnet closed today traces directly back to my own prior finding, while the
architectural rewrite (per-node checking) traces to SEC's — different people should get credit for what
they actually caught.

### Test execution (cold, independent, this pass's own numbers)

```
backend/   .venv/Scripts/python.exe -m pytest -q          365 passed, 7 warnings, 21.67s
frontend/  npm test                                        58 files / 262 tests passed, 8.81s
frontend/  npm run typecheck                                tsc --noEmit, exit 0, clean
```

365 and 262/58 match `ledger.md`'s newest section exactly. No suite or individual test came near the
~30s hang bar (backend 21.67s; frontend 8.81s). Same two pre-existing warning pairs as every prior
pass (`datetime.utcnow()` deprecation ×2 in `routers/automations.py:132`/`routers/cowork.py:107`,
Windows `.pytest_cache` permission ×2 — cosmetic, unrelated to this story).

**Frontend-unaffected claim, checked rather than assumed** (this was a backend-only change): compared
precise mtimes (`ls --time-style=full-iso`) of the five backend files this fix touched
(`engine.py` 07:48, `routers/execution.py`/`usage_tracking.py`/`tests/test_usage_tracking.py` all
11:54 — Sonnet's fix window) against the frontend files SEC's/my prior passes named as relevant
(`useRunStream.ts` 02:55, `Dossier.tsx` 02:26, `providerStore.ts`/`PropertiesPanel.tsx` both Sep 13 —
two days earlier). Then swept the whole tree: `Get-ChildItem frontend/src -Recurse -File | Where
LastWriteTime -gt "2026-09-15 07:00:00"` returned **zero files**. Nothing under `frontend/src` was
touched in either the positional-bypass fix window or Sonnet's model_expected window. The unchanged
262/262/58 count has a verified reason, not just a coincidence.

### Item 1 — Positional bypass: CLOSED, verified against all four of SEC's FAIL scenarios plus two of my own

**Mechanism, read fresh.** `backend/routers/execution.py`: `_first_provider_model_and_residence`
(the function SEC's finding was about) is **gone** — grep for it across the file finds only two
comments explaining why it was removed (`:121`, in `_enforce_node_budget`'s docstring; `:281`, in
`run_harness`'s). `run_harness`'s pre-run gate (`:290-295`) now calls `enforce_budget_or_raise(db)`
with no model/residence at all — it only catches an already-exhausted/invalid budget, which has no
positional problem since it doesn't depend on which node is about to spend. The real check moved into
`engine.py`'s node loop itself (`:463-490`): once per real (non-mock) node, right after that node's own
`resolve_node_provider()` result is known and *before* `adapter.stream_events` runs, it calls
`enforce_budget(config.model, residence)` where `residence = connections.get(resolved.connection_id,
{}).get("residence")` — both values keyed off `resolved`, the same engine-attested truth `node_view`
already reports honestly, never off graph-author-supplied `data`. `execute_harness` is wired with
`enforce_budget=_enforce_node_budget` at the one call site (`routers/execution.py:357`).
`_enforce_node_budget` (`:112-134`) opens its own DB session (the request-scoped one is long torn down
inside the SSE generator) and calls `usage_tracking.enforce_budget_or_raise(session, model=model,
residence=residence, model_expected=True)`.

**Existing test suite, run fresh and verbose, not trusted by name:**
```
tests/test_engine_budget_enforcement.py .....                [5 tests]
tests/test_execution_budget_enforcement.py .................  [17 tests]
tests/test_usage_tracking.py ..............................  [30 tests]
52 passed, 5.75s
```
`test_engine_budget_enforcement.py` (read in full, 310 lines) exercises the engine's own wiring
directly against a lightweight stand-in for the real gate (same pricing lookup, no DB) and names SEC's
four scenarios almost verbatim: `test_priced_then_unpriced_two_node_graph_is_refused_at_the_unpriced_node`,
`test_majority_unpriced_chain_stops_at_the_first_unpriced_node`,
`test_decoy_intrinsic_node_does_not_hide_real_unpriced_llm_nodes`,
`test_decoy_local_residence_node_does_not_exempt_real_cloud_spend`, plus a regression guard proving
every pre-existing `execute_harness` caller that never passes `enforce_budget` is unaffected. Each
asserts specifically which node errors, that the adapter was never called for the node behind the
decoy/later position (`stub.calls`), and that `harness_done.total_tokens` reflects only the real spend
that happened before refusal — not tautological pass-throughs. `test_execution_budget_enforcement.py`
(read `:278-451`) proves the same four shapes end-to-end over HTTP (router → engine → resolver → DB),
additionally asserting `/usage/summary` afterward (e.g. the priced-then-unpriced case: exactly
`totalTokens: 100_000` / `totalCostUsd: 4.5`, not the pre-fix silent $0.00/"ok").

**My own independent repro**, own model names and node ids not used anywhere in the existing suite,
run against a fully isolated temp DB (mirroring `tests/conftest.py`'s isolation, not the real one —
see the operational note below for why that mattered) via `TestClient`, covering one shape not in the
existing suite at all — a decoy node claiming **both** tricks at once (priced model *and* local
residence simultaneously) hiding a real cloud+unpriced node:
```json
{
  "combo decoy (priced-model claim + local-residence claim) hiding real cloud+unpriced node": {
    "http_status": 200, "node_error_seen": true,
    "node_error_text": "...price for model 'qa-totally-unlisted-model-7b' is not in the catalog...",
    "node_done_seen_for_real_node": false, "adapter_actually_called_for_real_node": 0,
    "summary_totalTokens": 0, "summary_totalCostUsd": 0.0
  },
  "3-node chain, own unpriced model names, refusal must land on n-unpriced-a and never reach n-unpriced-b": {
    "http_status": 200, "priced_node_completed": true, "refused_at_a": true,
    "b_ever_appeared_in_stream": false, "adapter_calls_total": 1,
    "summary_totalTokens": 250000, "summary_totalCostUsd": 11.25
  }
}
```
Both refuse correctly at the real spending node, the decoy's double claim (local + priced) does not
exempt anything, the later node never even appears in the stream, and the ledger math checks out
(250,000 tokens × $45/Mtok blended for `claude-opus-5` = $11.25 for the one node that actually ran).
The fix generalizes — it is not keyed to the specific strings the shipped tests happen to use.

**All four of SEC's FAIL scenarios, plus two novel ones, now refuse (or stop the specific offending
node) rather than sail through. Item 1 CLOSED.**

### Item 2 — The empty-model gap: CLOSED for the path it targets, correctly scoped elsewhere

`backend/usage_tracking.py:205-298`, `enforce_budget_or_raise`'s new `model_expected: bool = False`
parameter, read in full. Logic (`:280-297`): `if model:` → uncatalogued-model refusal (unchanged from
the original P2-4 fix); `elif model_expected:` → refuses with *"this node's connection has no default
model set"* (distinct wording from the catalog-miss message, not the odd `model ''` phrasing Sonnet's
ledger flagged wanting to avoid). Both live under the existing `status.limit_usd is not None and
residence != "local"` guard.

**(a) Pre-run/preview call sites unmodified.** Grepped every actual call of
`enforce_budget_or_raise\(` across `backend/` (17 hits: the definition, 3 in `routers/execution.py`,
1 in `test_budget_fixes.py`, 12 in `test_usage_tracking.py`). Production call sites total exactly 3:
- `routers/execution.py:293` (`run_harness`'s pre-run gate) — `enforce_budget_or_raise(db)`, no
  kwargs at all.
- `routers/execution.py:461-463` (`run_direct`'s pre-run gate) — `model=pre_model or None,
  residence=pre_connection.get("residence")`, no `model_expected`.
Neither passes `model_expected`, so both default `False` — an empty `model` there still short-circuits
past both the `if model:` and `elif model_expected:` branches, exactly the pre-existing "nothing known
yet, don't check" behaviour. Confirmed by running, not just reading: all 30 tests in
`test_usage_tracking.py` (including every pre-existing call shape) plus the 17 in
`test_execution_budget_enforcement.py` pass.

**(b) The per-node harness callback.** `routers/execution.py:132-134`, the third call site — inside
`_enforce_node_budget`, the only one that fires past a real `resolve_node_provider()` success —
passes `model_expected=True`. Confirmed this refuses an empty model when a budget is set and residence
isn't local, and that the local-residence exemption still holds with an empty model, directly via the
two new unit tests (below) and via the "no default model set" wording appearing correctly in a real
end-to-end run when I forced a CLI-style empty-model connection in my own repro's connections dict.

**(c) `/execute/direct` deliberately left at the default — confirmed reasoned, confirmed it does not
reopen the positional-bypass finding, but the residual is real and worth naming precisely.**
`routers/execution.py:456-465` is unchanged in shape from before Sonnet's fix: a pre-resolution guess,
no `model_expected`. This is not an oversight — `/execute/direct` handles exactly one synthetic node
and one adapter call (`:467-496`); there is no second node for a decoy to hide behind, so the
positional-bypass class SEC found structurally cannot occur here, confirmed by re-reading the whole
handler. Tightening a pre-resolution guess would also risk a false refusal ahead of the real
resolution that might legitimately fill in a model. Both of the task's two specific asks hold.

What I traced further, since the task's own framing ("the single most common path... for no closed gap
in return") invited checking exactly how common: `/execute/direct` has **no post-resolution budget
check of any kind** — unlike the harness path, nothing plays the role `_enforce_node_budget` now plays
after `resolve_node_provider()` succeeds (`:474-483`); the adapter is simply called next. And the real
frontend caller never gives the pre-run guess anything to work with —
`frontend/src/components/agent-run/useRunStream.ts:106-110` calls `startDirectRun({ instruction, mode,
step, cwd, connection_id: providerId }, ...)`: `model` is never passed, on every direct-mode call the
product makes. So `pre_model` reduces to `pre_connection.get("defaultModel", "")` for literally every
real chat turn, and for any CLI-adapter connection with no `defaultModel` configured — which
`providers/resolution.py`'s own comment (quoted in my prior pass, Item 3) calls a tolerated, normal
state for the Claude/Codex CLI adapters, not a misconfiguration — that resolves to `""` every time.
Budget configured + non-local residence + such a connection = every direct-mode/chat turn on it still
runs with the ceiling blind to it, silently, exactly the pre-fix defect shape, just reached through an
empty guess instead of a positional sample.

This is not a new, undisclosed defect: it is the concrete, sharpened form of the "silently stays
bypassed" sub-case I already flagged in my prior pass's Item 3 (OpenAI, no default model), now
confirmed to run through the single most common interaction path rather than a corner case, and now
distinguishable from the positional-bypass class SEC fixed. It is out of scope for what Sonnet's fix
was asked to close today (correctly — the ledger lists `/execute/direct`'s preview check under "not
touched," by design) and it is not what SEC's positional-bypass re-review was about, so **I am not
bouncing on it** — that would re-litigate a routing call I already made in my prior pass (→ PO, for the
billing-aware-exemption product decision; → SEC, already re-reviewing). But it needs to reach the
consolidated handoff by name, not fall out of the "all clear" framing: the PO/SEC decision on a
billing-aware exemption my prior pass asked for is still pending, and closing it would close this
residual too, since both keyed off the same resolved-connection information. Recommend Sonnet's
handoff either carry this forward explicitly as a named fast-follow with the reachability evidence
above, or get the PO/SEC call made before merge rather than after.

### Item 3 — New test coverage sanity-checked, not just trusted by name

`backend/tests/test_usage_tracking.py:469-502`, read in full:
- `test_enforce_budget_refuses_an_empty_model_when_the_caller_already_resolved` (`:469-486`):
  `model="", residence="cloud", model_expected=True`, budget set to $5 → asserts
  `pytest.raises(BudgetExceededError, match="no default model")`. Matches the actual message text in
  `usage_tracking.py:292` (`"...this node's connection has no default model set..."`) — the regex
  isn't matching a coincidental substring, it's matching the specific phrase the fix introduces.
- `test_enforce_budget_still_allows_empty_model_on_a_local_connection` (`:489-502`): same shape but
  `residence="local"` → asserts `status.state == "ok"`, i.e. no raise. Confirms the local exemption
  composes correctly with `model_expected=True` rather than being silently overridden by it.

Both docstrings correctly describe what they pin (quoted the "QA re-review, 2026-09-15" callout in the
first one's docstring — it cites this exact gap). Both pass, part of the 365 green above. **Item 3
CONFIRMED — the tests exercise exactly what's claimed, not a weaker or unrelated assertion.**

### Operational note — my own process, disclosed rather than buried

My first attempt at the independent repro above (Item 1) targeted the real
`backend/data/harness.db` by mistake — I hadn't yet replicated `tests/conftest.py`'s `DATABASE_URL`
redirect to an isolated temp path, only its ordering (reset-after-`TestClient`-entry). Two `DELETE
FROM usage_records` / `DELETE FROM budget_config` calls ran against that real file before the
subsequent request failed on auth (401 — I also hadn't replicated the sidecar-token bootstrap yet) and
I caught the gap. Checked current state directly: `usage_records` and `budget_config` are both 0 rows;
`execution_logs` (69 rows) and `harnesses` (0 rows) — the two tables I never issued a `DELETE`
against — are unchanged. Best-evidenced explanation, not a guess: `usage_records`/`budget_config` did
not exist as tables in that real file until my script's first `TestClient` entry ran `init_db()`
against it (SQLAlchemy's `create_all` only adds missing tables, never touches existing ones or their
rows) — consistent with the real dev server apparently never having been restarted against this file
since those two models were added, since every prior pass's test runs went through `conftest.py`'s
isolated temp DB, never this file. No `.venv`/port-8000 listener was running at the time I checked
(`Get-NetTCPConnection -LocalPort 8000` returned nothing), ruling out a concurrent real session losing
data to my reset calls. I rewrote the script with full isolation (temp `DATABASE_URL`, temp secrets
dir, pinned sidecar token, same asserts `tests/conftest.py` uses to refuse running under the real data
dir) before running anything else against it — that corrected script is what Item 1's results above
come from. Flagging this plainly because it's a real mistake I made mid-task, even though I'm
confident, not just hopeful, that no real row was lost.

### DoD (this pass)

| Item | Verification |
|---|---|
| Full backend regression | PASS, independent, 365/365, 21.67s. |
| Full frontend regression | PASS, independent, 262/262, 58 files, 8.81s. |
| Typecheck | PASS, independent, exit 0. |
| Frontend genuinely unaffected | CONFIRMED via mtime sweep, not assumed — zero `frontend/src` files touched in either fix window. |
| Hang check (~30s bar) | Clear — longest suite 21.67s; no individual test flagged. |
| Item 1 — positional bypass | CLOSED. All four SEC FAIL scenarios + 2 novel ones (own identifiers, combo trick) refuse correctly. |
| Item 2 — empty-model gap (harness path) | CLOSED. `model_expected=True` wired at the one post-resolution call site; both pre-run sites correctly left unmodified. |
| Item 2(c) — `/execute/direct` scope decision | Reasoned, does not reopen the positional-bypass finding — CONFIRMED. Residual empty-model exposure on this path is real, reachable via the actual product's only caller, and carried forward to the consolidated handoff (not blocking). |
| Item 3 — new test coverage | CONFIRMED, exercises exactly what's claimed. |
| Commit/merge/server state | QA made no commits, no merges, did not start or touch either dev server. One process mistake (real-DB-targeting script) caught and corrected; disclosed above. |

### Verdict

Items 1-5 from my prior closing pass stand approved. This pass's specific mandate — P2-4's positional-
bypass architecture and the empty-model gap in the harness path — is genuinely clean: both are closed,
both are backed by fresh-run tests I read and verified are not tautological, and I additionally
reproduced the fix independently with identifiers and a combined-trick scenario the shipped tests don't
use. Frontend is confirmed, not assumed, unaffected. No hang, no red test, cold full-suite counts match
the ledger exactly (365/365 backend, 262/262/58 files frontend, typecheck clean).

One item is carried forward rather than closed: `/execute/direct`'s own empty-model exposure (Item
2(c) above) is the same defect class, on the single most common interaction path, and is not yet
covered by either today's fix or a PO decision — it is the sharpened form of my own prior pass's
OpenAI-tradeoff finding, already routed to PO/SEC, not a new miss. Not gating this pass; must not be
dropped from the consolidated handoff.

**QA gate verdict: Approved for Architecture Review — Story PROVIDER-VERIFY-BUDGET, P2-4 re-verification
complete.** This is the last QA pass needed on the positional-bypass and empty-model fixes specifically.
Sonnet's consolidated handoff should carry forward, by name: (1) the SEC-vs-QA attribution correction
above, (2) the `/execute/direct` residual as a named fast-follow or a pre-merge PO/SEC call, and (3) the
still-pending billing-aware-exemption product decision from my prior pass, which would close both the
OpenAI tradeoff and this residual in one move. I did not read `security.md`'s parallel closing re-pass
(if one exists yet) per the task's instruction that Sonnet is consolidating separately.
