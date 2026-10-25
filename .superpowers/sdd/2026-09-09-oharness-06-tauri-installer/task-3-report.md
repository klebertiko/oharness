# Task 3 report — Scaffold Tauri v2

## Done

- Committed coherent `src-tauri/`: Cargo.toml, tauri.conf.json (decorations false,
  min 720×480, titleBarStyle Overlay, window label `main`), lib.rs sidecar
  lifecycle via `tauri-plugin-shell`, capabilities allow-list for sidecar spawn.
- Embedded `resources/default-agile.oharness` (copy of product default fixture).
- Root `package.json` scripts: `tauri`, `tauri:dev`, `tauri:build`.
- `.gitignore` for `src-tauri/target/` and generated icons/sidecar binaries.
- Icons and sidecar binaries documented as generate-locally (no fake blobs).

## Verify

```text
git show --stat HEAD   # src-tauri/** + package.json
```

`npm run tauri:dev` / full Rust build **not** run here (HITL / machine with
Rust + icons + sidecar). Scaffold is intentional.

## HITL

Install Rust + `@tauri-apps/cli`, generate icons, place sidecar binary, then
`npm run tauri:dev`.
