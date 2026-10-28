# ADR 0010 — Pre-tool hooks (fail-closed)

Status: accepted (#165)

## Decision
A hook is a program registered in the sidecar (`/chat/tools/hooks`, table `tool_hooks`). Before a tool runs, every hook that names that tool runs in order. Exit 0 allows; anything else blocks: a non-zero exit, a timeout, a spawn failure, or a stored row that no longer validates. The first block ends the chain; the tool never runs. Each evaluation is journaled as `tool_hook_decision` with `hook_id`, `decision` and `reason`, then a blocking one as `tool_denied` with reason `hook`.

## Hardening
- Registered only through the authenticated sidecar API. Never read from a workspace or a run request, so a repository cannot plant a hook.
- argv only, no shell; the program must be an absolute path and not a shell (`HOOK_RULES.denied_programs`).
- Environment rebuilt from the allowlist (`scrub_env`), no extras: no hook inherits provider keys or other secrets. The stdin payload is redacted.
- Timeout 1–10 s (default 5); the whole process tree is killed on expiry. Output is discarded, so a hook cannot flood memory.
- One rules table (`HOOK_RULES`) serves the validator and the UI; a parity test pins them.

## Conservative choices
- Hooks apply to every workspace and every tool they name; there is no per-workspace opt-out.
- Hooks do not run for `mock` exec (nothing executes).
- A hook cannot rewrite arguments or approve on the person's behalf; it can only veto.
