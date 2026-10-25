# OHarness — Master Implementation Plan

> **For agentic workers:** Execute **child plans in order** (01 → 06). Each child plan is independently testable. REQUIRED SUB-SKILL per child: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

**Goal:** Finish OHarness as a complete desktop product: market-standard `.oharness` format, Agent + Studio, competitive surfaces (Chat/Cowork/Automations/Git-PR), default skills-framework harness (on/off/replace), Tauri installer.

**Architecture:** Bundle-first. Sidecar FastAPI owns validate/mock/live, CLI→API runtimes, RepoProviders, automations, keychain-backed secrets. Tauri shell hosts Next static UI. Spec: `docs/superpowers/specs/2026-09-09-oharness-design.md`.

**Tech Stack:** Tauri v2, Next.js 15 (static export), React 19, Zustand, React Flow, FastAPI, SQLAlchemy/SQLite, pytest, Vitest, JSON Schema.

**Spec:** `docs/superpowers/specs/2026-09-09-oharness-design.md`

## Global Constraints

- Schema version semver; breaking changes bump major.
- Secrets never in renderer; keychain/sidecar only.
- Default harness = skills-framework Agile; user can turn **off**, **on**, or **replace**.
- Runtime: CLI when possible, API when only API.
- Repo providers: GitHub, GitLab, Cursor Origin (+ extensible); no GitHub-only hardcoding.
- Ports matched by numeric equality; loopback default; tested shutdown.
- One install story in docs; product distribution = installer (compose is dev/CI only).
- TDD: red → green per task; commit only when the human asks (workspace rule) unless human opts into plan commit steps.
- Rename branding `harness-simulator` → `oharness` in plan 01.

## Child plans (execute in order)

| # | Plan file | Delivers |
|---|---|---|
| 01 | `2026-09-09-oharness-01-bundle-standard.md` | `.oharness` schema, validate CLI, compile skills-framework → default bundle, mock dry-run API |
| 02 | `2026-09-09-oharness-02-agent-studio-toggle.md` | Studio/Agent modes, harness on/off/replace, mount `agent-run`, harness library rail |
| 03 | `2026-09-09-oharness-03-providers-secrets.md` | Provider wallet UI in product, catalog, keychain seam, CLI/API runtime router |
| 04 | `2026-09-09-oharness-04-cowork-automations.md` | Cowork workspace + Automations/Schedules engine |
| 05 | `2026-09-09-oharness-05-repo-providers.md` | RepoProvider port + GitHub/GitLab/Origin adapters + PR flows |
| 06 | `2026-09-09-oharness-06-tauri-installer.md` | `src-tauri/`, sidecar lifecycle, Windows installer, shutdown tests |

## Definition of done (full product)

Matches spec §6 Success criteria. Do not declare finished until plan 06 installer smoke-test passes and default harness toggles on a clean install.
