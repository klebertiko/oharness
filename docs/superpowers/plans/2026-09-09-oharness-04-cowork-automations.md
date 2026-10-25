# OHarness 04 — Cowork + Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Cowork workspaces (files + instructions + memory + optional harness) and Automations/Schedules that run on-demand or on cron, with or without harness.

**Architecture:** `CoworkProject` and `AutomationJob` tables in SQLite. Scheduler asyncio loop inside sidecar. Jobs invoke the same execute pipeline as Agent (harness enabled flag on job). UI: Agent sub-nav Cowork | Automations.

**Tech Stack:** FastAPI, SQLAlchemy, APScheduler or lightweight asyncio cron; pytest.

**Spec:** design §§2.1 Cowork, Automations; Codex schedules parity

**Depends on:** Plans 02–03

---

### Task 1: Models + CRUD API

**Files:**
- Modify: `backend/models.py` — `CoworkProject`, `AutomationJob`
- Create: `backend/routers/cowork.py`, `backend/routers/automations.py`
- Create: `backend/tests/test_cowork_automations_api.py`

**Interfaces:**
- Project: `{id, name, rootPath, instructions, memoryJson, harnessBundleId?, harnessEnabled}`
- Job: `{id, name, cron|null, projectId?, harnessBundleId?, harnessEnabled, lastRunAt, status}`

- [ ] **Step 1:** Failing CRUD tests
- [ ] **Step 2:** Implement + migrate create_all

---

### Task 2: Scheduler

**Files:**
- Create: `backend/automations/scheduler.py`
- Create: `backend/tests/test_scheduler.py`

- [ ] **Step 1:** Test: job with cron `* * * * *` fires mock execute once in fake clock / immediate trigger API `POST /automations/{id}/run`
- [ ] **Step 2:** Implement in-process scheduler started from `main.py` lifespan; `run now` endpoint always available

---

### Task 3: Agent UI — Cowork + Automations

**Files:**
- Create: `frontend/src/components/cowork/CoworkPanel.tsx`
- Create: `frontend/src/components/automations/AutomationsPanel.tsx`
- Modify: Agent layout / ActivityRail children

- [ ] **Step 1:** List/create projects; bind folder path (text input v1)
- [ ] **Step 2:** Automations list; create schedule; Run now; show last status
- [ ] **Step 3:** Each surface respects harnessSessionStore OR per-job harness override

---

## Plan 04 done when

- [ ] CRUD + run-now tests pass
- [ ] UI can create automation and trigger mock run with harness on and off
