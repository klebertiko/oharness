# OHarness 02 — Agent + Studio Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Split the shell into **Agent** and **Studio** modes; harness **on / off / replace**; mount orphaned `agent-run` into Agent; Harnesses rail loads default + imported bundles.

**Architecture:** Zustand `modeStore` + `harnessSessionStore` (activeBundleId, enabled). Studio reuses canvas on `/` when mode=studio. Agent shows chat/run chrome + `agent-run` panel. Bundles fetched from `/bundles/default` and local library (IndexedDB or filesystem via API later; v1: memory + localStorage JSON list).

**Tech Stack:** Existing Next/React/Zustand; Vitest for store tests.

**Spec:** design §§2, 2.1 harness control, 5 mapping

**Depends on:** Plan 01 (`/bundles/default`, validate/mock APIs)

## Global Constraints

Master plan. No Tauri yet — browser + docker/dev is fine; stores must not hold secret values.

---

### Task 1: Session stores (TDD)

**Files:**
- Create: `frontend/src/store/modeStore.ts`
- Create: `frontend/src/store/harnessSessionStore.ts`
- Create: `frontend/src/store/modeStore.test.ts`
- Create: `frontend/src/store/harnessSessionStore.test.ts`
- Modify: `frontend/package.json` — add `"test": "vitest run"`, devDep `vitest`

**Interfaces:**
- `modeStore`: `mode: "agent" | "studio"`, `setMode`
- `harnessSessionStore`: `enabled: boolean`, `activeBundle: HarnessBundle | null`, `setEnabled`, `setActiveBundle`, `replaceBundle`, hydrate from `/bundles/default` on first load

- [ ] **Step 1:** Add vitest; write failing tests for toggle + replace
- [ ] **Step 2:** Implement stores; tests pass
- [ ] **Step 3:** Persist `{enabled, activeBundleId}` in localStorage key `oh.harnessSession`

---

### Task 2: Activity rail modes

**Files:**
- Modify: `frontend/src/components/shell/ActivityRail.tsx`
- Modify: `frontend/src/components/shell/AppShell.tsx`
- Modify: `frontend/src/components/shell/commands.ts` (commands: mode agent/studio, harness on/off)

- [ ] **Step 1:** Rail items Agent | Studio switch `modeStore`
- [ ] **Step 2:** Command palette entries mirror rail
- [ ] **Step 3:** Manual check: `npm run dev` — switching modes updates shell without full reload

---

### Task 3: Studio mode = canvas + validate/mock dock

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Create: `frontend/src/components/studio/ValidateDock.tsx`
- Create: `frontend/src/lib/bundlesApi.ts` (`validateBundle`, `mockBundle`, `fetchDefault`)

- [ ] **Step 1:** When `mode===studio"`, render existing canvas/palette/inspector; hide Agent chat stubs
- [ ] **Step 2:** ValidateDock calls `POST /bundles/validate` and `POST /bundles/mock`; show errors/steps
- [ ] **Step 3:** Export downloads active graph+content as `.oharness` (compose from canvasStore + content stubs from default for v1)
- [ ] **Step 4:** Import file input → validate → `replaceBundle`

---

### Task 4: Agent mode — mount agent-run + harness switch UI

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Create: `frontend/src/components/agent/HarnessSwitch.tsx`
- Modify: wire `components/agent-run/*` into Agent layout (bottom/side panel)
- Modify: run start path to use `/api/run` when `enabled`; when disabled, call execute with a passthrough single-llm graph OR skip graph and hit a new thin `/execute/direct` (if missing, add minimal backend route that runs one adapter turn)

**Interfaces:**
- `HarnessSwitch`: toggle enabled; dropdown replace from library
- When enabled=false, RunControls still work (direct)
- When enabled=true, existing engine execute with active bundle graph

- [ ] **Step 1:** Mount Transcript + RunLadder + Gate + RunControls in Agent
- [ ] **Step 2:** HarnessSwitch UI bound to harnessSessionStore
- [ ] **Step 3:** Stop control must call `/api/run/[id]/control` (fix palette stub that only `setRunning(false)`)
- [ ] **Step 4:** Manual: default agile ON → mock run shows ladder; OFF → direct path

---

### Task 5: Harnesses rail (replace StubPanel)

**Files:**
- Modify: `frontend/src/app/page.tsx` (Harnesses section)
- Create: `frontend/src/components/harnesses/HarnessLibrary.tsx`
- Create: `frontend/src/store/harnessLibraryStore.ts`

- [ ] **Step 1:** Library always includes default agile from `/bundles/default`
- [ ] **Step 2:** Import adds to library; Activate calls `replaceBundle` + optional `setEnabled(true)`
- [ ] **Step 3:** Show badge "default" on skills-framework bundle

---

## Plan 02 done when

- [ ] Mode switch Agent/Studio works
- [ ] Default harness loads; on/off/replace works
- [ ] agent-run visible in Agent; stop hits control API
- [ ] Studio validate/mock against `/bundles/*`
