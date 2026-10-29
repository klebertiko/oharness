# ADR 0040 — Token ceiling: harness runs, persistence, what stays out

Status: accepted (#164, follow-up to ADR 0025)

## Decision
- The ceiling now also stops a **harness run**: tokens are summed from each `node_done` / `node_error`; the node that crosses the ceiling finishes, then the run is stopped (no further node starts), a `budget_exceeded` event is journaled and the final `harness_done` carries the status `budget_exceeded` (also in the run log).
- The setting is remembered (`localStorage`, key `oh.runBudget.v1`) and re-validated against the rules table on read, so a hand-edited value outside the range is dropped.
- The field is shown whether or not a harness is on.

## What stays out, and why
- **Compaction inside a harness run.** Each node is one prompt to one adapter; there is no growing message list to compact, so there is nothing to report. Compaction exists only in the tool conversation (`ToolBroker`), which is where context grows.
- **A hard stop mid-node.** A node is one provider call; its tokens are known only when it ends (or when streamed length crosses the ceiling in the harness-off path). The ceiling is therefore checked between nodes: a single node can overshoot, never a second one.
- **Interface language.** The ceiling field, its refusal reasons, the compaction line, the `budget_exceeded` line and the stage notice go through the en / pt-BR catalogs (`run.*`). The run-history status label ("Budget exceeded") sits in the history list with its sibling labels, which are not catalogued yet.
- **A reply that routing answers directly** (no harness) is one finished provider call; the ceiling is not applied to it, and the intake call's tokens count toward a harness run's total once the harness is engaged.
- **A run whose last node crosses the ceiling** is left as it ended (`complete`): there is nothing left to stop, so it is not relabelled.
- **A continued run** takes its ceiling from the start request (the composer's current value, sent by the Continue button), not from the saved run: nothing is added to the schema. Tokens spent by the nodes it restores are not known to it (`node_restored` carries no count), so the ceiling bounds the continuation's own spend.
- **Gate retries and routing.** `HarnessCeiling` counts a node a Gate sends back as work still to do, and checks right after `run_start`, so tokens already spent by routing can stop a run before its first node.
