# Independent QA — STUDIO-CLARITY

Date: 2026-09-13. Review snapshot: provider selection/status/configuration, per-agent pins, Studio overview/editor navigation, starter provenance, import and explicit Use in chat.

Status: QA Bounce — browser suite is red; route @FE for the E2E HTTP route/matcher correction and a complete rerun. The newly requested slash menu and additional Sonnet handoff work are not included in this snapshot and require their own readiness signal.

## Test execution

- Independent full frontend unit/component/integration suite: **47 files, 200 tests passed** after the provider correction. Evidence: `evidence/qa-regression.json`.
- The earlier independent run passed 199 tests. Its following typecheck caught the now-corrected unsupported `exact` property in `StudioOverview.test.tsx`. Independent post-correction `npm run typecheck` completed with exit 0; the combined verification command reported `QA test exit: 0; QA typecheck exit: 0`.
- No coverage percentage was measured. No live provider calls were used as test evidence.
- Browser execution was assigned to the parent to preserve ownership of the existing-port isolated-context test. QA reviewed its script and result. Latest delivered result: `evidence/e2e/result.json`, **failed** at `independent provider pins and explicit Use in chat`, with `page.waitForResponse: Timeout 12000ms exceeded while waiting for event "response"`.
- Parent identified two E2E test discrepancies: the client uses `/execute/` while the test matched `/execute`, and the composer sends with Ctrl+Enter while the test pressed Enter. These are identified test defects, not evidence that provider execution failed. A successful rerun is still required.
- The failed browser run stopped before same-ID import and responsive assertions. Those checks are not reported as passed.

## AC verification

| AC | Specific evidence | Snapshot outcome |
| --- | --- | --- |
| 1. Separate selection, enabled authority and connection evidence; explain Auto | `frontend/src/components/agent/chatProvider.test.ts:13`, `:34`, `:40`, `:53`; `frontend/src/components/agent/ChatProviderPicker.test.tsx:36` | Unit/component PASS. Picker details in `qa-provider.md`. |
| 2. Clear choices/unavailable states/configure actions and keyboard use | `frontend/src/components/agent/ChatProviderPicker.test.tsx:36`, `:99`, `:113` | PASS after one provider QA correction. Browser keyboard/viewport completion remains pending. |
| 3. Overview/editor/back/resume preserve the draft; Edit in Studio/import open editor | `frontend/src/components/shell/studioNavigation.test.ts:7`; `frontend/src/components/studio/StudioOverview.test.tsx:34`; `frontend/src/components/agent/HarnessBar.test.tsx:41`, `:49`, `:76`; `frontend/src/components/shell/HarnessLibrarySheet.test.tsx:12` | Unit/component PASS. Browser sample/back/resume assertions precede the later E2E failure; final import/browser run pending. |
| 4. Distinct starter origins; load actual returned bundle; visible failure preserves draft | `frontend/src/lib/studio.test.ts:22`, `:34`, `:44`, `:83`, `:93`; `frontend/src/components/studio/StudioOverview.test.tsx:15`, `:24` | Unit/component PASS and local provenance independently verified. Browser final run pending. |
| 5. Independent agent pins; chat fallback only for unpinned agents; preserve contracts | `frontend/src/components/sidebar/PropertiesPanel.provider.test.tsx:37`; `frontend/src/lib/bundleGraph.test.ts:49`, `:58`; `frontend/src/lib/studio.test.ts:67` | Unit/component PASS. Serialized browser execution assertion was not reached successfully because of the URL matcher defect. |

Additional guard: `frontend/src/components/studio/StudioOverview.test.tsx:46` verifies that an active run blocks starter replacement while keeping Continue editing available.

## Findings and routing

1. **AC2 — Auto configuration target mismatch, @FE — corrected.** Explicit Ollama local selection plus highlighted Auto/Uses Anthropic offered Configure Ollama local. FE observed RED, fixed the highlighted-row resolution and added regression assertions that the chat choice and all connection data remain unchanged. QA independently reran all 200 tests successfully.
2. **Full browser suite — HTTP matcher mismatch, @FE — open at snapshot.** Exact error and result above. Correct the fixture/matcher and rerun all browser steps, including same-ID import, actual keyboard use, and relevant provider/overview viewport bounds. Do not count the partial failed run as a complete E2E pass.

No other observable production defect was found within this review scope. This does not approve the expanded slash-menu/Automate work.

## Provenance checked independently

- `frontend/src/lib/templates.ts`: `minimal-gate` is the three-node frontend sample; the `agile-default` sketch is distinct from the shipped bundle.
- `backend/routers/bundles.py:11` points the default endpoint at `backend/oharness/fixtures/default-agile.ohm` and loads it with the codec.
- Backend fixture and `src-tauri/resources/default-agile.ohm` both hash to SHA-256 `F77F4ECA1186CEB1018AC626C75A086A887AB1C30B2FB00723C556E030B19F7E` in the inspected checkout.
- The fixture includes eight role nodes plus HITL. `backend/oharness/compile_skills_harness.py:15` explicitly omits HITL from its generated graph. The handoff accurately discloses this difference and the absence of live synchronization or guaranteed complete runtime parity.

## Definition of Done

| Item | Verification |
| --- | --- |
| Baseline and RED/GREEN per slice | Present in `tdd-provider.md`, ledger's Verified TDD progression, and `evidence/integration-red.json` / `integration-green.json`. |
| Full frontend regression | PASS, independent 200/200. Re-run after further production changes before final approval. |
| Typecheck | PASS, independent post-correction exit 0. |
| Browser on existing :3000 with isolated context and explicit API contracts | Script uses a new Edge context and intercepts sidecar traffic. Latest run failed; not complete. |
| Provider/Studio keyboard and widths | Component keyboard journey passes; browser completion pending. Desktop layout limits must be reported from measured results. |
| Fresh QA, ARCH and SEC gates | Fresh QA performed, currently bounced. Architecture and security remain later gates. |
| External handoff | `D:/Development/handoffs/2026-09-13-oharness-studio-clarity-sonnet.md` exists with source paths, provenance, reference URLs and runtime limits; final verification section remains pending. |
| No commit/merge/backend edits/server restart/concurrent overwrite | QA performed none. The shared checkout contains many pre-existing changes; QA did not reset or modify them. |

Existing limits are documented rather than represented as new capabilities: session-only draft retention; Studio Run has no chat fallback; AgentStage still needs an eligible chat selection for fully pinned harnesses; embedded framework Markdown is not proof of automatic runtime enforcement; old save paths may use bundle identity as a database identity.
