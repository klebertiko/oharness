# OHarness DX/UX — Chat-first Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OHarness feel like Cursor/Claude/Codex desktop: Chat home with threads, harness bar above composer, Providers (no Wallet), Studio for graph validate-without-tokens, Tauri as the official run path, Nightwolf-style brand icons.

**Architecture:** Keep Agent/Studio mode split. Reshape Agent into master–detail (threads | chat). Move Cowork/Automations/Git off Chat tabs into command palette. Surface provider auto-probe (Claude → Cursor → API → mock) on a composer chip. Rename all user-facing “Wallet” to “Providers”. Wire `brand/` into Tauri icons and a root `desktop` script.

**Tech Stack:** Next.js frontend, FastAPI sidecar, Zustand, Vitest, pytest, Tauri v2, existing `runtime/cli_probe.py` + provider store.

**Spec:** `docs/superpowers/specs/2026-09-09-oharness-dx-ux-design.md`  
**Design tokens / brand:** `design.md`, `brand/README.md`

## Global Constraints

- User-facing UI must never say **Wallet** (code identifiers may rename gradually; strings/panel titles must say **Providers**).
- Official UX path is **Tauri desktop**, not browser localhost.
- Harness default **ON** + Agile default bundle (already in session store — do not regress).
- Studio Validate / mock dry-run must not call live provider billing paths.
- Credentials never in the renderer (ADR 0001).
- Keyboard-first: Ctrl/Cmd+K, Alt+1/2/4, existing keymap sheet.
- Commits: conventional, small, after each task green.
- Prefer TDD for stores and pure helpers; UI wiring verified by vitest where cheap + manual desktop smoke.

## File map

| Path | Responsibility |
|---|---|
| `frontend/src/components/providers/Wallet.tsx` → rename export/file toward `ProvidersList.tsx` | Connection list UI |
| `frontend/src/app/page.tsx` | Panel title Providers; Agent left = threads |
| `frontend/src/components/agent/AgentStage.tsx` | Chat-only stage + harness bar; no tool tabs |
| `frontend/src/components/agent/HarnessBar.tsx` (new) | On/Off · bundle · provider chip · Open in Studio |
| `frontend/src/components/agent/ThreadsSidebar.tsx` (new) | Thread list master |
| `frontend/src/store/threadStore.ts` (new) | In-memory (+ localStorage) threads v1 |
| `frontend/src/components/shell/commands.ts` | Palette entries for Cowork/Automations/Git + Providers |
| `frontend/src/lib/providerProbe.ts` (new) | Client helper: order Claude→Cursor→API→mock |
| `backend/runtime/cli_probe.py` | Add `cursor` / agent CLIs to `KNOWN_CLIS` if missing |
| `backend/routers/` (probe endpoint if needed) | GET health of CLIs for chip |
| `brand/*` | mark.svg, icon.png — already created |
| `package.json` (root) | `desktop` script |
| `README.md` | Desktop-first docs |
| `src-tauri/` | Icon stamp from `brand/icon.png` |

---

### Task 1: Kill “Wallet” in the UI

**Files:**
- Modify: `frontend/src/app/page.tsx` — `Panel title="Providers"`
- Modify: `frontend/src/app/dev/providers/page.tsx` — same
- Modify: `frontend/src/components/sidebar/PropertiesPanel.tsx` — “bind from Providers”
- Modify: `frontend/src/components/providers/Wallet.tsx` — export `ProvidersList` (re-export `Wallet` as deprecated alias if needed for one commit)
- Rename file optionally to `ProvidersList.tsx` in same task if imports stay green
- Test: `frontend/src/components/providers/providersCopy.test.ts` (new) — greps exported UI copy constants OR snapshot of panel title helper

**Interfaces:**
- Produces: `ProvidersList` component (same props as current `Wallet`)
- Consumes: `useProviderStore` unchanged

- [ ] **Step 1:** Add failing test that `providersPanelTitle === "Providers"` and that a small `USER_FACING_COPY` module (or string constants used by Panel) does not include `"Wallet"`

```ts
// frontend/src/components/providers/copy.ts
export const PROVIDERS_PANEL_TITLE = "Providers";
```

```ts
// frontend/src/components/providers/copy.test.ts
import { PROVIDERS_PANEL_TITLE } from "./copy";
import { expect, test } from "vitest";

test("panel title is Providers not Wallet", () => {
  expect(PROVIDERS_PANEL_TITLE).toBe("Providers");
  expect(PROVIDERS_PANEL_TITLE.toLowerCase()).not.toContain("wallet");
});
```

- [ ] **Step 2:** Run `cd frontend && npm test -- copy.test.ts` — expect FAIL (module missing)

- [ ] **Step 3:** Add `copy.ts`; wire `page.tsx` / `dev/providers/page.tsx` / PropertiesPanel to use it; rename component display; update comments that user might see in UI only

- [ ] **Step 4:** Run tests — PASS; `rg -n "title=\"Wallet\"|Wallet</|\"Wallet\"" frontend/src --glob '*.tsx'` returns no user-visible hits (code comments OK if clearly internal)

- [ ] **Step 5:** Commit `fix(ui): rename Wallet to Providers in user-facing copy`

---

### Task 2: Thread store (master list)

**Files:**
- Create: `frontend/src/store/threadStore.ts`
- Create: `frontend/src/store/threadStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Thread = { id: string; title: string; createdAt: number; updatedAt: number };
  // store:
  threads: Thread[]
  activeThreadId: string | null
  createThread(title?: string): string
  selectThread(id: string): void
  renameThread(id: string, title: string): void
  // persist key: oh.threads.v1
  ```
- Consumes: none

- [ ] **Step 1:** Write failing tests: create → select → rename; persistence round-trip with mocked localStorage

- [ ] **Step 2:** Run vitest — FAIL

- [ ] **Step 3:** Implement `threadStore` with zustand + persist

- [ ] **Step 4:** Tests PASS

- [ ] **Step 5:** Commit `feat(agent): thread store for chat sidebar`

---

### Task 3: ThreadsSidebar + Agent layout shell

**Files:**
- Create: `frontend/src/components/agent/ThreadsSidebar.tsx`
- Modify: `frontend/src/app/page.tsx` — when Agent && !providers: left panel = `ThreadsSidebar` (not HarnessLibrary by default); Harnesses remain via palette/rail
- Modify: `frontend/src/components/shell/shellStore.ts` — Agent default section stays files-compatible or introduce `section: "threads"` if cleaner; prefer mapping Agent left → threads without breaking Studio left

**Interfaces:**
- Consumes: `threadStore`
- Produces: sidebar with New + list; keyboard ↑↓ when focused

- [ ] **Step 1:** Render `ThreadsSidebar` in Agent left; ensure Studio left unchanged (Harnesses/palette as today)

- [ ] **Step 2:** Empty state: “New chat” CTA calls `createThread`

- [ ] **Step 3:** Manual / component test if cheap: creating thread selects it

- [ ] **Step 4:** Commit `feat(agent): Cursor-like threads sidebar on Agent home`

---

### Task 4: HarnessBar + Chat-only AgentStage

**Files:**
- Create: `frontend/src/components/agent/HarnessBar.tsx`
- Modify: `frontend/src/components/agent/AgentStage.tsx` — remove Chat/Cowork/Automations/Git tablist; always show chat transcript+composer; mount `HarnessBar` above composer
- Modify: `frontend/src/components/agent/HarnessSwitch.tsx` — fold into HarnessBar or keep as child
- Modify: `frontend/src/store/modeStore.ts` / commands — “Open in Studio” → `setMode("studio")`

**Interfaces:**
- `HarnessBar` props/store:
  - harness enabled toggle (`harnessSessionStore`)
  - active bundle label
  - provider chip label (placeholder `"…"` until Task 5)
  - `onOpenStudio`, `onOpenProviders`

- [ ] **Step 1:** Strip tabs from `AgentStage`; Cowork/Automations/Git components unused here

- [ ] **Step 2:** Implement `HarnessBar` UI per spec ASCII (On/Off · bundle · chip · Open in Studio)

- [ ] **Step 3:** Wire Open in Studio to `modeStore.setMode("studio")` and Providers chip to `shellStore.setSection("providers")`

- [ ] **Step 4:** Smoke: Agent shows single chat surface

- [ ] **Step 5:** Commit `feat(agent): harness bar above composer; chat-only stage`

---

### Task 5: Palette entries for Cowork / Automations / Git

**Files:**
- Modify: `frontend/src/components/shell/commands.ts`
- Modify: `frontend/src/components/shell/AppShell.tsx` or `page.tsx` — when command fires, open a float/panel or temporary overlay hosting the existing panels
- Prefer: set shell section or a lightweight `overlay: "cowork" | "automations" | "git" | null` on `shellStore`

**Interfaces:**
- Produces: `shellStore.overlay` + commands `Open Cowork`, `Open Automations`, `Open Git`
- Consumes: existing `CoworkPanel`, `AutomationsPanel`, `GitPanel`

- [ ] **Step 1:** Add `overlay` to shellStore with test

- [ ] **Step 2:** Register palette commands

- [ ] **Step 3:** Render overlay host in Agent mode (modal or full-stage swap) mounting the three panels

- [ ] **Step 4:** Commit `feat(shell): move Cowork/Automations/Git to command palette`

---

### Task 6: Provider auto-probe → chip + execution default

**Files:**
- Modify: `backend/runtime/cli_probe.py` — ensure probe order includes `claude`, cursor agent binary if documented (`cursor` / `agent` — verify on Windows PATH), `codex`
- Create or extend: `backend/routers/runtime.py` (or providers) — `GET /runtime/probe` → `{ clis: {claude?: path}, preferred: "claude"|"cursor"|"api"|"mock" }`
- Create: `frontend/src/lib/providerProbe.ts`
- Create: `frontend/src/lib/providerProbe.test.ts`
- Modify: `HarnessBar` chip + `AgentStage` / canvas `executionMode` hydration on load

**Interfaces:**
- Produces: `PreferredRuntime = "claude" | "cursor" | "api" | "mock"`
- Probe order locked: Claude → Cursor → API (any live connection in providerStore) → mock
- When preferred is mock, set `executionMode` to `"mock"`; else `"live"`

- [ ] **Step 1:** pytest for probe order / known CLIs

- [ ] **Step 2:** Implement endpoint + client helper with unit tests (mock fetch)

- [ ] **Step 3:** Wire chip label e.g. `Claude CLI · live` / `mock · no provider`

- [ ] **Step 4:** Commit `feat(runtime): auto-probe Claude→Cursor→API→mock for Chat`

---

### Task 7: Studio link + validate-without-tokens copy/guard

**Files:**
- Modify: `frontend/src/components/studio/ValidateDock.tsx` — explicit copy: “Mock validate — no provider tokens”
- Modify: validate/mock API callers to force `mode: "mock"` (never live from Validate dock)
- Test: unit on helper `assertValidateIsMock(mode)`

- [ ] **Step 1:** Failing test that validate dock path only allows mock

- [ ] **Step 2:** Implement guard + copy

- [ ] **Step 3:** Commit `fix(studio): validate dock cannot spend provider tokens`

---

### Task 8: Desktop DX + brand icons

**Files:**
- Modify: root `package.json` — scripts:
  - `"desktop": "…"` — document concurrent sidecar + `tauri:dev` (use `npm-run-all` or a small `scripts/desktop.mjs` that spawns both; if Windows-fragile, document two terminals but prefer one command)
  - `"brand:icons": "tauri icon brand/icon.png"`
- Modify: `README.md` — lead with desktop; browser as fallback
- Modify: `src-tauri/tauri.conf.json` — point icons at generated `src-tauri/icons` after stamp
- Copy `brand/mark.svg` into `frontend/public/mark.svg` if favicon needed
- Align `Mark.tsx` geometry with `brand/mark.svg` (optional visual tweak same commit)

- [ ] **Step 1:** Add `scripts/desktop.mjs` (spawn uvicorn with `.venv` python + `tauri dev`)

- [ ] **Step 2:** Run `npm run brand:icons` when Rust/tauri CLI available; if blocked, leave checklist note in README

- [ ] **Step 3:** README desktop-first smoke steps

- [ ] **Step 4:** Commit `chore(desktop): brand icons + desktop run script`

---

### Task 9: Integration smoke (HITL)

**Files:** none (checklist)

- [ ] **Step 1:** `npm run desktop` (or documented fallback) — window opens on Agent Chat
- [ ] **Step 2:** Threads sidebar visible; New chat works
- [ ] **Step 3:** Harness bar shows ON + Agile; Open in Studio switches mode
- [ ] **Step 4:** Validate dock states mock / no tokens
- [ ] **Step 5:** Providers panel title = Providers; chip reflects probe
- [ ] **Step 6:** Ctrl+K opens Cowork/Automations/Git commands
- [ ] **Step 7:** Note residual gaps in ledger / PR description

---

## Execution handoff

After this plan is saved, implement with **subagent-driven-development** (user preference from earlier OHarness work) unless the user asks for executing-plans inline.

**Plan complete and saved to `docs/superpowers/plans/2026-09-09-oharness-dx-ux-desktop.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + reviewer  
2. **Inline** — executing-plans in this session  

Which do you want?
