# Task 5 report — Installer docs

## Done

- NSIS already configured in `src-tauri/tauri.conf.json`
  (`bundle.targets: ["nsis"]`, `windows.nsis.installMode: currentUser`).
- Root `README.md` — single install path, prerequisites, `npm run tauri:build`,
  expected NSIS artifact path. Explicitly does **not** claim a verified build.
- `docs/harness-spec/README.md` — public standard entry (HELLO + schema + validate).

## Verify

Documented commands only — no `tauri build` executed on this agent pass.

## HITL

Smoke checklist in README after a local NSIS install.
