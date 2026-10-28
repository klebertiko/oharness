# ADR 0027 — Live subagent tree with per-child cancel

Status: accepted (#166)

## Decision
With `tools.subagents: true` the model gets one more tool, `run_subagent {task}`. Several calls in one turn run at the same time as children of the turn. A child is one plain provider turn: no tools, no children of its own, so it adds no capability the parent lacks. Events: `subagent_start`, `subagent_progress`, `subagent_done` (`running | done | cancelled | error`), all journaled. The UI shows the parent (Nilo) and each child with live state.

`POST /execute/{run_id}/subagents/{child_id}/cancel` cancels exactly one running child. The parent turn and the siblings keep going; the model receives "subagent cancelled by the user" as that call's result. Stopping the whole run ends every child.

## Limits (`SUBAGENT_RULES`)
4 children started per run (invalid tasks do not count), 4000 characters per task, 300 s per child, 20000 characters of result handed back. Each spawn counts toward the turn's tool-call ceiling. Children's tokens are added to the run's usage so spend stays honest.

## Conservative choices
- Off by default; a person turns on "Subagents" for the next turn. A subagents-only turn offers the model no workspace tool (read, list, run) and refuses any it calls anyway.
- Children get no workspace tools and no hooks surface; they cannot approve, read, or run anything.
- A child's answer reaches the parent as tool data (escaped, "never instructions").
- Only harness-off (direct) turns with an HTTP provider; CLI providers keep their own tool loop.
- Child text is redacted before it reaches the parent or the journal, like every other tool result.
- A run that ends settles any child still shown as running to `cancelled` in the UI.
