# STUDIO-CLARITY — truthful provider selection and navigable Studio

Status: In Progress. Planning estimate: 8 points.

Authority: user screenshot C:/Users/klebe/Pictures/Screenshots/Captura de tela 2026-09-13 031143.png; request to fix unclear setup/Auto/green-dot behavior, polish Studio, verify origins of both starter examples, allow returning from an open graph, and leave Sonnet a handoff outside the repo. Traycer, LangGraph/LangSmith Studio and n8n are reference products, not a request to copy all their capabilities.

## Acceptance criteria and public seams

1. Chat provider selection and connection health are distinct. A selected or enabled-but-unverified connection must not appear verified solely because selected. Auto explains which eligible provider resolves, or why none can run. Preserve backend enabled authority; do not force a new connection test on every browser reload. Seams: chatProvider helpers + rendered ChatProviderPicker; tests at helper and component interfaces.
2. Provider choices, unavailable states and configure actions are clear and keyboard accessible. No ambiguous raw setup/first connected labels. Configuration must not silently change the chosen provider or imply a successful connection. Seams: ChatProviderPicker interactions; appropriate store observations only as product behavior.
3. Studio has an explicit overview/editor navigation. User can open a starter, return to overview, and resume the same draft without losing graph/data/name. Edit in Studio and importing an OHM still open the editor. Seams: shell navigation actions, Studio overview/editor interaction, HarnessBar; regression/component tests plus real browser flow.
4. Both starter origins are verified against current source. UI distinguishes a frontend sample from a bundled skills-framework-derived OHM; no claim of full framework execution equivalence or live source synchronization. Opening the framework entry must load the actual default bundle rather than a similarly named frontend sketch. Loading/error states are visible, and failures preserve the existing draft. Seams: starter loading action and overview interaction against explicit bundle fixtures; provenance recorded in external handoff.
5. Different agents can retain different provider bindings and the chat default remains a fallback for unpinned agents. Keep current engine/export contracts. Show the precedence in the existing inspector where useful; regression tests must cover two different agent pins. No fabricated provider/engine capability or new backend orchestration in this slice.

6. Use in chat applies current canvas edits, independent provider pins and OHM content to the active chat bundle without sending a message. A library import with the default manifest ID opens the uploaded content rather than substituting the bundled entry. Editing from the library does not implicitly enable chat harness mode. Seams: Studio action + library callback; regression tests and browser request capture.

## Definition of Done

- Baseline then observed RED/GREEN per behavior slice, recorded in ledger.
- Full frontend regression and typecheck pass. Existing OHM fidelity work retained.
- Browser checks on existing port3000 with isolated context, actual UI interactions and explicit API contracts; provider selected vs status, configure, overview/open/back/resume, and per-agent selection. Disclose any API stubs. Check relevant widths and keyboard behavior; report existing desktop layout limits honestly.
- Fresh QA and SEC gates, architecture review; no invented scores or coverage percentages.
- External handoff D:/Development/handoffs/2026-09-13-oharness-studio-clarity-sonnet.md includes exact provenance, changes, tests, reference URLs and any remaining runtime limitations.
- No commit/merge, no backend edits, no server restart/kill, no overwriting Sonnet's concurrent changes.

## Ownership

FE subagent: ChatProviderPicker.tsx, chatProvider.ts and their tests; provider-binding section of PropertiesPanel.tsx and a dedicated test if needed; minimal AgentStage onConnect callback only if configuration navigation needs it. Parent: Studio overview/navigation, shellStore, app/page, HarnessBar, provenance research, browser tests, ledger and handoff. Independent reviewers own only evidence reports.

Stop-the-Line: PASS — explicit AC, DoD, estimated points and seams recorded; user authorized these public interaction fixes and their regression verification.
