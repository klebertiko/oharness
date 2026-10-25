# OHarness 03 — Providers, Secrets, Runtime Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Product Providers rail (not only `/dev/providers`); secret references never in renderer; runtime router prefers CLI adapters then API adapters.

**Architecture:** Sidecar `SecretsStore` protocol with `MemorySecrets` (tests) and `KeychainSecrets` (Tauri command later; plan 06 wires real keychain — here use OS env / encrypted file stub behind same interface). Frontend wallet shows labels + `secretRef` ids only. `RuntimeRouter.select(preferred)` probes CLI then falls back to API.

**Tech Stack:** FastAPI, pytest; existing provider UI under `components/providers/`.

**Spec:** design §§2.1 runtime, 3 runtime policy, 4 security

**Depends on:** Plan 02 (Providers rail mount point)

---

### Task 1: Secrets port

**Files:**
- Create: `backend/secrets/base.py` (`SecretsStore` protocol: `put`, `get`, `delete`, `exists`)
- Create: `backend/secrets/memory.py`
- Create: `backend/secrets/file_store.py` (dev: DPAPI-free Fernet key from machine path — document as interim until Tauri keychain)
- Create: `backend/tests/test_secrets_store.py`
- Modify: `backend/requirements.txt` add `cryptography`

- [ ] **Step 1:** Failing tests Memory + File roundtrip
- [ ] **Step 2:** Implement; never log secret values

---

### Task 2: Providers API + catalog

**Files:**
- Create: `backend/adapters/catalog.py` (mirror frontend catalog; include openrouter)
- Create: `backend/routers/providers.py` — list catalog; CRUD connection metadata (no raw keys in responses); `POST /providers/{id}/secret` accepts key once, stores via SecretsStore, returns `{secretRef}`
- Modify: `backend/main.py`
- Create: `backend/tests/test_providers_api.py`

- [ ] **Step 1:** Tests ensure GET connections never contains `sk-` material
- [ ] **Step 2:** Implement

---

### Task 3: Wire frontend Wallet into product rail

**Files:**
- Modify: `frontend/src/app/page.tsx` Providers StubPanel → `Wallet` / `Dossier`
- Modify: `frontend/src/components/providers/secrets.ts` to call backend secret endpoint
- Modify: `frontend/src/components/sidebar/PropertiesPanel.tsx` — remove plain API key persistence; use secretRef dropdown

- [ ] **Step 1:** Manual + unit: saving key leaves only ref in client store
- [ ] **Step 2:** ADR note already forbids renderer secrets — add comment pointer in Wallet

---

### Task 4: Runtime router CLI → API

**Files:**
- Create: `backend/runtime/router.py`
- Create: `backend/runtime/cli_probe.py` (`which`-style probe for `claude`, `codex` on PATH)
- Create: `backend/adapters/cli_claude.py` (spawn wrapper stub that records argv in mock mode; live spawn gated)
- Create: `backend/tests/test_runtime_router.py`

**Interfaces:**
- `select_runtime(bundle_runtime, user_pref) -> RuntimeChoice(kind="cli"|"api", name=str)`
- Probe failure → api fallback; return reason string for UI toast

- [ ] **Step 1:** Tests: cli present → cli; absent → api
- [ ] **Step 2:** Integrate choice into `engine.py` execute path (log event `runtime_selected`)

---

## Plan 03 done when

- [ ] Providers rail works in product shell
- [ ] No API key strings in frontend persisted state after save
- [ ] Runtime router tests pass; execute emits runtime_selected
