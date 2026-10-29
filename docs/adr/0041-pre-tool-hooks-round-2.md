# ADR 0041 — Pre-tool hooks: one gate everywhere, edit in place, what stays out

Status: accepted (#165, follow-up to ADR 0026)

## Decision
- A **simulated** (mock) `exec` runs no program, hooks included: each matching hook is journaled as `skipped` (reason `simulated`) and the tool card says "not run (simulated)". Running a person's real programs during a demo that promises to execute nothing would be the surprise.
- Plan-mode refusals still come first: nothing would run, so no hook is started for it.
- The Tool hooks sheet edits a hook in place (id fixed, saved under the same id) and shows a stored row that no longer validates as "blocks every tool until replaced".
- Docs: USAGE, GLOSSARY, CONTEXT (Hook). e2e: `e2e-tool-hooks.mjs` (register, edit, focus return, blocked tool card, both themes, axe).

## What stays out, and why
- **Hooks that approve or rewrite a call.** A hook is a veto only; letting it approve would turn a program into a second approval authority outside the permission policy.
- **Hooks for harness-graph runs.** Harness runs do not go through the tool broker (their nodes call providers directly), so there is no tool call to gate.
- **Per-workspace hooks.** A hook read from a workspace would let a repository run a program on the person's machine. Hooks stay global and registered through the sidecar.
- **Interface language.** The app has no translation layer yet (all copy is English), so the new strings follow it.
- **Still to verify on a real machine:** Windows job-object cleanup of a hook's descendants (the cleanup path is covered on POSIX in CI; the Windows path shares `ProcessTree` with `exec` but is not run in this sandbox).
