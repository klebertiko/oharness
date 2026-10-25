# DIRECT-ADAPTER-RESOLVE ledger

AC and seams are in story.md. No production edits yet — PO intake only.

## PO intake verification (2026-09-15)

Reporter's diagnosis re-verified against current source rather than trusted as-is, since the file it cited
as background (`handoffs/2026-09-13-oharness-provider-verified-report.md`) does not exist under that exact
name — closest match is `handoffs/2026-09-13-oharness-provider-status-astra.md`, and the actual working
artifact for that sibling bug is `.harness/sprint-2026-09-15/story-PROVIDER-VERIFY-BUDGET/` (evidence/ only,
no story.md yet at intake time). Flagged to the user; not blocking, since this story's own root cause was
independently confirmed against live code, not against the cited handoff.

Confirmed unchanged: `useRunStream.ts`'s `start()` still drops `providerId` before calling `startDirectRun()`
(only `{instruction, mode, step, cwd}` reach the wire); `run_direct()` still computes
`adapter_name = "mock" if body.mode == "mock" else (body.adapter or "mock")` with `body.adapter` always
`None` from real traffic. The file has moved since whatever snapshot the reporter read (line numbers shifted,
a `providerIdRef` outcome-crediting effect was added by the concurrent PROVIDER-VERIFY-BUDGET work — see its
large comment block dated "before 2026-09-13") but the underlying defect is identical and still live.

New findings beyond the original report, both feeding the direction-1-vs-2 recommendation in story.md:
- `resolve_node_provider()`'s docstring states the house rule directly: never resolve to MockAdapter
  silently; raise `ProviderResolutionError` instead. `run_direct()` violates this rule today, not just as an
  oversight but as its literal, unconditional fallback expression.
- `run_direct()`'s `AdapterConfig` never carries `endpoint`/`api_key` — direction 1 (frontend sends a bare
  adapter name) would leave HTTP-based connections (Ollama/OpenRouter) with no credential/endpoint even if
  implemented, so it would not actually be a complete fix for those provider types.
- `tests/test_execution_cwd.py` and `tests/test_execution_budget_enforcement.py` already `POST
  /execute/direct` with an explicit `adapter` field and monkeypatch `get_adapter` directly — any resolution
  change must reconcile these deliberately, not break them as collateral damage.

Baselines captured before any implementation (2026-09-15):
- Frontend: `npm run test` (from `frontend/`) → **254 passed, 57 files**, 0 failures.
- Backend: `.venv/Scripts/python.exe -m pytest -q` (from `backend/`) → **321 passed**, 0 failures (only
  pre-existing, unrelated deprecation warnings and a harmless pytest-cache permission warning).

Story drafted, Stop-the-Line self-check passed (explicit AC/DoD/seams/points). Awaiting HITL Sprint-Goal
confirmation (Sprint Planning Step 4 — never skipped) before spawning BE/FE.

## Verified TDD progression
(none yet — pending confirmation to start implementation)

## Codex implementation — 2026-09-15

User approved the coordination handoff with “pode fazer”. Story In Progress;
AC/DoD and the proposed API/hook testing seams are accepted by that authorization.
AC1–4: POST /execute/direct via test_execution_provider_resolution.py, external
adapter replaced by an offline stub. AC5: existing harness regression. AC6 and
wire selection: useRunStream tests (parallel FE). Preserve cwd and budget tests,
migrating their legacy adapter requests to registered connection_id deliberately.
No commit/merge. Independent QA/SEC remain pending until integration.

### TDD evidence (Codex)
- RED API selected connection: expected claude, got mock (test_direct_uses_selected_connection_and_reports_backend_evidence).
- GREEN same file 5 passed after server resolver wiring; extended CLI/HTTP/error/simulation regression passed.
- Legacy cwd/budget fixtures intentionally migrated adapter=claude → connection_id=anthropic; their assertions retained.
- RED backend evidence: real harness node missing provider_verified; intrinsic forged fields cannot credit a connection.
- GREEN combined provider/cwd/budget subset 41 passed. Standalone cwd test exposed preexisting order dependence (missing table); full subset initializes it.
- RED partial HTTP transport failure: node_error missing provider_failure (direct and harness).
- GREEN provider resolution + engine token limits + engine provider resolution: 28 passed; reported partial 37 tokens retained, safe transport error and concrete connection emitted.
- Shared checkout changed externally during work: Sonnet's per-node budget callback, intake ledger and stricter direct resolution budget check preserved. Reconciled duplicate verification fields; stopped turns never verify.
- Runtime: started local backend :8000 (health ok), Next :3000 (HTTP 200), Tauri dev compiled and window OHarness observed. Packaged sidecar binary absent; dev backend is managed separately.
