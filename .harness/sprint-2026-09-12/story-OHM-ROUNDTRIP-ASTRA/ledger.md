# OHM-ROUNDTRIP-ASTRA ledger

Status: Done — implementation and automated/independent gates complete; ready for human integration. 2026-09-12. No commit/merge.

Gate update: independent QA Approved for Architecture Review after corrected E2E rerun; ARCH approved; SEC fresh-context PASS (23/23 targeted tests, no introduced P0–P3 finding). Parent and independent QA both passed corrected browser roundtrip with explicit HTTP contracts, no unexpected requests and no page/runtime overlay errors.

Final evidence: frontend 170/170 in 38 files, typecheck clean, 12/12 targeted semantic mutants killed with 0 survivors/invalid/timeouts, independent corrected browser E2E passed. git diff --check passed for scoped tracked files (only platform line-ending warnings). Coverage percentage was not measured and is not claimed.

External return handoff: D:/Development/handoffs/2026-09-12-oharness-ohm-roundtrip-astra-retorno.md. User/Sonnet retains integration, commit and merge decisions. Historical entries below preserve the RED/GREEN and QA bounce sequence; the final status above supersedes their pending notes.

Contract: story.md. Export evidence: tdd-export.md. Import/E2E/mutation and gates recorded here.

Seams were specified by Sonnet's handoff and accepted by the user's instruction to complete that handoff. No backend edits, commits or merges authorized in this slice.

## Baseline

Target: frontend/src/lib/bundlesApi.test.ts + bundleGraph.test.ts: 11/11 passed before edits.

## TDD slices observed

- AC3 authoring seam: bundleGraph.authoring.test.ts RED `bundleGraphToCanvas is not a function`; implemented converter; GREEN 7/7 including six existing execution converter tests.
- AC3 actual legacy file import: ValidateDock.test.tsx RED reported Imported while nodes stayed []; wired authoring converter and legacy role preservation; GREEN 9/9 across dock and converter tests.
- AC3 Edit in Studio: HarnessBar test RED observed injected providerIds=[] and roleId=""; switched authoring seam and restored manifest metadata; all five HarnessBar tests passed.
- Import safety: two RED tests observed deprecated apiKey retained and type="constructor" becoming Object function. Fix removes apiKey from a copied data object and resolves only own properties of legacy type map. GREEN pending final verification.
- AC4 File+Blob integration and real Edge browser E2E both reproduced original lossy download (position/data/handles/condition and graph/envelope metadata absent). E2E calls real existing :3000 UI in an isolated browser context; all sidecar HTTP is stubbed, no user DB/secret writes. GREEN pending integrated exporter.
- First full frontend run: 165 passed / 1 failed. Failure in second File+Blob import exposed reused Response body in HTTP test fixture; fixture now creates a fresh Response per request. Reverification pending. No production workaround for test fixture.
- Export TDD evidence: tdd-export.md (owned by FE).

## Scope notes

Final parent regression: 170/170 tests in 38 files; TypeScript clean. Targeted mutation baseline green, 12/12 killed, 0 survived/invalid/timeouts. Import safety GREEN 9/9 with existing engine tests.

QA independently repeated all 170 tests and typecheck successfully. A second browser run exposed a test-fixture bug: WorkspacePicker expected `{projects: []}` but the generic sidecar stub returned `[]`. The Next error overlay did not trigger pageerror. E2E now waits initial network idle, uses explicit method/path response contracts for workspace/providers, rejects unspecified requests, checks Next runtime overlay, and records running/passed/failed state with timestamps. Browser reverification pending; no production workaround applied.

No engine/provider selection redesign. Authoring converter does not inject chat execution defaults. Raw apiKey is deliberately excluded per existing NodeData contract; opaque secretRef is preserved. JSON file UI remains as found; YAML migration remains Sonnet's separate work. Browser comparisons exclude only ReactFlow measured/selected/dragging fields; node/edge data are compared in full. Stored graph.viewport metadata is preserved; this change does not add viewport restoration controls.
