# Security Review — PROVIDER-VERIFY-BUDGET (Story 1: connection trust signal · Story 2: token/cost/budget)

Verdict: **FAIL** — 4 × P2, 4 × P3. No P0, no P1. Security Gate Failure — Story PROVIDER-VERIFY-BUDGET.

Independent fresh-context SEC review on 2026-09-15, following the authoritative harness `SEC.md` profile. The
implementers crashed on a rate limit before their own SEC gate; this review therefore saw no prior SEC/ARCH
sign-off for this slice and read only source, tests and the sprint-2026-09-12 `security.md` (for format). A
parallel QA pass was running on the same two stories; `qa.md` in this directory was **not read**, to keep the
security axis independent. No product code, test, backend state, running server, commit or merge was changed
by SEC — the four findings below are reported, not patched. This is a scoped review of the two stories'
surfaces, not a repository-wide security guarantee.

## Scope and trust boundaries

**Story 1** is a trust-signal surface with no credential handling: `reportRunOutcome` moves a connection's
`health` (which renders as "Verified" / "Not verified" / "Needs attention",
`frontend/src/components/agent/chatProvider.ts:49-54`). Its only input is the SSE stream of a run **the same
browser tab started itself**, so there is no cross-process spoofing vector — the realistic adversary is a
graph whose contents the person did not author (an imported `.oharness` bundle), or a `POST /execute/` from
another local process holding the sidecar token.

**Story 2** is a spending control. Its trust boundary is the sidecar's local-process auth
(`backend/security/sidecar_token.py`, enforced at `backend/main.py:87-108`). The budget is the only thing
standing between an unattended harness run and unbounded real API spend; client-side validation in
`ProvidersList.tsx` is not part of that boundary, since any local process with the token can call the
endpoints directly.

Not in scope, unchanged by this slice, and **not** certified here: the CORS allowlist and the SEC-3 token
design itself (including `next.config.ts:47` baking `NEXT_PUBLIC_OH_SIDECAR_TOKEN` into the dev bundle —
pre-existing, documented at `frontend/next.config.ts:25-27`), adapter/vendor transport security, repo
providers, secrets-store backends, and `cwd` validation.

---

## Findings

### P2-1 — A connection can read "Verified by a real run just now" with zero vendor contact

- **Location:** `backend/engine.py:122-132` (`_node_view`), used unmodified at `backend/engine.py:297`, `:310`,
  `:322`, `:342`; consumed at `frontend/src/components/agent-run/useRunStream.ts:105-111`.
- **Issue:** `_node_view()` sets `"adapter": data.get("adapter", "mock")` — the graph node's own author-supplied
  field. For adapter-backed nodes this is overwritten with the real resolved adapter at `engine.py:429`
  (`node_view["adapter"] = adapter_name`). For the four **intrinsic** node types — `input`, `output`, `router`,
  `hitl` — it is not: those branches emit `node_start` as `{**_node_view(node)}` verbatim, in **every** mode
  including `mock`, and carry no `connection_id`. Each then emits `node_done`, so the segment reaches
  `state: "done"`.

  `useRunStream.ts:106` filters on `s.adapter === "mock"` only. An intrinsic node whose `data.adapter` is any
  other string passes that filter; `useRunStream.ts:107` then falls back to `providerIdRef.current` because no
  `connection_id` was on the wire, and `providerStore.ts:504-511` writes `health: "live"`, detail
  `"Verified by a real run just now."` — for whichever connection the composer happens to have selected, which
  was never exercised.
- **Verified empirically** (in-process `execute_harness`, `execution_mode="mock"`, graph of
  `input → router → output` each with `data.adapter: "claude"`):

  ```text
  node_start  node_id='n1'  adapter='claude'  connection_id=<ABSENT>
  node_start  node_id='n2'  adapter='claude'  connection_id=<ABSENT>
  node_start  node_id='n3'  adapter='claude'  connection_id=<ABSENT>
  harness_done: {'status': 'complete', 'total_tokens': 0, 'nodes_run': 3}
  ```

- **Reachability, precisely:** *not* reachable through the Studio inspector — the Adapter field is gated to
  `agent | gate | skill` (`frontend/src/components/sidebar/PropertiesPanel.tsx:273`, field at `:342-353`).
  It **is** reachable via (a) an imported bundle: `frontend/src/lib/bundleGraph.ts:113` preserves
  `existingData.adapter` on every node with no type filter, and `resolveType` keeps `hitl` as `hitl`
  (`bundleGraph.ts:3`, `:21-26`) — so a bundle whose HITL gate carries `data.adapter: "claude"` credits the
  composer's connection the moment a person approves the gate; and (b) any `POST /execute/` with a
  hand-built `graph_json`, where all four intrinsic types survive.
- **Risk:** the "Verified" badge is the signal a person uses to decide a connection is safe to leave running
  unattended. A bundle from outside can set it without a single vendor call, and it persists until a real
  probe contradicts it. Impact is bounded: `autoPick` filters on `enabled && health !== "fault"`
  (`chatProvider.ts:24-27`), so a false `"live"` does **not** make a connection more likely to be
  auto-selected than an untested one — this is a human-trust defect, not a routing defect. That bound is why
  this is P2 and not P1.
- **Fix:** set `adapter` from the engine's own knowledge rather than from graph data. Either override it in the
  intrinsic branches (`node_view["adapter"] = ""`, since no adapter ran) or drop the `data.get("adapter", ...)`
  default from `_node_view` entirely and have only the adapter-backed branch populate it. Belt-and-braces on the
  consumer side: require `s.connectionId` to be present rather than falling back to `providerIdRef` for a node
  that never reported one, and align the exclusion list with the backend's `_NO_SPEND_ADAPTERS`
  (`backend/usage_tracking.py:51`) instead of testing `=== "mock"` alone.

### P2-2 — `PUT /usage/budget {"limitUsd": NaN}` silently clears an enforced budget and returns 200

- **Location:** `backend/usage_tracking.py:156` (`if limit_usd is not None and limit_usd < 0`), reached from
  `backend/routers/usage.py:44-51`.
- **Issue:** the guard is `< 0`, and `NaN < 0` is `False`, so `NaN` is accepted. `json.loads` (Starlette's body
  parser) accepts the bare `NaN` literal, and Pydantic v2's `float` allows non-finite values by default, so it
  reaches `set_budget_limit` intact. SQLite coerces `NaN` to `NULL` on write, which is the "no budget set"
  sentinel (`backend/models.py`, `BudgetConfig.limit_usd`).
- **Verified empirically** (isolated temp DB, authenticated, live sidecar untouched):

  ```text
  (baseline) GET after limit=5   -> 200 {"limitUsd":5.0,...,"state":"ok"}
  raw body {"limitUsd": NaN}     -> 200 {"limitUsd":null,...,"state":"unset"}
     then GET /usage/budget      -> 200 {"limitUsd":null,...,"state":"unset"}
  ```

- **Risk:** one authenticated local request removes the spending ceiling entirely, and the 200 response is
  indistinguishable from a successful budget update — nothing tells the person their ceiling is gone. The
  app's own UI rejects this (`frontend/src/components/providers/ProvidersList.tsx:115`,
  `!Number.isFinite(n) || n < 0`), but client-side validation is not the gate here: `sidecar_token.py`'s whole
  premise is that the sidecar must be correct against *any* local process holding the token.
- **Fix:** reject non-finite values server-side in `set_budget_limit` — `if limit_usd is not None and (not
  math.isfinite(limit_usd) or limit_usd < 0): raise ValueError(...)`. Optionally also set
  `model_config = ConfigDict(allow_inf_nan=False)` on `BudgetBody` (`routers/usage.py:24-25`) so it fails as a
  422 at the schema edge.

### P2-3 — `{"limitUsd": Infinity}` writes an infinite ceiling, then 500s the entire usage surface

- **Location:** same guard (`backend/usage_tracking.py:156`); commit at `:163` happens *before* the response is
  rendered by `routers/usage.py:50-51`.
- **Issue:** `inf < 0` is `False`, so `inf` is accepted and committed. SQLite stores it (unlike `NaN`). Rendering
  the response then raises `ValueError: Out of range float values are not JSON compliant: inf` from
  `starlette/responses.py:183` — an unhandled 500. Because the row is already committed, every subsequent
  `GET /usage/budget` **and** `GET /usage/summary` 500s on the same encode.
- **Verified empirically:**

  ```text
  raw body {"limitUsd": Infinity}  -> 500 Internal Server Error
     then GET /usage/budget        -> 500 Internal Server Error
     then GET /usage/summary       -> 500 Internal Server Error
     recover: PUT limitUsd=5       -> 200 {"limitUsd":5.0,...,"state":"ok"}
  ```

  `{"limitUsd": 1e400}` (which `json.loads` parses to `inf`) behaves identically.
- **Risk:** two effects at once. The ceiling becomes `inf` — `_status_from` computes `pct = spent/inf = 0.0`,
  `state = "ok"` forever, so enforcement never fires. And the whole usage/budget read surface is down, so the
  Providers screen cannot show the person that anything is wrong. Recoverable only by a well-formed PUT, which
  the broken UI can no longer offer (the strip renders from `useUsageStore`'s `summary`, which is now an error).
- **Fix:** the same `math.isfinite` guard as P2-2 closes both. Independently, `_status_json`
  (`routers/usage.py:28-35`) should not be able to emit a non-JSON-compliant float regardless of what is in the
  row, so that a legacy `inf` already persisted can still be read and corrected.

### P2-4 — Tokens on any model outside the 12-entry price catalog cost $0.00, so the ceiling never sees them

- **Location:** `backend/usage_tracking.py:79-82` (`compute_cost`), `backend/adapters/catalog.py`
  (`MODEL_PRICES`, `get_model_price`), enforcement at `backend/usage_tracking.py:202-235`.
- **Issue:** `compute_cost` returns `(0.0, None)` for any `model` string not literally present in
  `MODEL_PRICES` (12 entries). `total_spend_usd` sums `cost_usd` only, and `enforce_budget_or_raise` compares
  that sum to the limit. Unpriced tokens therefore contribute exactly nothing to the ceiling. The `model` value
  is free-text on every path: `DirectRequest.model: str | None` (`routers/execution.py:40`), graph
  `data.model` from a plain text input (`PropertiesPanel.tsx:329-336`, placeholder at `:334` reading
  `"e.g. gpt-4o, claude-sonnet-4, llama3.2"` — none of which are in the catalog).
- **Verified empirically:**

  ```text
  10M tokens of 'anthropic/claude-opus-5'   -> cost_usd=$450.0  price_per_mtok=45.0
  10M tokens of 'anthropic/claude-opus-4.1' -> cost_usd=$0.0    price_per_mtok=None
  10M tokens of 'z-ai/glm-4.6'              -> cost_usd=$0.0    price_per_mtok=None
  10M tokens of 'openai/gpt-5-6-sol '       -> cost_usd=$0.0    price_per_mtok=None   (trailing space)

  budget $5.00; 1,000,000,000 real tokens recorded on 'z-ai/glm-4.6':
    spent=$0.0  limit=$5.0  state='ok'   next run-start: ALLOWED
  ```

- **Assessment, stated honestly:** the *arithmetic* is deliberate, documented and tested — `catalog.py:211-218`
  explains why inventing prices would be worse, and `tests/test_usage_tracking.py:70`
  (`compute_cost_unknown_model_is_honestly_free_not_fabricated`) pins it. The defect is not the pricing
  decision; it is that `enforce_budget_or_raise` has **only** a USD side. The ledger already carries the
  information needed to notice (`routers/usage.py:60-62` surfaces `unpricedTokens` to the UI) — the gate
  ignores it. For subscription/local connections (`anthropic`, `cursor`, `openai`, `ollama` — all
  `billing: "subscription"` / local in `catalog.py`) a $0 cost is genuinely right. For **OpenRouter**
  (`billing: "credits"`, api-key, `catalog.py`'s openrouter spec) it is not: the seed lists 8 OpenRouter models
  and the real catalogue is far larger, so choosing any other route spends real credits at $0.00 on the ledger.
- **Risk:** the documented hard-stop is bypassed by a model-name choice — no exploit needed, just picking a model
  the catalog has not been updated for. This is the "unattended harness → unbounded API spend" case the feature
  exists to prevent.
- **Fix (either, not both):** (a) make `enforce_budget_or_raise` refuse when unpriced tokens on a *cloud,
  credit-billed* connection exceed a companion token ceiling, so unknown price never reads as unlimited budget;
  or (b) at minimum, surface an explicit, blocking state — "budget cannot be enforced for this connection's
  model" — rather than letting an un-enforceable run start silently under a ceiling the person believes is live.

### P3-1 — Concurrent run-starts overshoot the ceiling by more than the docstring claims

- **Location:** `backend/usage_tracking.py:57` (`_budget_lock`), `:202-235` (`enforce_budget_or_raise`), spend
  committed only in the stream's finally-block (`backend/routers/execution.py:349-353`, `:552-564`).
- **Issue:** the `asyncio.Lock` serialises the read-then-decide, but reserves nothing. A run's cost is committed
  only when its SSE generator finishes, so the check-to-write window is **the entire duration of every in-flight
  run**, not an instant. There is no cap on concurrent runs (`RUNS` is an unbounded dict, `engine.py:80`).
- **Verified empirically** (8 concurrent `enforce_budget_or_raise` against a $5 ceiling at $0 spent, then each
  committing 50k tokens of `anthropic/claude-opus-5` = $2.25):

  ```text
  ceiling=$5.00, spent=$0.00, 8 simultaneous run-starts -> 8/8 ALLOWED
  after they commit: spent=$18.00 vs limit=$5.00 -> overshoot $13.00 (exceeded)
  ```

- **Assessment:** the module already documents this residual race honestly and declines to build a reservation
  system (`usage_tracking.py:213-224`) — that call is defensible and I am not reversing it. What is inaccurate
  is the *characterisation*: the docstring says "the last-instant race of two runs starting at the exact same
  moment before either has spent anything" and bounds the overshoot at "the cost of whichever run(s) were
  already in flight". With no concurrency cap and a minutes-long window, N is unbounded, so the bound is
  vacuous. P3 rather than P2 because the next start after the commits *is* correctly refused (verified), so this
  degrades the ceiling into a lagging control rather than removing it.
- **Fix:** no reservation system needed to improve this materially — cap concurrent non-mock runs (the `RUNS`
  registry already has the count), and/or re-check `enforce_budget_or_raise` between nodes inside
  `execute_harness` so a long run stops at the ceiling instead of only being refused at its start. Either way,
  correct the docstring to say the window is the run's lifetime.

### P3-2 — The triage/intake adapter call is real spend that is never recorded

- **Location:** `backend/triage.py:154` (`result = await resolved.adapter.invoke(...)`), result fields declared at
  `triage.py:108-117`; ledger assembly at `backend/routers/execution.py:145-188`.
- **Issue:** `route_message` always makes one real adapter call when the providers resolve. `RouteResult.tokens`
  /`connection_id`/`model` are populated **only** on the `engage_harness=False` branch (`triage.py:191-197`) —
  which `_reply_only_events` then turns into a proper `node_start`/`node_done` pair, so that half is counted
  correctly. On every other outcome — the `except` around the call (`triage.py:176-177`), `result.error`
  (`:179-180`), or the engage-token match (`:188-189`) — the tokens were already spent and the returned
  `RouteResult` carries `tokens=0`. Those events never enter `events`, so `_usage_rows_from_events` never sees
  them.
- **Risk:** the ledger and the ceiling systematically undercount by one adapter turn on every live/local chat run
  that engages the harness — monotonically, never corrected. Each individual turn is small (an intake prompt plus
  a short answer), which is why this is P3 and not P2, but it is exactly the "running total silently undercounts"
  shape the story asked to be checked for, and it compounds with P2-4.
- **Fix:** populate `tokens`/`connection_id`/`model`/`adapter_name` on `RouteResult` unconditionally (they are
  known in all cases where `invoke` returned), and have `run_harness` write one `source="triage"` ledger row for
  it regardless of which branch was taken.

### P3-3 — Per-row `round(..., 6)` loses money in one direction

- **Location:** `backend/usage_tracking.py:82` (`return round(tokens_total * price / 1_000_000, 6), price`).
- **Issue:** each row's cost is quantised to 1e-6 before being summed, so every row under-reports by up to
  $5e-7, always downward on average. Measured over 3000 single-token `claude-haiku-4-5` rows: true
  $0.0072, ledger `SUM()` $0.0060 — a 16.7% understatement.
- **Assessment:** the headline percentage comes from a pathological case (one token per row). The absolute bound
  is ≤ $5e-7 × row count, so at realistic turn sizes (thousands of tokens, per-row cost ≫ 1e-6) the error is
  negligible. Reported for completeness because the module's own precision claim
  (`usage_tracking.py:75-78`: "enough precision that summing many rows never visibly drifts") is about IEEE-754
  *addition* — and it is correct about that (the `_EPSILON` guard at `:44` and `:187` genuinely handles
  `50 × $0.10 = 4.999999999999998`, verified) — while the loss here comes from the *rounding*, which that claim
  does not cover.
- **Fix:** store the unrounded product and round only at display/serialisation (`routers/usage.py:30`, `:90`,
  `:105` already round on the way out), or widen the stored precision.

### P3-4 — `BudgetConfig`'s docstring claims coverage the code does not have

- **Location:** `backend/models.py` (`BudgetConfig` docstring: *"every token spent through this app: chat,
  harness runs, **automations**, any agent, any provider"*) vs `backend/automations/scheduler.py:63`
  (`mock_execute`), `:133` (`self.execute_fn = execute_fn or mock_execute`).
- **Issue:** the scheduler never calls `enforce_budget_or_raise` and never records usage, because today it only
  runs a stand-in. That makes the claim harmless *now* but wrong, and it is the exact sentence a future
  implementer would rely on when wiring `execute_fn` to the real pipeline — at which point automations become
  the second door past the ceiling.
- **Fix:** correct the docstring to say automations are not yet a spend path, and add the
  `enforce_budget_or_raise` call to `run_job` (`scheduler.py:90`) now, so the gate is in place before the real
  executor is attached.

---

## OWASP Top 10 scan

| Category | Scoped evidence and conclusion |
| --- | --- |
| A01 — Broken access control | **PASS.** The new `/usage` router is registered like every other (`backend/main.py:118`) and inherits the global middleware, whose only exemption is `/health` (`main.py:84`, `:98`). Verified independently: `GET /usage/summary`, `GET /usage/budget` and `PUT /usage/budget` all return 401 without a token and 200 with it. Already pinned by `backend/tests/test_sidecar_auth.py:61-73`. No endpoint was broadened; `reportRunOutcome` adds no endpoint at all. |
| A02 — Cryptographic failures | **N/A / PASS.** No crypto, transport or at-rest change in this slice. `UsageRecord` stores no credential — `connection_id`, `provider`, `adapter`, `model`, token counts, cost (`backend/models.py`, `usage_records` columns). Token comparison remains constant-time (`main.py:103`, `hmac.compare_digest`). |
| A03 — Injection | **PASS.** Every query in `routers/usage.py` is SQLAlchemy Core/ORM against typed columns — `select(func.coalesce(func.sum(UsageRecord.tokens_total), 0), ...)` (`:67-73`), `.group_by(UsageRecord.connection_id, UsageRecord.provider)` (`:83`), `case(...)` (`:60-62`). No string concatenation, no `text()`, no user-controlled column or table name. No shell exec added; no new HTML sink (frontend values render as React children / formatted strings, `frontend/src/lib/usageApi.ts:79-82`). |
| A04 — Insecure design | **FAIL** — P2-1, P2-4, P3-1, P3-2. The budget is a start-gate, not a running kill-switch: nothing re-checks it inside `execute_harness`, so a run spends every node after one check; the per-agent `tokenLimit` (`engine.py:515-531`) is explicitly post-hoc and says so in its own error text ("its tokens are already spent"), i.e. it is not a spend cap either. Correct by design: `mock` mode is exempt from the budget on both paths (`routers/execution.py:252`, `:387`) and the exemption is case-exact so any other mode string fails *closed*. |
| A05 — Security misconfiguration | **PASS (unchanged).** No CORS, debug-endpoint or server-config change in the scoped files. `_UNAUTHENTICATED_PATHS` still holds only `/health` (`main.py:84`). The header parse at `main.py:102` is case-sensitive on the literal `"Bearer "` after a case-insensitive `startswith` test — a lowercase `bearer` prefix fails to authenticate, which is a usability wrinkle in the fail-closed direction, not a bypass. |
| A06 — Vulnerable components | **Not assessed.** `git diff -- backend/requirements.txt frontend/package.json` was not isolated to this slice (the checkout carries unrelated uncommitted work across 60+ files), and no new import in the scoped files pulls a dependency that was not already present — `usage.py` uses only `fastapi`, `pydantic`, `sqlalchemy`. No CVE audit was performed; existing dependency security is not certified here. |
| A07 — Authentication and identity | **PASS.** No token/session change. The sidecar token's lifecycle (`security/sidecar_token.py:81-103`) is untouched by both stories. No parameter-manipulation bypass found on the new routes: `connection_id` on a ledger row is data, never an authorisation subject. |
| A08 — Software and data integrity | **FAIL** — P2-1. A graph field (`data.adapter`) is echoed into a wire event the client treats as engine-attested fact (`engine.py:122-132` → `useRunStream.ts:106`). Otherwise sound: `record_usage` refuses `mock`/`unresolved`/zero-token turns by construction (`usage_tracking.py:105`), so no synthetic number can enter the ledger, and `cost_usd` is frozen at write time so a later catalog edit cannot rewrite history. |
| A09 — Logging and monitoring | **PASS with a gap noted.** No credential or PII enters the ledger or the budget error text — `BudgetExceededError`'s message contains only the limit and the spend (`usage_tracking.py:229-234`). Gap: a budget-limit change is not audited anywhere (no row, no log) — `BudgetConfig` keeps only `updated_at`, not who/what/from-what-value. Given P2-2 and P2-3 can silently remove a ceiling, that is the one place an audit trail would have real value; folded into those fixes rather than raised separately. |
| A10 — SSRF | **PASS.** Nothing in `routers/usage.py`, `usage_tracking.py` or `usageApi.ts` makes an outbound request. `/execute/direct` builds its `AdapterConfig` with no `endpoint` field at all (`routers/execution.py:434-442`), so a client-supplied `adapter`/`model` cannot redirect a call. The editable-endpoint surface on `providers.py` is pre-existing and out of scope. |

### Specific questions asked, answered

- **Can `reportRunOutcome` be reached with a spoofed `connectionId`/`detail` from something other than a genuine run?** Not cross-process — the only caller is the browser's own effect over its own SSE stream (`useRunStream.ts:100-113`), and `connection_id` is engine-resolved (`engine.py:437`), never echoed from request data. But the *equivalent* outcome is reachable through the intrinsic-node path — see **P2-1**.
- **Can `isProviderLevelFailure` be gamed to leave a broken connection healthy?** Not currently exploitable: it is **not wired to anything**. `useRunStream` has no failure path at all (`useRunStream.ts:88-95`), by a deliberate, documented decision from the 2026-09-13 review (`providerStore.ts:376-393`) — prose `Segment.error` text can match those substrings by coincidence, and a false `fault` is unrecoverable without a manual Test while a stale `live` self-corrects. That reasoning is sound and I concur; the asymmetry is the right one. The listed signatures do miss real failures (`429`, `502`, `503`, `invalid_request_error`, `insufficient_quota`, `ECONNRESET`), which matters only for whoever wires this to a structured `error_kind` field later — noted, not counted as a finding, since the function is dead code today.
- **Can a disabled connection be re-marked usable by a late run outcome?** **No.** `toggleEnabled` writes `enabled: false` to local state *optimistically, before* awaiting the backend (`providerStore.ts:572-576` — the `set(...)` precedes `await ensureBackendRow`), and `reportRunOutcome` re-reads current state through `get()` at call time and returns early on `!c.enabled` (`providerStore.ts:496-503`). A late outcome therefore no-ops in both directions. Pinned by `providerStore.runOutcome.test.ts:73` and `:96`. The in-flight-probe guard (`health === "probing"`) and the unknown-id guard are equally sound.
- **Is there a second door past the budget check?** Not today. Both spend endpoints gate (`routers/execution.py:252-256`, `:387-391`). `/providers/{id}/probe` is contractually no-spend (`routers/providers.py:173-179` — vendor `GET /models` or a CLI auth-status command). Automations reach no adapter at all (`automations/scheduler.py:63`, `:133`) — but see **P3-4** for why that is a "for now". The doors that *are* open are the two above the check, not around it: **P2-4** (unpriced model) and **P3-1** (concurrency).
- **Input hygiene on the budget endpoint:** negative → 400 with a clear message; `0` → accepted and correctly means "block everything" (`state: "exceeded"`); `null` → clears; `"abc"` → 422 from Pydantic; `"7"` → coerced to 7.0 (Pydantic default, benign); unknown extra fields ignored. The failures are the non-finite values — **P2-2** and **P2-3**.

## Independent verification

All three suites confirmed by SEC, not taken on report:

```text
backend/  .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
          321 passed, 5 warnings in 17.76s — exit 0, 20s wall (no hang; under the 30s stop-bar)

frontend/ npm test        57 files / 254 tests passed, Vitest, 11.22s — exit 0
frontend/ npm run typecheck   tsc --noEmit clean — exit 0, 5s
```

The four P2 findings were each reproduced directly rather than inferred: the intrinsic-node `node_start` shape
by driving `engine.execute_harness` in-process in mock mode; the NaN/Infinity budget behaviour by HTTP round trip
through `TestClient(main.app)`; the unpriced-model and concurrency behaviour by calling `usage_tracking` against
an isolated temp DB. Every run used a fresh `tempfile.mkdtemp()` `DATABASE_URL`, `OH_SECRETS=memory` and a
throwaway `OH_SIDECAR_TOKEN`, mirroring `backend/tests/conftest.py`'s isolation — `backend/data/harness.db` was
never opened, the live sidecar on :8000 was never called, and :3000/:8000 were not restarted or stopped.
Verification scripts live only in the session scratchpad; nothing was written into the checkout except this file.

**Not covered:** no browser/E2E run, no mutation testing (deliberately — a mutation-related hang corrupted a live
source file earlier this week), no dependency CVE audit, no review of the five test files' own assertions beyond
reading their names for coverage gaps, and no reading of `qa.md` (independence).

## Secrets scan

- Pattern scan over the 24 scoped source/test/config files (both stories' backend and frontend surfaces plus
  `frontend/next.config.ts`) for vendor key formats (`sk-`, `sk-or-`, `AKIA…`, `gh[pousr]_`, `AIza…`, `xox[baprs]-`),
  PEM private-key headers and JWT shapes: **zero matches**. A broader assignment-style scan
  (`api_key|apiKey|password|secret|token` assigned a quoted 8+ char literal) returned exactly one candidate,
  manually inspected and cleared: `backend/triage.py:78` `_ENGAGE_HARNESS_TOKEN = "<<ENGAGE_HARNESS>>"`, a routing
  sentinel, not a credential.
- `git log --all -p` over the scoped paths (2 ancestor commits — the new files are uncommitted) returned zero
  pattern candidates. Note this is local reachable history for those paths only, not an audit of unrelated
  historical blobs, remotes, reflogs or ignored files.
- Tracked-filename inventory (`git ls-files '*env*' '*secret*' '*credential*' '*token*' '*.key' '*.pem'`) shows
  only source modules, tests and docs — no tracked `.env` or credential file. `.gitignore` covers
  `frontend/.env.local:8`, `backend/data/:16`, `backend/.env:17`, `frontend/.next/:7`, so neither the SQLite
  ledger (which now holds usage rows) nor the baked dev token can be committed. The sidecar token itself lives
  outside the checkout at `%LOCALAPPDATA%/OHarness/sidecar.token` (`security/sidecar_token.py:52`).
- Gitleaks/trufflehog are not installed on this machine. This was a bounded pattern scan plus manual review, not
  a claim of exhaustive secret detection.

## Disposition

Per the severity protocol: no P0, so the sprint is not halted; no P1, so other stories are not blocked. The four
P2s must be fixed within this sprint before HITL merge, and the four P3s go to the Product Backlog with the fixes
above recorded.

Routing: **P2-1** and the `useRunStream` half → FE; **P2-2**, **P2-3**, **P2-4**, **P3-1**, **P3-2**, **P3-3**,
**P3-4** and the `_node_view` half of P2-1 → BE. Re-review budget: 2 (SEC.md); on re-entry SEC will re-verify the
four P2 reproductions specifically, not re-read the whole slice.

SEC identified; SEC did not fix. No commit, no merge, no backend restart, no dev server touched. No merge
authorization is implied.

---

# Re-review #1 — 2026-09-15 (independent fresh-context SEC, closing gate)

Verdict: **FAIL** — 1 × P2 (SEC-P2-4 is **not** closed), 1 × P3 (disclosure accuracy). No P0, no P1.
**P2-1, P2-2 and P2-3 are genuinely closed** — each re-reproduced from scratch below, not taken on report.

Scope of this pass, per the re-review brief: re-verify the four original P2s only, plus the new surface the
two fix rounds introduced. P3-1 (concurrency) and P3-3 (rounding) were explicitly deferred by the sprint and
are **not** re-flagged here — they remain open and accepted as recorded above. `qa.md` was not read (a
parallel fresh QA pass is running the functional axis independently). No product code, test, backend state,
running server, commit or merge was changed. Every reproduction ran against a fresh `tempfile.mkdtemp()`
`DATABASE_URL` with `OH_SECRETS=memory` and a throwaway `OH_SIDECAR_TOKEN`; `backend/data/harness.db` was
never opened and the live sidecar was never called. Scripts live only in the session scratchpad.

## Re-verification of the original four P2s

### P2-1 — CLOSED ✓ (both halves, plus the consumer guard)

`backend/engine.py:119` now carries `_INTRINSIC = {"input", "output", "router", "hitl"}` and `_node_view()`
at `:139` computes `"adapter": "mock" if is_intrinsic else data.get("adapter", "mock")` — forced from the
engine's own knowledge of the node type, never from graph data.

Original repro re-run verbatim (in-process `execute_harness`, `execution_mode="mock"`, `input → router →
output`, every node carrying `data.adapter: "claude"` and `data.model: "claude-opus-5"`):

```text
run_start.order  n1  adapter='mock'  intrinsic=True
run_start.order  n2  adapter='mock'  intrinsic=True
run_start.order  n3  adapter='mock'  intrinsic=True
node_start  n1  adapter='mock'  connection_id='<ABSENT>'
node_done   n1  provider_verified='<ABSENT>'  connection_id='<ABSENT>'  keys=['latency_ms','node_id','output','tokens']
node_start  n2  adapter='mock'  connection_id='<ABSENT>'
node_done   n2  provider_verified='<ABSENT>'  connection_id='<ABSENT>'  keys=['latency_ms','node_id','output','tokens']
node_start  n3  adapter='mock'  connection_id='<ABSENT>'
node_done   n3  provider_verified='<ABSENT>'  connection_id='<ABSENT>'  keys=['latency_ms','node_id','output','tokens']

adapter-spoof leaks: 0   node_done payloads that would satisfy the FE guard: 0
```

The `hitl` variant (the reachable-via-imported-bundle case) was driven separately, consuming only as far as
its `node_start` and then closing the generator so `park()` is never awaited — no hang risk:
`run_start.order adapter='mock'`, `node_start adapter='mock'`. The `run_start.order` preview list
(`engine.py:211`), which the original finding also covered, is fixed by the same change.

**Consumer side confirmed independently.** `frontend/src/components/agent-run/useRunStream.ts:89` now credits
inside `onEvent` itself, not from a post-run walk of `run.plan`:

```ts
if (event === "node_done" && data.provider_verified === true && typeof id === "string" && id.trim()) {
  useProviderStore.getState().reportRunOutcome(id, { ok: true });
}
```

That requires `provider_verified === true` **and** a non-empty `connection_id` **on the `node_done` event
itself**. `s.adapter` is not consulted for the crediting decision at all, so the old `=== "mock"` filter gap
is gone. Both fields are set only at `backend/engine.py:570-571`, inside the branch reached after
`adapter.stream_events` actually ran, from `resolved.connection_id` — engine-resolved, never echoed from
request or graph data. `node_start` and composer metadata now credit nothing. Defence in depth holds: either
half alone closes the vector.

**One correction to the brief's premise.** The brief states the implementer's ledger claims "the whole
failure-path concept was removed, not merely gated." That is not literally true, and the ledger does not
actually claim it. `isProviderLevelFailure` is **still present** at
`frontend/src/components/providers/providerStore.ts:394`, still exported, still covered by
`providerStore.runOutcome.test.ts:38-59`, and `reportRunOutcome`'s signature at `:423` still accepts
`{ ok: false; detail: string }`. What *is* true, and is what matters for this gate: it remains **unwired** —
`useRunStream.ts` imports only `useProviderStore` and `useUsageStore`, and there is no production caller of
the `ok: false` branch anywhere. It is now also guarded by an explicit doc comment (`:376-393`) forbidding
wiring it without a structured `error_kind` field on the wire. Unreachable dead code with a warning sign on
it is not a vulnerability, so **no finding** — but the record should say "documented and unwired", not
"removed", so nobody later reports a regression that was never a fix.

### P2-2 / P2-3 — CLOSED ✓

`backend/usage_tracking.py:157` guards `set_budget_limit` with `not math.isfinite(limit_usd) or limit_usd < 0`,
and `_status_from` at `:178` independently refuses a non-finite value already in the row (returning
`state: "invalid"`), so a legacy `inf` persisted by the old code can still be read and corrected rather than
500ing the read surface. `enforce_budget_or_raise:256` treats `"invalid"` as a refusal.

Original repro re-run verbatim, over HTTP through `TestClient(main.app)`, authenticated, baseline reset to
`limitUsd=5` before each attempt:

```text
baseline PUT limitUsd=5  -> 200 {'limitUsd': 5.0, 'spentUsd': 0.0, 'remainingUsd': 5.0, 'pct': 0.0, 'state': 'ok'}
PUT NaN        -> 400   then GET /usage/budget -> 200 (limitUsd 5.0)   GET /usage/summary -> 200
PUT Infinity   -> 400   then GET /usage/budget -> 200 (limitUsd 5.0)   GET /usage/summary -> 200
PUT -Infinity  -> 400   then GET /usage/budget -> 200 (limitUsd 5.0)   GET /usage/summary -> 200
PUT 1e400      -> 400   then GET /usage/budget -> 200 (limitUsd 5.0)   GET /usage/summary -> 200
```

All four rejected honestly. The prior ceiling survives intact in every case — no silent clear, no committed
`inf`, no 500 on `/usage/budget` or `/usage/summary` afterward. Both findings are fully closed.

### P2-4 — **NOT CLOSED.** Still P2.

The fix is real but samples the wrong thing. `backend/routers/execution.py:112-132`
(`_first_provider_model_and_residence`) returns on the **first** node that has any `providerIds`:

```python
for node in graph.get("nodes", []):
    data = node.get("data") or {}
    ids = data.get("providerIds")
    if ids and ids[0]:
        connection = connections.get(str(ids[0])) or {}
        model = data.get("model") or connection.get("defaultModel", "")
        return (model or None), connection.get("residence")
return None, None
```

Both of its inputs — `data.providerIds` and `data.model` — are **graph-author-supplied**, and the node it
samples is not required to be one that will ever spend. That is precisely the P2-1 defect class (graph `data`
treated as engine-attested fact) reappearing on the new gate. The single-node shape from the original
finding is now correctly refused; the multi-node shape is not.

**Reproduced, ledger fully wiped between every case, $5.00 ceiling set in each** (`claude-opus-5` = priced,
$45/Mtok blended; `z-ai/glm-4.6` = absent from `MODEL_PRICES`, so it costs $0.00):

```text
[unpriced] alone          gate -> REFUSED 402    (fix works)
[priced] alone            gate -> ALLOWED 200    ledger $4.50, unpriced 0        (correct)
[unpriced] -> [priced]    gate -> REFUSED 402    (fix works)
[priced] -> [unpriced]    gate -> ALLOWED 200    ledger $4.50, unpriced 100,000  <-- BYPASS
[priced] -> [unpriced]x3  gate -> ALLOWED 200    ledger $4.50, unpriced 300,000  <-- BYPASS

1 priced + 8 unpriced nodes, $5.00 ceiling -> gate ALLOWED 200
  900,000 real tokens spent; ledger says $4.50 (800,000 tokens unpriced)
  budget state: 'warning'  spent=$4.50
```

**Worse: a decoy node that never spends sets the gate's entire view.** An `input` node carries no adapter and
makes no vendor call, but it satisfies the `providerIds` test:

```text
graph: input{providerIds:["anthropic"], model:"claude-opus-5"} -> llm{model:"z-ai/glm-4.6"} -> llm{same}
  gate previews: model='claude-opus-5' residence='cloud'   <- taken from the INPUT node
  POST /execute/ -> 200 (ALLOWED)
  real tokens spent: 200,000   ledger cost: $0.00   unpriced: 200,000
  budget: spent=$0.00 / $5.00  state='ok'
```

And the `residence` exemption is spoofable the same way — pointing the decoy at a local connection exempts
the whole run, including its real cloud nodes:

```text
graph: input{providerIds:["ollama-local"], model:"qwen3.5:9b"} -> llm{providerIds:["anthropic"], model:"z-ai/glm-4.6"}
  gate previews: model='qwen3.5:9b' residence='local'   <- 'local' exempts the entire run
  POST /execute/ -> 200 (ALLOWED)
  real CLOUD tokens spent: 100,000   ledger cost: $0.00   unpriced: 100,000
```

- **Risk:** unchanged from the original P2-4 — the documented hard-stop is defeated by a model-name choice,
  and the budget reads `"ok"` while real tokens burn. The decoy variants restore the *full* original bug: a
  $5.00 ceiling at `state: 'ok'`, `spent: $0.00`, after 200,000 real tokens.
- **Reachability, precisely:** the positional variant needs **no adversary and no imported bundle** — the
  per-node Model field is a free-text input in the ordinary Studio inspector
  (`frontend/src/components/sidebar/PropertiesPanel.tsx:329-336`, placeholder `"e.g. gpt-4o,
  claude-sonnet-4, llama3.2"`, none of which are in the 12-entry catalog). Any multi-node harness — the
  product's own 9-role graph being the headline case — where the first provider-pinned node happens to use a
  priced model and a later one does not, silently runs un-enforced. The decoy variants need an imported
  `.oharness` bundle or a hand-built `POST /execute/`, the same reachability the original P2-1 established
  (`frontend/src/lib/bundleGraph.ts:113` preserves node `data` with no type filter).
- **Severity: P2**, unchanged. Local-auth-bounded, no credential exposure, no remote attacker — but it is
  the exact "unattended harness → unbounded API spend" case the feature exists to prevent, and the partial
  fix now makes the ceiling *look* enforced when it is not.
- **Fix:** stop asking the graph. The honest values already exist at `backend/engine.py:438-447`, where
  `node_view["model"] = config.model` and `node_view["connection_id"] = resolved.connection_id` are set from
  the resolver — which is why the **ledger** correctly reported `unpricedTokens: 200,000` for the very runs
  the gate waved through. Two workable shapes, either alone sufficient: (a) keep the pre-run gate but walk
  **every** spending-capable node, resolve each through `providers.resolution.resolve_node_provider`, and
  refuse if *any* resolves to an unpriced non-local model — and derive `residence` from each resolved
  connection, never from a node's claim; or (b) better, move the check into `execute_harness`'s node loop at
  `:438-447`, where model and connection are already resolved, so an unpriced non-local node is refused at
  the moment it would spend. (b) also narrows the start-only window noted in P3-1 without building the
  reservation system that finding correctly declined.

## The SEC-P2-4 tradeoff: the disclosed premise is factually wrong — P3

The re-review brief asks whether the disclosed residual gap is acceptable because it fails closed. **The
direction is right and I do not raise it as a security finding.** But the premise it was accepted on does not
survive checking, so the decision should be re-made with the real numbers.

The BE ledger discloses: *"the built-in catalog models for all three (`claude-opus-5`, `-sonnet-5`,
`-fable-5-1`, `-haiku-4-5`) are already priced, so this only bites a hand-typed exotic model string on one of
those connections, not normal use."* That holds for Anthropic only. Verified directly against
`backend/adapters/catalog.py`'s `MODEL_PRICES` (12 entries) and the frontend seed catalog:

```text
anthropic seed defaults   claude-opus-5     price=(15, 75)   blended=45.0
                          claude-sonnet-5   price=(3, 15)    blended=9.0
                          claude-fable-5-1  price=(1, 5)     blended=3.0
                          claude-haiku-4-5  price=(0.8, 4)   blended=2.4     <- all four present, claim holds

cursor seed models        cursor-composer-2-5   price=None   <- UNPRICED
                          claude-opus-5         price=(15,75)
                          gpt-5-6-sol           price=None   <- UNPRICED (only "openai/gpt-5-6-sol" is priced)
openai seed models        providerStore.ts:160 -> models: []  <- NO models seeded at all
ollama-cloud seed models  providerStore.ts:208 -> models: []  residence: "cloud"  <- not local-exempt
```

`catalog.py:219-223` says so itself: *"Deliberately not populated for OpenAI or Ollama Cloud."* Confirmed
end to end over HTTP with a $5.00 budget configured:

```text
anthropic     claude-opus-5                ALLOWED 200   cloud + priced (control)
anthropic     anthropic/claude-opus-4.1    REFUSED 402   original repro shape - correctly refused
ollama-local  qwen3.5:9b                   ALLOWED 200   local + unpriced - correctly allowed
ollama-cloud  qwen3.5:480b-cloud           REFUSED 402   <- seed default, normal use
openai        gpt-5-6-sol                  REFUSED 402   <- seed default, normal use
(same two with the budget cleared -> 200, 200 — so the budget is the cause)
```

So the residual is not "a hand-typed exotic model string." **Setting any budget at all disables the OpenAI,
Ollama Cloud and Cursor connections entirely** (Cursor on 2 of its 3 seeded models; its delegate path runs
through the same `run_harness` gate). Three of five shipped providers.

- **Security axis: no finding.** It refuses rather than under-counts — the opposite direction from the
  original bug, exactly as the brief frames it. I agree it is not a hole.
- **Severity P3 from this axis**, for the accuracy gap rather than the behaviour: the tradeoff was accepted
  on a false premise, and the premise is in the ledger where the next implementer will read it. The
  functional/product call on "is bricking three providers under a budget acceptable" is QA's and PO's, not
  mine — flagging it so it reaches them with correct facts rather than being nodded through here.
- **Fix:** correct the ledger's disclosure to name the real blast radius. Then pick one: make the exemption
  billing-aware as well as residence-aware (`catalog.py`'s `billing: "subscription"` covers anthropic,
  cursor, openai and Ollama Cloud, all genuinely $0 against a seat), or populate real prices, or surface the
  refusal as a targeted, actionable message naming the connection. Note that a billing-aware exemption also
  makes the honest fix for P2-4 above cheaper, since both then key off the resolved connection.

## New surface from these rounds — scrutinised, no findings

| Surface | Conclusion |
| --- | --- |
| `enforce_budget_or_raise(db, *, model=None, residence=None)` (`usage_tracking.py:205-278`) | **PASS as a signature.** Purely additive; both default `None`, so all six pre-existing call sites are unchanged in behaviour — confirmed by the whole suite staying green. The unpriced check is correctly independent of `state` (fires at `"ok"`). Its *inputs* are the problem, not the function — see P2-4. |
| `_first_provider_model_and_residence` (`routers/execution.py:112-132`) | **FAIL — the P2-4 finding above.** Reads untrusted graph `data` and samples one node. |
| `RouteResult.connection_id` / `.model` → `source="triage"` ledger row (`triage.py:100-122`, `routers/execution.py:391-405`) | **PASS.** No double-count: the triage row is written only under `routed.engage_harness`, and the reply-only path is the mutually exclusive `not routed.engage_harness` branch at `:331`. Verified live — a harness-engaging run produced `bySource` `[{harness, 400000}, {triage, 42}]`, the triage turn appearing exactly once and correctly priced ($0.00189 = 42 × $45/Mtok). All four fields come from `resolve_node_provider`/`AdapterResult`, never from request data. `record_usage`'s existing zero-token / `_NO_SPEND_ADAPTERS` guard is reused rather than duplicated. |
| Spoofable ledger inputs | **PASS.** `engine.py:440-441` overwrites `node_view["model"]` with `config.model` and `:447`/`:570-571` set `connection_id` from `resolved` — so a graph claiming a cheap model while running an expensive one cannot under-bill the ledger. The ledger records the truth; the gate is what ignores it. |
| TOCTOU on the new params | **Noted, not a finding.** `residence` is client-settable (`routers/providers.py:138-139`), so a token-holder can flip a connection to `"local"` and bypass the unpriced check between gate and run. But the same token can call `PUT /usage/budget {"limitUsd": null}` and remove the ceiling outright — equivalent authority, not an escalation. Same reasoning as the original review's sidecar-boundary framing. |
| Auth coverage on anything new | **PASS.** No new HTTP endpoint was added by either round. Re-verified unauthenticated: `GET /usage/summary` 401, `GET /usage/budget` 401, `PUT /usage/budget` 401, `POST /execute/direct` 401. |
| A08 data integrity (re-check) | **Now PASS** for the wire vocabulary — the `data.adapter` echo that failed A08 in the original review is fixed. A04 insecure design still **FAILS** on P2-4. |

Minor observation, not a finding: `_reply_only_events` (`routers/execution.py:142-167`) emits a `node_done`
carrying neither `provider_verified` nor `connection_id`, so a triage reply-only turn — a genuine vendor
call — never credits its connection as "Verified". That under-credits, which is the safe direction; noting it
only so it is not mistaken later for a regression of P2-1's fix.

## Independent verification — suites re-run cold

```text
backend/   .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
           354 passed, 5 warnings in 20.86s — exit 0

frontend/  npm test            58 files / 262 tests passed, Vitest, 8.04s — exit 0
frontend/  npm run typecheck   tsc --noEmit clean — exit 0
```

Matches the reported 354 / 262 / 58 exactly. No suite or individual test approached the ~30s stop-bar
(longest: backend at 20.86s). The five warnings are pre-existing `datetime.utcnow()` deprecations in
`routers/automations.py:132` and `routers/cowork.py:107`, unrelated to this story.

Note for the record: the suite is green **and** P2-4 is bypassable. The new tests pin the single-node and
unpriced-first shapes, which genuinely pass; no test exercises a multi-node graph with differing per-node
models, which is where the gate fails. A green suite is not evidence the finding is closed.

## Secrets scan

- Vendor key formats (`sk-…`, `sk-or-…`, `AKIA…`, `gh[pousr]_…`, `AIza…`, `xox[baprs]-…`), PEM private-key
  headers and JWT shapes across every file the two rounds touched — `backend/engine.py`,
  `backend/usage_tracking.py`, `backend/routers/execution.py`, `backend/triage.py`, `backend/models.py`,
  `backend/adapters/catalog.py`, `frontend/src/components/agent-run/useRunStream.ts`,
  `frontend/src/components/providers/Dossier.tsx`, `frontend/src/components/providers/providerStore.ts`:
  **zero matches**. Assignment-style scan (`api_key|apiKey|password|secret|token` assigned a quoted 8+ char
  literal) over the same backend files: **zero matches**. The new/extended test files
  (`test_engine_intrinsic_adapter_spoofing.py`, `test_budget_fixes.py`,
  `test_execution_budget_enforcement.py`, `test_usage_tracking.py`): **zero matches** — fixtures use obvious
  throwaways (`sk-ant-REAL`, `test-secret`), no real credential shape.
- Tracked-filename inventory (`git ls-files '*env*' '*secret*' '*credential*' '*token*' '*.key' '*.pem'`):
  only source modules, tests and docs — no tracked `.env` or credential file. `.gitignore` coverage intact
  (`frontend/.env.local:8`, `backend/data/:16`, `backend/.env:17`).
- Same bounded-scan caveat as the original review: gitleaks/trufflehog are not installed here, so this is
  pattern matching plus manual review, not a claim of exhaustive secret detection.

## Disposition

No P0 — the sprint is not halted. No P1 — other stories are not blocked.

**This gate does not pass.** One P2 remains open (**P2-4**, unclosed), and per the severity protocol a P2 is
fixed within the sprint and documented before merge. Because the budget ceiling *is* the security-relevant
purpose of Story 2, shipping it with a model-choice bypass that leaves the ceiling reading `"ok"` at `$0.00`
after 200,000 real tokens would ship the exact defect the story exists to fix. **P2-4 blocks HITL merge for
this story; it is not a follow-up ticket.** The P3 disclosure correction can ship as a follow-up *provided*
the ledger's false claim is corrected now, since that claim is what a reader would otherwise rely on.

Re-review budget: this was re-review **1 of 2** (SEC.md). One re-review remains before the residual-risk
decision escalates to HITL. On re-entry SEC will re-verify P2-4 specifically — the multi-node, decoy-node and
spoofed-residence reproductions above — and will not re-read the rest of the slice.

Routing: **P2-4** → BE (`routers/execution.py:112-132` and/or `engine.py:438-447`). **P3 disclosure** → BE
for the ledger correction; the product call on budget-vs-provider-availability → PO, with QA's functional
axis. **P3-1** and **P3-3** remain deferred and accepted, unchanged.

Credit where due: P2-1 was fixed at both the source and the consumer rather than only at the seam that was
reported, P2-2/P2-3 gained an independent read-path guard for already-persisted bad values, and the P2-4
tradeoff was disclosed rather than hidden — which is the only reason the disclosure could be checked at all.

SEC identified; SEC did not fix. No commit, no merge, no backend restart, no dev server touched, no test or
product file modified. No merge authorization is implied.


# Re-review #2 — 2026-09-15 (independent fresh-context SEC, closing gate)

Verdict: **FAIL** — 1 × P2 open (**SEC-P2-5**, new). No P0, no P1.

**SEC-P2-4 as I reported it last round is genuinely CLOSED.** All four positional-bypass scenarios, plus
every harder variant I could build, are now refused — re-reproduced from scratch below, not taken on the
ledger's word. The architecture of the fix is right: enforcement moved to the one chokepoint where the
engine's own resolved truth is available.

What remains is a *different instance of the same defect family*, not a failure of that fix: **two real
spend paths never enter `execute_harness`'s node loop at all**, so per-node enforcement cannot reach them,
and the pre-run gate that used to cover one of them was stripped of its model argument without a
replacement. In the shipped configuration, a configured budget reads `state: "ok"`, `spent: $0.00` after
300,000 real cloud tokens on the ordinary chat turn. That is the same "the ceiling looks enforced when it
isn't" outcome the original P2-4 described, reached by a different route.

Scope per the brief: the four original scenarios, the `model_expected` follow-up, the new
`_enforce_node_budget` surface, and the sum-of-per-node-checks question. P3-1 (within-run overshoot) and
P3-3 (rounding) remain deferred and accepted — not re-flagged. `qa.md` was not read (QA's closing pass runs
the functional axis independently). No product code, test, backend state, running server, commit or merge
was changed. Every reproduction ran in-process against a fresh `tempfile.mkdtemp()` `DATABASE_URL` with
`OH_SECRETS=memory` and a throwaway `OH_SIDECAR_TOKEN`; `backend/data/harness.db` was never opened and no
vendor was ever called (a counting stub adapter replaced `get_adapter` at both call sites). Scripts live
only in the session scratchpad.

## SEC-P2-4 positional bypass — CLOSED ✓

`backend/engine.py:480-490` now fires the gate once per real node, inside the node loop, from that node's
own resolution:

```python
if execution_mode != "mock" and enforce_budget is not None:
    residence = (connections or {}).get(resolved.connection_id, {}).get("residence")
    try:
        await enforce_budget(config.model, residence)
    except BudgetExceededError as exc:
        yield _sse("node_start", node_view)
        ...
        stopped_at = node_id
        break
```

Both inputs are engine-resolved: `config.model` comes from `resolved.config` (`:450`), `residence` is looked
up by `resolved.connection_id` — never `data["providerIds"]`, never `data["model"]`, never a first-node
sample. `_first_provider_model_and_residence` is gone from the file entirely (only referenced in the
comment at `:279-289` explaining why).

**Structurally the unique chokepoint.** `engine.py` contains exactly one `adapter.stream_events` call
(`:498`) and one `get_adapter` (`:418`, mock-only). There is no second adapter entry point in the graph
walk for a node to reach around the gate.

All re-reproduced over HTTP through `TestClient(main.app)`, authenticated, ledger wiped between every case,
$5.00 ceiling set each time (`claude-opus-5` = priced, $45/Mtok blended; `z-ai/glm-4.6` = absent from
`MODEL_PRICES`). "real llm turns" counts actual adapter invocations, excluding the triage intake call:

```text
                                                      real llm   ledger    budget
CONTROL  [priced] alone                        200          1    $4.50     warning   correct
S1  [priced] -> [unpriced]                     200          1    $4.50     warning   node 2 REFUSED  (was: BYPASS)
S2  1 priced + 8 unpriced                      200          1    $4.50     warning   node 2 REFUSED  (was: 900k tok, $4.50)
S3  intrinsic input decoy (priced) -> 2 unpriced llm
                                               200          0    $0.00     ok        REFUSED  (was: 200k tok, $0.00, "ok")
S4  local-residence decoy -> real CLOUD unpriced
                                               200          0    $0.00     ok        REFUSED  (was: 100k cloud tok, $0.00)
```

Harder variants, all likewise refused at the offending node:

```text
S5  unpriced 3rd of 5    nodes 1-2 ran, $9.00189 / 200,042 tok recorded, node 3 REFUSED, 4-5 never ran
S6  unpriced 5th of 5    nodes 1-4 ran, $18.00189 / 400,042 tok recorded, node 5 REFUSED
S7  REAL local llm node first -> real cloud unpriced llm            REFUSED (decoy is a genuine spender)
S8  agent-type nodes (not intrinsic), priced then unpriced          REFUSED
S9  openai CLI conn, no defaultModel, no node model                 REFUSED — "no default model set"
S10 [priced] -> [openai empty-model]                                node 2 REFUSED — same message
```

The four new tests at `backend/tests/test_engine_budget_enforcement.py:155/189/225/260` pin exactly these
four original shapes, and `:288` pins the `enforce_budget=None` no-op default. They are honest tests of a
real fix — unlike the previous round, where a green suite coexisted with a live bypass.

## `model_expected` — verified, with one accuracy correction

**Cannot be tricked into staying `False` on a real per-node call.** `routers/execution.py:132-134` passes
it as a literal keyword with no branch:

```python
await usage_tracking.enforce_budget_or_raise(
    session, model=model, residence=residence, model_expected=True
)
```

`_enforce_node_budget` is the only caller that passes the parameter at all, and the engine invokes the
callback through a two-positional-argument signature
(`Callable[[str | None, str | None], Awaitable[None]]`, `engine.py:155`). A graph can therefore influence
the two *values* being checked but has no reachable path to influence *whether* the check happens.

**The pre-run/preview call sites genuinely did not change behaviour.** Verified empirically rather than by
inspection — with no budget configured, both a harness run and `/execute/direct` still run freely on a
connection with no model known (`N1`/`N2`: HTTP 200, 600,000 and 300,000 tokens, `state: "unset"`), which
is the "nothing resolved yet" legitimate skip the brief asked me to confirm was not quietly tightened. The
already-exceeded refusal still fires on every path including reply-only (`E1`: 402). A known unpriced model
on `/execute/direct` still refuses (`D1`, `D4`: 402).

**Correction to the ledger's count.** The ledger says "every pre-run/preview call site — 7 of them, all
unmodified." There are **three** production call sites of `enforce_budget_or_raise` in the whole backend —
`routers/execution.py:132` (the per-node callback), `:293` (harness pre-run), `:461` (direct preview) — of
which two are pre-run/preview. The other four appear to be test call sites. Not a finding; correcting it
because "7 untouched call sites" reads as much broader coverage than actually exists, and the next reader
would over-trust it.

## New surface — `_enforce_node_budget` (`routers/execution.py:112-134`) — no findings

| Question from the brief | Finding |
| --- | --- |
| Runs before the adapter, for every real node? | **Yes.** `engine.py:480` sits after `resolve_node_provider` (`:431`) and before `adapter.stream_events` (`:498`), with nothing between the refusal branch and the call but the `node_start` emission. Confirmed empirically: in every refused scenario the counting stub recorded **zero** turns for the refused node and every node after it. |
| Skippable? | **No.** Only `execution_mode == "mock"` (which forces `MockAdapter` and reaches no vendor) or `enforce_budget is None` (the engine's own default; `routers/execution.py:357` passes the callback unconditionally). Neither is graph-controlled. |
| DB session safety concurrent with the request-scoped session | **PASS.** Opens its own `SessionLocal()` per node and does two read-only SELECTs via `get_budget_status`. It never shares the request-scoped `db`, which is the correct call — the same reason `event_stream`'s finally-block opens its own. No write, so no SQLite write-lock contention introduced. |
| Deadlock via the new lock usage | **PASS.** `_budget_lock` (`usage_tracking.py:58`) is acquired in exactly one place (`:269`) with no nested acquisition anywhere in the module; `record_usage` does not take it. Moving the call into a per-node loop multiplies acquisitions but cannot self-deadlock, and the lock is never held across an adapter call. |
| Fail-open on error? | **No — fails closed.** `engine.py:484` catches only `BudgetExceededError`; anything else (DB error, session failure) propagates out of the generator to `event_stream`'s handler and ends the run. |
| TOCTOU checking-then-running *within* one node | **Not a finding.** The window between the check and `stream_events` contains no await that anything external can influence. The pre-existing `residence`-flip TOCTOU (a token-holder can `PUT /providers/connections/...` to `"local"` mid-run) is unchanged and still not an escalation — the same token can `PUT /usage/budget {"limitUsd": null}`. |

## Sum of per-node checks vs one pre-run gate — answered

- **Refusing node 3 of 5 does not lose nodes 1-2's spend.** `S5` recorded $9.00189 / 200,042 tokens and
  `S6` recorded $18.00189 / 400,042 — matching the stub's counted burn exactly. The `finally`-block pairs
  every `node_start` collected before the `break`, so a mid-run refusal still commits everything already
  spent. No leakage, no double-count, no double-refusal.
- **Not silently worse than before in any edge case I could construct** — except the one below, which is
  not an edge case.
- Worth recording plainly: `S5`/`S6` show a run spending $9.00 and $18.00 against a $5.00 ceiling, because
  usage is written only at run end, so all N per-node checks read the same pre-run total. That is P3-1's
  already-deferred within-run overshoot, identical in kind to what a single pre-run gate did. Unchanged,
  not re-flagged.

## SEC-P2-5 — the budget is unenforced on the two spend paths that skip the node loop. **P2.**

Every real adapter call in this app happens in one of three places. The fix covers one of them.

| Path | Gated on unpriced/unknown model? |
| --- | --- |
| `execute_harness` node loop (`engine.py:480`) | **Yes** — this round's fix, verified above |
| `triage.route_message` (`routers/execution.py:305-311`) | **No** — runs *before* the node loop, on every live/local `POST /execute/` with an instruction. When it returns `engage_harness=False`, `routed.reply` **is** the whole answer and the run never enters the engine at all (`:342-347`). |
| `POST /execute/direct` (`routers/execution.py:456-465`) | **Only when a model is already known** — `model_expected` deliberately left at the `False` default |

The pre-run gate at `:290-295` now passes no model at all, by design ("This call now only refuses a run
outright when the budget is already exhausted/invalid"). Nothing was added ahead of `route_message` to
replace what the removed preview incidentally covered.

**Why this bites in the shipped configuration, with no adversary.** `defaultModel` has **no writer in the
shipped UI** — `grep defaultModel frontend/src` returns zero matches; it exists only as a backend field
(`routers/providers.py:39/47/108/144`, `providers/store.py:28/54`) reachable by hand-crafted HTTP.
`frontend/src/components/agent-run/useRunStream.ts:106-110` sends the direct-run payload as
`{ instruction, mode, step, cwd, connection_id }` — **no `model` field ever**. So
`providers/resolution.py:149`'s `data.get("model") or connection.get("defaultModel", "")` resolves to `""`
for every real connection unless a node's Inspector Model field is hand-typed, and
`routers/execution.py:459`'s `pre_model` is `""` on every shipped direct call. An empty model has no
catalog price, so `record_usage` writes `$0.00`.

Reproduced end to end against exactly that shape — connections carrying **no** `defaultModel` key at all,
nodes with **no** model pinned (which `providers/resolution.py:141-148` itself calls the normal authoring
shape: *"A graph node rarely pins a model — model choice is meant to live on the connection"*), $5.00
ceiling set:

```text
B1  harness run, anthropic (cloud), no model     200   triage burned 300,000 real tokens, NOT refused
                                                       then the node was refused ("no default model set")
                                                       ledger $0.00  unpriced 300,000  budget spent $0.00 state 'ok'
B1  harness run, openai (cloud), no model        200   identical
B2  POST /execute/direct, anthropic, no model    200   300,000 real tokens, NO refusal at all
                                                       ledger $0.00  unpriced 300,000  budget spent $0.00 state 'ok'
B3  reply-only chat, anthropic, no model         200   300,000 real tokens, NO refusal at all
                                                       ledger $0.00  unpriced 300,000  budget spent $0.00 state 'ok'
```

And with a `defaultModel` present but unpriced — the Ollama Cloud / ChatGPT seed shape from my last pass:

```text
T1  reply-only chat, ollama-cloud (cloud, qwen3.5:480b-cloud)   200   400,000 tok, $0.00, state 'ok'
T2  reply-only chat, openai conn, no defaultModel               200   400,000 tok, $0.00, state 'ok'
T3  intake -> harness engages, ollama-cloud                     200   triage burned 400,000 tok at $0.00;
                                                                      the harness node was correctly refused
T4  CONTROL same path, anthropic priced default                 200   400,000 tok, $18.00, state 'exceeded'  correct
D2/D3  /execute/direct, openai conn, no model                   200   400,000 tok, $0.00, state 'ok'
D4  CONTROL /execute/direct, ollama-cloud known unpriced model  402   correctly refused
```

`T4` and `D4` are the controls that prove the ledger and the refusal machinery both work — it is
specifically the *gate on these two paths* that is absent.

- **Risk:** identical to the original P2-4 — the documented hard stop is defeated and the budget reads
  `"ok"` at `$0.00` while real vendor tokens burn. `B3`/`T1` are the ordinary chat turn, the single most
  frequent operation in the product. `B2` is Agent mode with the harness toggle off. Neither needs an
  imported `.oharness` bundle, a hand-built request, or an unusual setting: they need a budget to be set,
  which is the entire feature.
- **Relationship to the last round:** for the triage path this is a **coverage loss against the version I
  reviewed last round**, not against shipped code. `_first_provider_model_and_residence` sampled the first
  node with `providerIds`, and `_first_provider_ids` (`routers/execution.py:100-109`) — still present,
  still what feeds `route_message` at `:307` — uses the identical rule, so the removed preview happened to
  check the very connection triage was about to use. My prior section recorded that gate returning
  `ollama-cloud … REFUSED 402` and `openai gpt-5-6-sol … REFUSED 402`; `T1`/`T2` are now 200 and spend.
  Nothing is regressed relative to `HEAD` (3689da0) — confirmed: `git show HEAD:backend/routers/execution.py`
  contains no `enforce_budget`, `usage_tracking` or `route_message` reference at all, so the whole budget
  feature is this story's uncommitted work. This is an open gap in the story, not a regression ticket.
- **Severity: P2.** Local-auth-bounded, no credential exposure, no remote attacker, fails toward
  over-spending rather than data loss — the same envelope as P2-4. It stays P2 rather than dropping to P3
  because it is the precise failure the feature exists to prevent, and it is now the *default* behaviour
  rather than a corner.
- **Fix — two halves, both small:**
  (a) **Triage.** Resolve the triage connection before the call (the code already computes
  `_first_provider_ids(graph)`; `resolve_node_provider` with that id yields the same `model`/`connection_id`
  `RouteResult` already carries) and call `enforce_budget_or_raise(..., model_expected=True)` on it before
  `route_message` at `:305`. Structurally the same move that fixed the node loop, applied to the one
  adapter call that sits outside it.
  (b) **Direct.** The honest values exist at `:482-484`, after `resolve_node_provider` has already run and
  before any adapter call — move the check there and pass `model_expected=True`, instead of guessing at
  `:459`. The ledger's stated reason for leaving it (*"direct mode has no multi-node positional-bypass
  surface to begin with"*) is true but answers only the positional half of P2-4; the invisible-spend half
  is the security property, and it is unaddressed. Its other reason — that tightening it *"risks false
  refusals on a guess"* — stops applying once the check moves past the real resolution, where it is no
  longer a guess.
- **Read this together with the P3 from my last pass, which is now sharper, not stale.** Once (a) and (b)
  land, a configured budget will refuse *every* cloud run in the default configuration, because the
  shipped UI provides no way to set `defaultModel` and node Model fields are normally blank. `B1` already
  shows that half arriving: the harness node is refused today with *"this node's connection has no default
  model set"* — advice the user cannot act on, since no UI surface sets it. Fixing P2-5 without also giving
  `defaultModel` a writer (or making the exemption billing-aware, per `catalog.py`'s
  `billing: "subscription"`) converts a silent hole into a hard brick. That combined product call is
  PO's + QA's, not mine; I am flagging it so the two are decided together rather than in sequence.

## Independent verification — suites re-run cold

```text
backend/   .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider --durations=5
           365 passed, 5 warnings in 22.90s — exit 0   (slowest single test 2.59s)

frontend/  npx vitest run --run    58 files / 262 tests passed, 8.61s — exit 0
frontend/  npm run typecheck       tsc --noEmit clean — exit 0
```

365 / 262 / 58 match the ledger exactly. The frontend suite was re-run rather than assumed, and is indeed
unaffected — confirming the backend-only claim. Nothing approached the ~30s stop-bar; no run was left to
hang. The five warnings are the same pre-existing `datetime.utcnow()` deprecations in
`routers/automations.py:132` and `routers/cowork.py:107`, unrelated to this story.

Re-confirmed from the prior pass: `automations/` and `routers/automations.py` contain no
`stream_events` / `.invoke(` / `execute_harness` / `get_adapter` reference at all, so there is genuinely no
fourth spend path to gate there.

Note for the record, the mirror of the one I left last round: **the suite is green and SEC-P2-5 is live.**
The five new engine tests cover the node loop correctly and completely; no test exercises the triage call
or `/execute/direct` with an unknown model, which is where the control is absent. No test asserts anything
false — the suite simply does not reach these paths.

## Secrets scan

- Vendor key formats (`sk-…`, `sk-or-…`, `AKIA…`, `gh[pousr]_…`, `AIza…`, `xox[baprs]-…`), PEM private-key
  headers and JWT shapes across every file this round touched — `backend/engine.py`,
  `backend/usage_tracking.py`, `backend/routers/execution.py`,
  `backend/tests/test_engine_budget_enforcement.py`, `backend/tests/test_usage_tracking.py`: **zero
  matches**. Assignment-style scan (`api_key|apiKey|password|secret|token` assigned a quoted 8+ char
  literal) over the same files: **zero matches**.
- No new endpoint was added this round. Auth re-confirmed incidentally and forcefully: the first run of my
  reproduction harness returned `401 {"detail":"Missing or invalid sidecar token."}` on all 17 calls until
  I added the bearer header — `/usage/budget`, `/usage/summary`, `/execute/` and `/execute/direct` all
  refuse unauthenticated. A01/A07 hold.
- Same bounded-scan caveat as both prior passes: gitleaks/trufflehog are not installed here, so this is
  pattern matching plus manual review, not a claim of exhaustive secret detection.

## Disposition

No P0 — the sprint is not halted. No P1 — other stories are not blocked.

**This gate does not pass.** SEC-P2-4 is closed and the fix for it is good work — the enforcement point is
now where it should have been from the start, and I could not bypass it with five-node graphs, mid-chain
placement, intrinsic decoys, genuine-spender decoys, or the empty-model shape QA found. But the control it
belongs to is still defeated on the ordinary chat turn, which is the same security property under a
different route. Shipping this state would mean a budget that enforces on the graph walk and silently
ignores the most common way the product spends money.

**Re-review budget is now exhausted — this was re-review 2 of 2.** Per SEC.md's protocol the residual-risk
decision escalates to **HITL**, who owns the call on whether SEC-P2-5 is fixed before merge or accepted as
a documented residual. My recommendation, offered as input to that decision and not as a verdict: fix
(a) and (b) — both are small and both reuse machinery that already exists — and decide the `defaultModel`
/ billing-aware-exemption question at the same time, because fixing P2-5 alone turns a silent hole into a
hard brick on every cloud connection. Do not let this reach merge as a silent gap: whichever way HITL
decides, the ledger must say plainly that a configured budget does not see triage or direct-mode spend in
the current build.

Routing: **SEC-P2-5** → BE (`routers/execution.py:290-311` and `:456-484`). The
budget-vs-provider-availability product call → PO with QA's functional axis, carrying my last pass's
corrected blast radius plus the `defaultModel`-has-no-UI-writer fact above. **P3-1** and **P3-3** remain
deferred and accepted, unchanged. The "7 call sites" line in the ledger → BE, one-line correction.

Credit where due: the move from a pre-run sample to a per-node, post-resolution check is the right
architecture, not a patch over the symptom I reported — it closed every variant I threw at it, including
several I did not report last round. The `model_expected` addition is correctly scoped, correctly
defaulted, and genuinely un-trickable. The gap that remains is one of *reach*, not of design.

SEC identified; SEC did not fix. No commit, no merge, no backend restart, no dev server touched, no test or
product file modified. No merge authorization is implied. I did not write the consolidated handoff.
