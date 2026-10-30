# ADR 0043 — Subagents: remembered choice, honest limits, e2e

Status: accepted (#166, follow-up to ADR 0027)

## Decision
- The "Subagents" switch is remembered (`localStorage`, `oh.subagents.v1`; only a literal `true` is trusted on read) and shown only for chats without a harness, where it applies.
- A provider that runs its own loop (a CLI adapter: no `stream_turn`) cannot be given the `run_subagent` tool. When subagents were asked for, the stream carries `subagent_unavailable` (reason `provider`) and the run shows a notice instead of ignoring the choice.
- What is specific to subagents (tree title, child states, Cancel and its refusal reasons, the switch and why it is unavailable in Plan mode or with a harness on, the notice) goes through the en / pt-BR catalogs (`subagents.*`). The parent turn's status word is the shared run status, not catalogued yet.
- The notice also covers a model that rejects function calling (the existing fallback to plain text).
- History: the journal already holds `subagent_*`; replay shows the final states, and a run that ended or was interrupted never shows a child as running.
- e2e: `e2e-subagents.mjs` runs against a small real HTTP sidecar, so the stream is open while Cancel is pressed: parent and both children running, axe with the tree live, Cancel by keyboard reaching exactly one child, the sibling finishing, both themes.

## What stays out, and why
- **Subagents on a CLI provider.** The CLI owns its tool loop; there is no function-calling surface to add `run_subagent` to. Not solvable without changing how each CLI is driven. The notice says so.
- **Subagents with tools, or nested ones.** A child with the parent's tools would need its own approval cards, hooks and permission mode; kept out on purpose, so a child can add no capability the parent lacks.
- **Subagents inside a harness run.** A harness node is one provider call with no tool conversation to hang a child on.
- **Cancelling from history.** A finished or interrupted run has nothing left to cancel.
- **Still to verify on a real machine:** behaviour with a real local model that emits several `run_subagent` calls in one turn (the tests drive scripted adapters and a real HTTP stream, not a live model).
