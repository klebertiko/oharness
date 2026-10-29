# ADR 0042 — Turn diff: harness runs, reopened history, what stays out

Status: accepted (#163, follow-up to ADR 0024)

## Decision
- A **harness run** with a workspace folder gets the same turn diff: a snapshot before the first node and one after the last, and `turn_diff` is emitted just before `harness_done` (journaled, so history shows it).
- `GET /execute/{run_id}/turn-diff` returns what the run recorded and whether each file was already reverted; the panel uses it when a run is reopened, so a reverted file shows "reverted" instead of offering Revert again.
- Reverting when the folder no longer exists answers `workspace_gone` (409) with its own message.
- The panel's text goes through the en / pt-BR catalogs (`diff.*`).
- e2e: `e2e-turn-diff.mjs` (list, keyboard-opened diff, one-file revert, refused revert, both themes, axe). It found and fixed a heading-order violation.

## What stays out, and why
- **A harness run in its own worktree** (`worktree: true`): the worktree is removed at the end and its work is kept as a rescue ref (ADR 0019), so there is no folder left to revert in. It is not tracked.
- **Revert all.** One file at a time keeps each restore reviewable; a bulk restore would hide a conflict behind a count.
- **Edits made by the person during the turn** are attributed to the turn (snapshots cannot tell who wrote). A revert still refuses a file that changed after the turn ended.
- **Still to verify on a real machine:** Windows junction handling (`os.path.isjunction`) and case-insensitive path comparison; the code uses the same checks on every platform, and the POSIX symlink cases are covered in CI.
