# ADR 0025 — Run token ceiling and compaction events

Status: accepted (#164)

## Decision

- A run may carry `max_tokens`. The range lives in one table, `backend/run_budget.py` `RUN_BUDGET_RULES`; the UI mirrors it in `runBudgetRules.ts` and a parity test pins both.
- Reaching the ceiling ends the run with the explicit status `budget_exceeded` (event `budget_exceeded`, then `harness_done` with that status; the journal and run log keep it).
- Compaction replaces older tool results replayed to the model with a stub and emits `context_compacted` with `before_tokens` / `after_tokens`. It is deterministic (no model call); the transcript the person sees is unchanged.

## Conservative choices

- The ceiling applies to harness-off (direct) runs, where the tool loop lives. Harness runs keep the per-agent token limit and the global budget; a per-run ceiling there is a follow-up.
- Tokens are the provider's report, or the length estimate the engine already uses.
- Tool loop: the ceiling is checked after each provider turn, only when the model asked for more work; the event reports `skipped_calls`. A turn that finishes the answer is never relabelled. A turn can overshoot by itself.
- Single turn (no tools): the stream stops once the length estimate crosses the ceiling.
- Compaction never touches results the model has not read yet (after the last assistant message).
