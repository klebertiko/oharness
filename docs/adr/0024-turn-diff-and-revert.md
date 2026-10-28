# ADR 0024 — Turn diff and per-file revert

Status: accepted (#163)

## Decision
A direct run with a workspace takes a bounded snapshot before the turn and another after it. Differences become the `turn_diff` event (journaled, redacted like any event) and rows in `turn_changes` that keep each text file's earlier bytes. `POST /execute/{run_id}/turn-diff/revert {path}` restores exactly one file, once.

Snapshots, not tool hooks, because edits come from commands (`exec`) and from a provider's own CLI alike.

## Safety rules (one table, `TURN_DIFF_RULES`, plus `revert_file`)
- Symlinks and junctions are neither tracked nor followed; a link anywhere on a revert path refuses the revert.
- Paths that are absolute, contain `..`, drive letters, empty parts or NUL are refused.
- Files whose names look like secrets (`requires_approval`) are never read or stored.
- Binary and oversized files are listed but cannot be reverted, except an added file, which is deleted.
- A file edited after the turn is never overwritten (`changed_since`, 409).
- Writes are atomic (temp file + replace) and byte-exact (CRLF kept).
- Limits: 5000 files, 256 KiB per file, 32 MiB of text, 100 listed files. Past a limit the event says `complete: false` and the UI says so.

## Conservative choices
- Changes made by the person or another tool while the turn runs are attributed to the turn.
- Revert is one-shot per file; there is no "revert all".
- A harness-graph run (`/execute/`) is not covered yet.
