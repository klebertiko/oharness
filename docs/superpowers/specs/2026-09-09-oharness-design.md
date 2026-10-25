# OHarness — Product & Architecture Design

**Date:** 2026-09-09  
**Status:** Draft for review  
**Approach:** Bundle-first (market-standard harness format + complete desktop product)

## Problem

Agent desktops (Claude, Codex, Cursor) ship strong runtimes but treat policy as opaque settings, prompts, or per-vendor plugins. There is no shared, portable, validatable standard for writing and exchanging an **agent harness** — the graph of roles, gates, skills, hooks, commands, and scripts that governs how work runs.

OHarness already has a canvas, FastAPI engine, and a Tauri packaging ADR; NightwolfRGB taught hard lessons about desktop lifecycle. The gap is a finished product: desktop app + installer + competitive Agent surfaces + a harness format communities will adopt.

## Goal

Ship a **complete desktop application** (installer included) that:

1. Matches and improves Claude / Codex / Cursor desktop agent capabilities (Chat, Cowork, Automations/Schedules, Git/PR across repo providers).
2. Adds **Harness Design Studio** and an **Agent harness toggle** (on / off / replace).
3. Establishes a **market-standard single-file harness format** — so well specified, documented, and simple that other communities adopt it for writing harnesses.
4. Ships the **skills-framework Agile harness** as the **product default**, also used as the canonical validate/mock suite — while remaining switchable and replaceable.

## Non-goals (v1)

- Full VS Code / Cursor IDE parity (tab-complete deep, editor fork).
- Cloud marketplace / signed plugin store (file + public spec first).
- Multi-device E2E encrypted sync.
- Claiming unsupported Cursor Origin operations on native Windows without a clear degraded path.

## Decisions (from design dialogue)

| Topic | Decision |
|---|---|
| Competitive bar | Agent-class desktop + harness as differentiator (not harness-only toy) |
| Surfaces | Agent (toggle) + Harness Design Studio |
| Runtime | CLI when possible; API when only API |
| Artifact | One file embedding prompts, agents, skills, hooks, commands, scripts, … |
| Default harness | skills-framework Agile harness — default, toggled, replaceable |
| Validate | Static schema + dry-run/mock in Studio |
| Packaging | Tauri v2 + FastAPI sidecar + real installer (ADR 0001) |
| Repo hosts | GitHub, GitLab, Cursor Origin, extensible providers |
| UX contract | sumi desktop-app-design + ADR shell rules |
| Nightwolf | Learn lifecycle/ports/docs; do not copy product |

---

## 1. Market standard — OHarness Bundle

**Working name:** OHarness Bundle (extension `.oharness`). Final public name (e.g. “Harness Spec”) may be chosen at publish time; schema id is stable.

**Principle:** one file = one complete, autonomous harness. Opening it in Studio or Agent requires no sidecar repo. Reading the public spec on GitHub is enough to implement a compatible producer/consumer.

### Layers

1. **Manifest** — id, name, harness version, **schema version**, authors, license, short description, tags.
2. **Graph** — nodes, wires, ports, roles (aligned with existing canvas model).
3. **Embedded content** — prompts, agents, skills, hooks, commands, scripts (skills-framework harness folder as conceptual map, packaged not loose).
4. **Runtime contract** — preferred CLI vs API fallback, env vars, **secret references** (never secret values).
5. **Validation profile** — static rules + dry-run/mock expectations Studio executes.

### Adoption DX (what makes it a standard)

- Public, semver’d schema (`$schema`); breaking = major.
- One-page “Hello Harness” + full Agile reference bundle.
- Offline CLI: `oharness validate path.oharness` (CI-friendly without GUI).
- Git-friendly canonical JSON (pretty-print, stable key order) with JSON Schema.
- Docs use progressive disclosure (skills-framework style): 5-minute minimum, depth optional.

### Out of format v1

Cloud gallery, package signing marketplace, mandatory online activation.

---

## 2. Product surfaces

One desktop app; mode switch in the shell (not two products).

### 2.1 Agent

Day-to-day workspace. Capabilities (parity + improve):

| Block | Role |
|---|---|
| **Chat / Composer** | Multi-turn coding and conversation |
| **Cowork** | Knowledge work: local files, long-running tasks, sub-agent coordination, persistent projects |
| **Automations / Schedules** | On-demand and cron jobs (Codex schedules + Claude scheduled tasks) |
| **Git / Pull Requests** | Diffs, commits, PR/MR create, review, watch-fix — via **RepoProvider** adapters |
| **Harness control** | Active bundle + **on / off / replace** |

**Harness behaviour**

- **OFF** — runtime runs directly (CLI if available, else API). Same workspace.
- **ON** — active `.oharness` governs the loop (nodes, hooks, gates, skills).
- **Replace** — user selects another bundle (imported or from library); default remains skills-framework until changed.
- Default on first run: **skills-framework Agile harness**, ON (user can turn off or swap immediately).

**Improvements over incumbents**

- Policy is a portable, validatable artifact — not opaque vendor plugins alone.
- Runs expose gates, HITL, structured transcript (wire existing `agent-run/` into Agent).
- Same automation can run with harness OFF (parity) or ON (governed).

### 2.2 Harness Design Studio

- Create/edit full bundle (graph + embedded content).
- **Validate** (static) + **Mock / dry-run** before export.
- Import/export `.oharness`.
- skills-framework harness is the built-in reference template **and** the primary validate/mock fixture.

### 2.3 Shell (sumi + ADR 0001)

- Tauri `decorations: false`; custom `TitleBar`; macOS traffic-light overlay.
- Command palette, activity rail (Agent | Studio | Runs | Providers), resizable panels, persisted geometry.
- Keyboard-first; spatial memory.

### 2.4 Repo providers

Shared port — not GitHub-only:

| Provider | Notes |
|---|---|
| GitHub | PRs, checks, review comments |
| GitLab | MRs, pipelines |
| Cursor Origin | `origin.cursor.com` + `origin` CLI; degrade clearly where unsupported (e.g. native Windows) |
| Extensible | Bitbucket / self-hosted via same interface |

Automations and PR harnesses call the port; adapters swap underneath.

---

## 3. Runtime, desktop packaging, installer

### Process topology

```
Installer
└─ Tauri app (WebView UI)
   └─ FastAPI sidecar
        ├─ Bundle load / validate / mock / live
        ├─ Runtimes: CLI adapters → API adapters
        ├─ RepoProvider adapters
        ├─ Automation scheduler
        └─ Secrets via OS keychain
```

### Agent runtime policy

1. Prefer official CLIs when present and configured (Claude Code, Codex CLI, …).
2. Else use HTTP adapters for user subscriptions (Anthropic, OpenAI, OpenRouter, Ollama, …).
3. Harness ON wraps whichever runtime was selected.

### Installer

- Real per-platform installers; Windows first-class; macOS/Linux in the same design.
- Ships UI (Next static export), sidecar, schema, **default skills-framework `.oharness`**.
- Single product story in docs (no competing “two terminal” vs “desktop” myths).
- Update path documented (auto-update may follow immediately after first installer).

### Lifecycle (Nightwolf lessons)

- Sidecar is a child of the shell; quit kills the whole tree (no Vite/API zombies).
- Port matching by numeric equality, never substring.
- Loopback by default; no unauthenticated LAN bind.
- Injectable, tested shutdown module.
- Single-instance lock.
- One canonical dev command; production = installer.

---

## 4. Data, security, errors, testing

### Data

- SQLite in sidecar: index of harnesses, runs, jobs, workspace metadata.
- `.oharness` files on disk are source of truth for share/git.
- Migrate panel prefs from `localStorage` to Tauri store.
- Cowork project files/index local to workspace.

### Security

- Credentials only in OS keychain; renderer holds references, never values (retire plain-text POC fields).
- Tauri capabilities deny-by-default (untrusted model/MCP output).
- Destructive automation actions (push, merge, delete) support configurable HITL.
- Minimum OAuth/token scopes per RepoProvider.

### Errors

- Missing CLI → API fallback + explicit status.
- Unsupported provider feature → disabled with reason.
- Failed validate → cannot mark export “valid”; diagnostic mock still allowed.
- Live node failure → structured transcript / gate, not silent chat swallow.
- Sidecar death → title-bar fault + controlled respawn.

### Testing

| Layer | Coverage |
|---|---|
| Schema / validate | Fixtures: hello + **skills-framework default bundle** |
| Engine | Topology, cycles, mock, harness ON/OFF/replace |
| Shutdown / ports | Contract tests (Nightwolf-class) |
| Repo providers | In-memory fakes per adapter |
| UI seams | Toggle, import/export, validate report |

### Default + dogfood

The **skills-framework** Agile harness is:

1. **Product default** (shipped, selectable, on/off/replaceable).
2. **Canonical validate/mock harness** (the suite and fixture that prove the standard).

---

## 5. Mapping to current codebase

| Existing | Fate |
|---|---|
| `frontend` canvas, shell, templates | Studio core; presets → bundles |
| `components/agent-run/*` (orphaned) | Mount on Agent |
| Stub Runs / Providers / Harnesses rails | Implement against APIs + wallet + bundle library |
| `backend` engine + adapters | Sidecar; extend CLI adapters + catalog |
| ADR 0001 Tauri | Implement `src-tauri/`, sidecar, installer |
| `docker-compose` | Dev/CI aid; not the product distribution story |
| skills-framework `skills/engineering/harness` | Source to compile into default `.oharness` |

## 6. Success criteria (v1 “finished”)

1. Installer launches Agent + Studio on a clean machine.
2. Default skills-framework harness can be turned **off**, **on**, and **replaced**.
3. Studio validates + mock-runs the default bundle; export/import round-trips.
4. Public schema + Hello Harness + validate CLI exist for external adopters.
5. Chat, Cowork, Automations/Schedules, and Git/PR (at least one provider live + fakes for others) work with harness ON and OFF.
6. Secrets never appear in renderer; shutdown leaves no orphan ports/processes.
7. Docs describe one install path and the harness standard clearly enough for a third party to author a compatible bundle.

## 7. Open names (non-blocking)

- Public brand for the format (`OHarness Bundle` vs `Harness Spec` vs other).
- Exact file extension (`.oharness` vs `.harness.json`).

Resolve at spec publish / first tagged schema; behaviour above does not depend on the marketing string.
