# Component and pattern audit

Measured on 2026-10-29 against `main` at `b05a750` (after the roadmap: #89, #90 and the run, queue, diff and subagent work). `audit/screens.md` records the redesign of the screens; this file records what the product has become since, set against what the design system documents. Reproduce the counts with `git grep` as shown in each table, test files and `src/app/dev` excluded.

The Providers screen is being rebuilt in parallel (ADRs 0033 to 0036). Its files are listed as *out of scope* and are neither measured nor changed here; the Providers section is written in `components/providers.md` after the first of those pull requests is on `main`.

## What the design system documented before this change

`tokens.json`, `README.md` (brand book), `experience.md`, `brand.md`, `adoption.md`, and seven reference components (`reference/`: Button, Input, Badge, Panel, ListRow, Kbd, Nilo). The app's `ui/` folder also has Notice, EmptyState, Skeleton, Segmented, Sheet and Combobox, which `adoption.md` names in one sentence and nothing else describes.

## Inventory: what is in the app

"Docs" is where the component or pattern is described by the next pull request in this series (`components/`): `P` = `components/primitives.md`, `M` = `components/model-picker.md`, `C` = `components/composer.md`, `R` = `components/run-surfaces.md`, `S` = `components/studio.md`, `H` = `components/shell.md`, `X` = `components/patterns.md`, `V` = `components/providers.md`. "Before" is what documented it at the start.

### Primitives (`components/ui/`)

| Component | Where | Before | Docs |
| --- | --- | --- | --- |
| Button | `ui/Button.tsx` | reference + README | P |
| Input | `ui/Input.tsx` | reference + README | P |
| Badge | `ui/Badge.tsx` | reference + README | P |
| Kbd, KbdChord | `ui/Kbd.tsx` | reference + README | P |
| Panel (ui) | `ui/Panel.tsx` | reference + README | P |
| ListRow (ui) | `ui/ListRow.tsx` | reference + README | P |
| Notice | `ui/Notice.tsx` | none | P |
| EmptyState | `ui/EmptyState.tsx` | none | P, X |
| Skeleton, SkeletonRows | `ui/Skeleton.tsx` | `experience.md` rule only | P, X |
| Segmented | `ui/Segmented.tsx` | none | P |
| Sheet | `ui/Sheet.tsx` | `experience.md` rule only | P |
| Combobox | `ui/Combobox.tsx` | design.md paragraph | M |

### Chat

| Component or pattern | Where | Decision | Before | Docs |
| --- | --- | --- | --- | --- |
| Model combo grouped by connection, with search | `agent/ChatProviderPicker`, `agent/chatCombo.ts` | ADR 0015 | none | M |
| `{connection} · {model}` chip | `agent/ChatProviderPicker` | ADR 0014, 0015 | none | M |
| "Needs action" group and the composer call to action | `chatCombo.ts`, `agent/AgentStage` | ADR 0016 | none | M, C |
| Connection states (ready, checking, failing, unconfigured) and "Model not pulled" | `ChatProviderPicker` `tone`, `modelNotPulled.test.ts` | ADR 0013 | none | M |
| Per-chat model scope | `ChatProviderPicker`, `chatProvider.ts` | ADR 0014 | none | M |
| Composer with permission preset and Plan mode | `agent/ChatComposer` | ADR 0021, 0022 | none | C |
| Message queue | `agent/QueuedMessages` | ADR 0023 | none | C |
| Harness switch in the composer | `agent/HarnessSwitch`, `HarnessBar` | ADR 0011, 0012 | design.md line | C |
| Workspace chip | `agent/WorkspacePicker` | | none | C |
| Subagents toggle | `agent/SubagentToggle` | ADR 0027 | none | C |
| Pre-tool hooks sheet | `agent/ToolHooksSheet` | ADR 0026 | none | C |
| Plan artifact card | `agent/PlanArtifactCard` | ADR 0022 | none | C |
| Message actions (copy, reuse) | `agent/MessageActions` | | none | C |
| Threads sidebar | `agent/ThreadsSidebar` | | none | H |

### Runs

| Component or pattern | Where | Decision | Before | Docs |
| --- | --- | --- | --- | --- |
| Transcript with role markers, activity roll-up and latency table | `agent-run/Transcript`, `rollup.ts`, `activity.ts` | | none | R |
| Tool card with approval, risk and truncation | `agent-run/ToolCard` | ADR 0021 | none | R |
| Human gate | `agent-run/Gate` | | none | R |
| Transport bar and run ladder | `agent-run/RunControls`, `RunLadder` | | none | R |
| Token ceiling field | `agent-run/RunBudgetField` | ADR 0025 | none | C, R |
| Runs panel, resume and fork, saved-run detail | `agent-run/RunsPanel`, `HistoricalRunDetail`, `RunEvidence`, `RunDetailToggle` | ADR 0017, 0018 | none | R |
| Subagent tree with per-child cancel | `agent-run/SubagentTree` | ADR 0027 | none | R |
| Turn diff with per-file revert | `agent-run/TurnDiffPanel` | ADR 0024 | none | R |
| Thinking status (Nilo, verb, elapsed, tokens) | `brand/ThinkingStatus` | | `brand.md` | R |

### Studio

| Component or pattern | Where | Decision | Before | Docs |
| --- | --- | --- | --- | --- |
| Overview with scroll rail | `studio/StudioOverview`, `ScrollRail` | | README layout line | S |
| Actions bar and run bar | `studio/StudioActionsBar`, `toolbar/Toolbar` | | none | S |
| Canvas, node plate, wires, viewport dock | `canvas/*` | ADR 0007 | roles in README | S |
| Graph audit strip and ValidateDock | `canvas/GraphAudit`, `studio/ValidateDock` | | none | S |
| Inspector and field assist | `sidebar/PropertiesPanel`, `FieldAssist`, `NodePalette` | | none | S |
| Studio assistant (agentic) with proposal card | `copilot/*` | ADR 0009, 0010 | none | S |
| Harness library sheet | `harnesses/HarnessLibrary`, `shell/HarnessLibrarySheet` | | none | S |
| Cowork project panel | `cowork/CoworkPanel` | | none | S |

### Shell

| Component or pattern | Where | Before | Docs |
| --- | --- | --- | --- |
| Title bar, rail, status bar, split handle | `shell/*` | README layout line | H |
| Command palette, keymap sheet | `shell/CommandPalette`, `KeymapSheet` | `experience.md` rule | H |
| Shell panel and list row (second implementations) | `shell/Panel`, `shell/ListRow` | none | H, finding D6 |
| Nilo and the mark | `brand/*`, `shell/Mark` | `brand.md` + reference | `brand.md`, reference |

### Out of scope here (Providers rebuild)

`providers/*` (ProvidersList, Dossier, ModelPicker, ModelSection, Wallet, RunBinding, CredentialSeal, atoms) and `app/dev/providers`. Documented in `components/providers.md` after the first rebuild pull request merges.

## Deviations

Counts are for the files in scope (everything except `providers/`, tests and `app/dev`). *Fixed* means changed in this pull request with no change of behaviour or pixels; *Documented* means left on purpose and the reason is stated.

| ID | Finding | Before | After | Action |
| --- | --- | --- | --- | --- |
| D1 | Arbitrary pixel dimensions that equal a step of the 4px scale (`h-[22px]`, `py-[4px]`, `w-[2px]`, `min-w-[18px]` and similar) | 53 | 27 | **Fixed**: every even pixel value (a half step of the 4px grid) replaced with the scale class that computes to the same size (`h-5.5`, `py-1`, `w-0.5`, `top-2.5`). Identical at the default 16px root; like the `px-2` and `gap-2` classes the app already uses, they are rem-based and follow a changed root font size, which the Tauri WebView does not do. Odd values (3, 5, 7, 9 and 11px) are not on a half step and stay (D4). A guardrail now forbids new even ones outside `providers/`, which is being rebuilt. |
| D2 | The selected-row mark written out as `shadow-[inset_2px_0_0_var(--signal)]` in four components | 4 | 0 | **Fixed**: new token `edge-selected` (`--edge-selected`, `shadow-selected`). The one new token in this series; see ADR 0037. |
| D3 | Transition times written as literals in CSS modules (`110ms`, `cubic-bezier(0.2, 0, 0, 1)`) | 4 | 0 | **Fixed**: `var(--duration-fast)` and `var(--ease-standard)`, the same values. The 620ms dash march of a live wire is an animation with no token; it stays and is allow-listed in the guardrail. |
| D4 | Odd marker and node-plate dimensions (`h-[9px]` role diamonds, `5px` and `7px` status dots, `11px` node padding, `-5px` selection corners, `3px` node accent bar) | 28 | 28 | **Documented**: markers are 5, 7 and 9px by design (a square or dot beside a name, `README.md` § Roles); node-plate internals are tuned to React Flow handles. They are listed in `components/studio.md` and `components/run-surfaces.md` as the marker scale. |
| D5 | Reading and content measures in `ch` and `px` (`56ch`, `60ch`, `62ch` ×6, `68ch` ×4, `70ch` ×3, and five `px` page widths from 560 to 1040) | 20 | 20 | **Documented**: the conversation column is 60 to 68ch per `experience.md`; 62 and 70 are drift of at most 2ch from that range. Not unified here: moving the measure changes line breaks, which belongs in a visual-change pull request with before and after captures. |
| D6 | Two implementations of Panel and ListRow: `shell/Panel`, `shell/ListRow` (used by Harnesses, Runs, Threads, Studio panels) and `ui/Panel`, `ui/ListRow` (the specified ones) | 2 pairs | 2 pairs | **Documented**: the shell versions have a different API (30 to 32px head with a mono meta; a `StatusDot` and hover actions). Merging them changes markup and tests, so it is a follow-up. `components/primitives.md` states which to use for new work: `ui/`. |
| D7 | Inline `style={{ color: "var(--warn-text)" }}`-style props that already point at tokens (`Transcript`, `ToolCard`, `Gate`, `RunControls`) | 59 (30 point at a `var(--…)`) | 59 | **Documented**: values are tokens, so they cannot drift. They exist because the colour is chosen at run time from a state map. Prefer a class when the state set is static. |
| D8 | Shadows other than `shadow-soft`, `shadow-float` and `shadow-selected` | 6 | 6 | **Documented**: five are inset edges or rings of 1 to 2px (`inset 0 1px 0` on `ui/Panel`, `shell/Panel` and the status bar, `inset 0 -2px 0` under the active Studio tab, the 1px edge-handle ring in `globals.css`) and one is the canvas focus halo `0 0 0 3px` in `canvas.module.css`. None adds elevation. |
| D9 | `maskColor="rgb(0 0 0 / 0.58)"` on the React Flow minimap | 1 | 1 | **Documented**: the only raw colour outside `globals.css`. It is a different alpha from `overlay-backdrop` (0.42), so swapping it would change the pixels. Candidate for the visual-change pull request that retunes overlays. |
| D10 | `uppercase` on two one-word markers (the `HIGH` risk chip on a tool call and the wire label) | 2 | 2 | **Documented**: allowed by the content rule (one word); neither uses the `t-label` role. Use `t-label` for new ones. |
| D11 | Copy in the product is English only; pt-BR exists in the release notes and the site | | | **Documented**: the guardrail test keeps the interface free of accented strings. Component docs give pt-BR next to each string as the translation reference for when a locale ships (`components/patterns.md` § i18n). |
| D12 | A text field edged with the hairline `border-line` (1.6:1) instead of the control edge: the token-ceiling input under the composer (on `sub-100`, where `line-strong` measures 3.5:1 in Graphite and 3.8:1 in Ivory) | 1 | 0 | **Fixed**: `border-line-strong`, the edge every other field uses (3:1 or better on `sub-000` to `sub-200`). The only visible change in this series, a darker 1px edge on one field. The existing guardrail missed it because the element spans several lines; it now matches across lines. |

## Guardrails added

`frontend/src/design-system/guardrails.test.ts` now also fails on a literal `<input>`, `<textarea>` or `<select>` edged with `border-line` or `border-line-soft` (across lines; a field styled through a shared class string or the `Input` wrapper is not seen), on an ad hoc `shadow-[inset_2px_0_0` (use `shadow-selected`), on a literal time or `cubic-bezier` in a stylesheet `transition`, and on an even arbitrary pixel value for spacing or size. The parity test checks the new `edge-selected` variable in both directions.

## Checks run

`npm run typecheck`, `npm run lint`, `npx vitest run` (160 files, 1278 tests) and `npm run build` from `frontend/`, and `node scripts/design-tokens.mjs --check` and `node scripts/check-contrast.mjs` from the root. The contrast table is unchanged: `edge-selected` is an existing `signal` on a `sub-200` fill, a pair already required at 3:1.
