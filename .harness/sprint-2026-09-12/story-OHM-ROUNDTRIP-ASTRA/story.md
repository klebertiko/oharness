# OHM-ROUNDTRIP-ASTRA — Studio authoring roundtrip

Source of authority: D:/Development/handoffs/2026-09-12-oharness-ohm-roundtrip-astra.md and the user's request to complete it with TDD, E2E, mutation and regression tests.

## Scope and ownership

Story points: 5 (planning estimate).

Frontend OHM export/import fidelity only. Sonnet owns backend persistence, cycles, edge conditions and triage/mutmut. Do not edit those files, start another server on port 3000, commit or merge. JSON/YAML UI migration is outside this slice.

## Acceptance criteria and agreed seams

1. Export retains node type, position and complete authoring data including Providers, prompts, role and extension fields. Seam: canvasNodeToBundleNode / composeBundleFromCanvas; tests in bundlesApi.test.ts.
2. Export retains edge data.condition (string), Signals and handles. Seam: canvasEdgeToBundleEdge / composeBundleFromCanvas; tests in bundlesApi.test.ts.
3. Import restores authoring fields without replacing custom positions, provider pins or conditions. Legacy role/label bundles still import. Seam: bundle graph conversion and ValidateDock file import; tests in bundleGraph.test.ts and ValidateDock roundtrip tests.
4. A literal independently authored fixture survives Studio export → file import → export with equal authoring objects, and unchanged multiline strings. Seam: UI import/download and graph composition. E2E must compare file content, not only screenshots.

Do not persist deprecated raw data.apiKey (types.ts explicitly prohibits persistence); preserve secretRef instead and cover the existing security boundary. Runtime execution defaults and user instructions must not rewrite imported authoring data.

## Definition of Done

- RED/GREEN evidence per slice; targeted regression and full frontend suite/typecheck results recorded.
- Browser E2E uses an isolated browser context and actual UI/file download/upload; any API stubs and verification limits documented.
- Mutation testing runs in an isolated copy, records actual killed/survived/invalid outcomes, never mutates the shared source checkout.
- Independent QA and SEC review; no self-review assertion, no fabricated coverage or mutation scores.
- Handoff/evidence delivered to Sonnet and human; changes remain uncommitted for HITL.

Stop-the-Line: PASS — numbered AC, seams and DoD derived from the explicit handoff and user's testing requirements. No additional approval needed to implement this scope.
