# OHarness 06 — Tauri Sidecar + Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Package OHarness as a real desktop app with Tauri v2, FastAPI sidecar lifecycle, keychain secrets, and a Windows installer — without Nightwolf port/zombie bugs.

**Architecture:** `src-tauri/` owns window chrome (decorations false). Sidecar binary = PyInstaller (or embedded python) running uvicorn. Frontend `output: "export"` static files. Shutdown module mirrors Nightwolf lessons with numeric port equality + tree kill. Keychain via `tauri-plugin-stronghold` or OS keyring crate replacing file_store.

**Tech Stack:** Tauri 2, Rust, PyInstaller, NSIS/MSVC bundler; Node next export.

**Spec:** design §3; ADR `docs/adr/0001-desktop-packaging.md`

**Depends on:** Plans 01–05 product loop working in browser

---

### Task 1: Next static export

**Files:**
- Modify: `frontend/next.config.ts` — `output: "export"`; ensure API routes that proxy are **removed or moved** to sidecar-only (browser dev keeps next routes; prod UI talks to sidecar `http://127.0.0.1:18765` or similar)
- Create: `frontend/src/lib/apiBase.ts` — resolves API base from `window.__OH_API__` injected by Tauri or env

- [ ] **Step 1:** `npm run build` produces `out/`
- [ ] **Step 2:** Document: prod has no Next server

---

### Task 2: Shutdown / port module (TDD first)

**Files:**
- Create: `desktop/shutdown.py` or `src-tauri` + `scripts/desktop_shutdown.mjs` — prefer **Python tests** if sidecar owns ports; also JS if Electron-like — for Tauri use `scripts/desktop-shutdown.mjs` tested with node:test
- Create: `scripts/desktop-shutdown.test.mjs`

**Rules:**
- Parse `netstat`/`Get-NetTCPConnection` ports with **numeric** equality
- Kill only allowlisted image names
- Never substring match ports

- [ ] **Step 1:** Failing test: port 51730 must not match watch for 5173
- [ ] **Step 2:** Implement + pass

---

### Task 3: Scaffold Tauri v2

**Files:**
- Create: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` / `lib.rs`
- Sidecar registration for FastAPI binary
- Window: decorations false, min 720×480, titleBarStyle Overlay on macOS

- [ ] **Step 1:** `npm run tauri dev` loads UI + spawns sidecar
- [ ] **Step 2:** TitleBar window controls call Tauri APIs (already guarded)

---

### Task 4: Keychain wire-up

**Files:**
- Modify: `backend/secrets/` — add `KeychainSecrets` called from Tauri commands OR sidecar using `keyring` Python package
- Modify: providers router to use keychain backend when `OH_SECRETS=keychain`

- [ ] **Step 1:** Integration test skipped on CI without keychain; unit with mock
- [ ] **Step 2:** File store remains fallback for `OH_SECRETS=file`

---

### Task 5: Installer

**Files:**
- Configure Tauri bundle targets: NSIS (Windows)
- Embed `default-agile.oharness`
- Root `README.md` — single install path
- Create: `docs/harness-spec/README.md` — public standard entry (schema + HELLO + validate)

- [ ] **Step 1:** `npm run tauri build` produces installer artifact
- [ ] **Step 2:** Clean VM / clean Windows user smoke: install → launch → default harness on → Studio validate → Agent toggle off/on → quit → ports free

---

### Task 6: Workspace index sync

**Files:**
- Modify: `D:\Development\CLAUDE.md`, `AGENTS.md`, `.cursor/rules/workspace.mdc` — replace HarnessSimulator with OHarness

- [ ] **Step 1:** Update project index rows

---

## Plan 06 done when

- [ ] Installer builds
- [ ] Smoke checklist (spec §6) passes
- [ ] Shutdown tests prove no substring port kills
- [ ] Master definition of done satisfied
