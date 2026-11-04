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

## Adendo (#340): uso reportado em todo caminho
O adapter OpenAI-compatível agora implementa `stream_events` sobre `stream_turn` (com `stream_options.include_usage`), então nós de harness, subagentes e turno simples recebem o `usage` do provedor (prompt incluído; `total_tokens`, ou prompt + completion). A estimativa por tamanho só entra quando o provedor não reporta. No turno simples o texto chega antes do uso: o teto também dispara pelo valor reportado ao fim do stream, e quando a estimativa interrompe o stream o total do turno é o mesmo número do `budget_exceeded`.
