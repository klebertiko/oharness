# Providers audit

Measured against `main` at `b05a750`, before the redesign. Reproduce with:

```bash
cd frontend && npm run build
OUT=<dir> OHM_BROWSER_EXECUTABLE=<chromium> node scripts/audit-providers.mjs   # SHOTS=full for every state at every width
```

The script serves `out/`, stubs every sidecar call with synthetic data (no backend, no key, no account), and walks nine states in Graphite and Ivory at 1280 and 375px (the empty state also at 320 and 768). It runs axe-core (WCAG 2.2 AA and best practices) and records overflow, target heights and rendered font sizes. Captures and `results.json` are in [`providers-before/`](./providers-before) (file names are `providers-<state>.<theme>.<width>.png`).

States walked: `empty` (nothing connected), `connected` (tested live), `key-rejected` (401), `unreachable` (Ollama not running), `model-not-pulled`, `no-models`, `cli-signin`, `testing` (probe never answers) and `sidecar-down` (every call fails). The loading state (before the first answer) is too short to capture with a stub that answers at once; it was read from source.

## What is already good

- axe finds **0 violations** in all 40 captures, both themes. No console errors, no horizontal page scroll at 320, 375, 768 or 1280.
- Credentials never reach the renderer: the list shows labels and health only, the seal shows prefix, a drawn redaction and tail (ADR 0001).
- One status vocabulary: the list, the header and the chat combo read `providerReadiness` and `nextStep`; the failure classes follow ADR 0013.
- Status is a word, not colour alone, and the text forms (`warn-text`, `fault-text`) are used.

## Deviations from the design system

| ID | Finding | Evidence | Rule it breaks |
| --- | --- | --- | --- |
| D1 | **Targets are 28px on desktop and 36px on narrow screens**, never 44px on touch. Every control on the screen is under 44px (7 of 7 at 375px, 6 of 6 at 1280px). | `results.json` `layout.under44` | Brief: touch targets of 44px or more. `experience.md` says 24 and 36, so the system itself is under the bar (see ADR 0033). |
| D2 | **Two status-dot vocabularies on one screen.** The list uses the shell's round `StatusDot` coloured by an inline `style`; the header and facts use a square `ToneDot`. | `shell/ListRow.tsx:18`, `providers/atoms.tsx` | One mark per meaning; no inline colour (`README.md` Visual foundations). |
| D3 | **Off-scale values in the Providers module**: `h-[19px]`, `h-[18px]`, `h-[26px]`, `h-[15px]`, `h-[16px]`, `w-[260px]`, `max-w-[880px]`, `max-w-[420px]`, `tracking-[0.04em]`, `tracking-[0.16em]`, `py-[5px]`, `mt-[2px]` (47 arbitrary values in 5 files, counting the 62ch and 70ch measures). The chip is 19px tall, between `control-sm` (24) and nothing. | `grep -ohE '\b[a-z-]+-\[[^]]+\]' components/providers/*.tsx` | Four-pixel grid and token scale (`README.md` Space). |
| D4 | **A custom `Chip`, `Btn` wrapper, `Block` and `Section` duplicate `Badge`, `Button` and `Panel`.** `Chip` is a button, a span and a toggle in one with its own border and focus rule. | `atoms.tsx` `Chip`, `CredentialSeal.tsx` `Btn`/`Section`, `ModelSection.tsx` `Block` | Reuse `components/ui` (`adoption.md` Wiring). |
| D5 | **Spend strip overflows its container at 1280px.** "Refresh usage" and the cost label collide; the amount is clipped at the right edge of the 216px panel. | `providers-empty.light.1280.png` | No clipped data. |
| D6 | **Raw response text shown to the person**: "Usage may be out of date. {}" when the usage call fails. | `providers-sidecar-down.*` | `README.md` Content: say what happened and what to do next. |
| D7 | **Skeleton and loading states are absent.** Until the first answer the 6 catalogue rows render as "Not connected / Add a key" (the offline template). | `providerStore.ts` `offlineTemplate`, `hydrated` | Loading never shows a false state; layout reserved (`experience.md`). |
| D8 | **Sidecar down is not a state.** When every call fails the screen is identical to a fresh install: six "Not connected" rows and a primary "Paste an OpenRouter key", with no sign the app cannot reach its sidecar. | `providers-sidecar-down.*.png` | Honest and reversible: never a dead end, say what is true. |
| D9 | **Copy is English only** and keeps its Portuguese out by a guardrail test; the brief asks for pt-BR and en. The app has no i18n layer at all. | `design-system/guardrails.test.ts` "keeps the interface in English" | Brief (see ADR 0034). |
| D10 | **A personal e-mail address sits in the offline template and one test** (`providerStore.ts` seed detail and facts, `providerStore.runOutcome.test.ts`). It never renders (the template is neutralised) but it ships in the bundle. | `grep -rn '@' components/providers` | Repo rule: no personal e-mail in any file. |
| D11 | **Typography is within the scale but dense**: 12px body in 27 nodes, 13px in 12, 11px in 21 on the first screen, with `t-meta` (11px) carrying sentences, not just machine data. | `layout.fontSizes` | `t-meta` is for machine data (`README.md` Content). |

## UX problems

| ID | Problem | Why it matters |
| --- | --- | --- |
| U1 | **Nine blocks of equal weight** stack in the detail: Credential, five facts, caveat, summary, Endpoint, Usage, Account, Models. Nothing says which one to read first except the header button. | A Curated Library asks for "stronger hierarchy, fewer controls". |
| U2 | **The same fact is said three times.** "Not connected" in the list, the header status word, the detail line, the Credential chip ("not set"), and the Reachability fact ("never reached / not yet tested"). | Noise hides the one thing to do. |
| U3 | **Jargon in the spec sheet**: "Answers to: completion · embedding", "LLM nodes may target it", "Billed as: seat". | Says what the system calls it, not what the person gets. |
| U4 | **The primary button and the field are two controls for one action.** "Paste an OpenRouter key" scrolls to a field further down, then "Store" is a second primary. Two primaries in one viewport. | One primary per view; the action should be where the work is. |
| U5 | **The model list is last, below the fold at 1280×860, and unsearchable.** It renders every id in a 260px scroller; with OpenRouter that is hundreds. ADR 0015 chose a searched, capped list for the chat combo but the screen where the model is chosen does not use it. | Choosing a model is the second most common task. |
| U6 | **On phones the list does not exist.** The left panel is hidden below 640px and replaced by a combobox switcher that reads "OpenRouter — Not c…" (truncated). Seeing which connections need attention takes opening a popup. | The sibling that matters most on a narrow screen (which one needs action) is hidden. |
| U7 | **The panel title "Providers" repeats three times** (rail, header strip, left panel head). The left panel also carries the global Spend strip, which is not about any connection. | Wasted vertical space in a 216px column. |
| U8 | **"Ready" holds untested connections** whose row says "Not verified". A person scanning for what works cannot tell tested from merely switched on. | Status must be one word with one meaning. |
| U9 | **Opens on OpenRouter**, not on the connection that needs action or the first one (`adoption.md`, open item 4). | A fresh install lands on an arbitrary vendor. |
| U10 | **Destructive action has no confirmation or undo**: "Remove" on a sealed key deletes it at once. | `experience.md`: destructive actions are undoable or confirmed. |
| U11 | **Header context collides at 320px**: "Providers" touches the search icon in the title strip (a shell defect surfaced here; not changed by this work). | Layout at the smallest width. |

## Reference points

Linear's settings put one status line and one action per integration, with the detail one level down; Raycast's extension preferences keep the credential field in the header card of the extension until it is set; Cursor and Zed show models as a searchable list with the default marked, never as a tall unsearched table. The redesign follows those three habits inside the Curated Library layout already named in `README.md` (see ADR 0035 for the layout decision).

## Limits of this audit

- Captures use a stubbed sidecar and the static export, in headless Chromium on Linux. Font rendering and pixel values may differ slightly from the Tauri webviews on macOS and Windows.
- The sandbox has no internet and no real provider account, so no real `GET /models` list, no real 401 and no real Ollama were exercised; every fault is a synthetic `detail` that matches an ADR 0013 pattern.
- Keyboard and reduced-motion behaviour were read from source and checked in the e2e added later in this work, not in this baseline.

## After the redesign

Same script, same nine states, same fixtures, against the screen of ADR 0035 (captures in [`providers-after/`](./providers-after), measurements in its `results.json`). All 40 captures are kept so the audit can be compared state by state: every state in both themes at 1280 and 375, and `providers-empty` also at 320 and 768.

| Measure | Before | After |
| --- | --- | --- |
| axe violations (40 captures, both themes) | 0 | 0 |
| Horizontal page scroll at 320, 375, 768, 1280 | none | none |
| Controls under 44px with a touch pointer (`pointer: coarse`) | all (7 of 7 at 375px) | 0, from the emulated-touch run in `e2e-providers.mjs`; `results.json` counts with a mouse pointer, so its `under44` is not this figure |
| Primary buttons in view | up to 2 (header button and Store) | at most 1, in every state tested |
| Status marks | 2 shapes (round shell dot, square tone dot) | 1 (`StatusMark`, 8px square) |
| Arbitrary Tailwind values in the new screen files (`ConnectionDetail`, `ConnectionPanel`, `ModelsPanel`, `ProvidersScreen`, `rows`) | 47 in 5 files | 15 in 5 files: 14 layout measures (reading width, pane width, column grid) and the drawn key redaction stripe in `ConnectionPanel.tsx` |
| Languages | en | en and pt-BR |
| Sidecar down | indistinguishable from a fresh install | its own notice, Retry, rows say "Can't check" |
| Loading | rows shown as "Not connected" | skeleton at row height |
| Model list | all ids in a 260px scroller, no search | filter, capped at 8 (25 with a filter), default marked, Use per row |

How each finding was answered:

| ID | Answer |
| --- | --- |
| D1 | `control-touch` (ADR 0033); verified with emulated touch in `e2e-providers.mjs`. |
| D2, D4 | `StatusMark`, `Badge`-style `Panel`, `Button`, `Input`, `Notice`, `ConfirmInline`; `Chip`, `Btn`, `Block`, `Section` are no longer used by the screen (`Chip` stays for the dev-only run binding). |
| D3 | The screen's remaining arbitrary values are layout measures. `RunBinding.tsx` (dev route only) still has its old ones. |
| D5, D6 | The spend card sits under the list, one line, with its own budget error; no raw backend text. |
| D7, D8 | `providerStore.loadState`; skeleton and offline states. |
| D9 | ADR 0034, `src/i18n`. |
| D10 | Removed in the foundation PR. |
| D11 | Sentences in the body face; `t-meta` only for ids, keys, commands, model names, latencies. |
| U1 to U3 | One header with one status word and one action, four panels, plain words for where it runs and how it bills. |
| U4 | When a key is missing the key field is the action. |
| U5 | Models panel with filter and Use, second after Connection. |
| U6, U7 | The list is a pane of its own, and the screen on a narrow stage. |
| U8 | Status words come from `providerReadiness` and `nextStep`; "Needs action" is the first group. |
| U9 | The screen opens the connection nearest to answering. |
| U10 | Inline confirmation, Cancel first. |
| U11 | Not changed: it belongs to the shell title bar. |

Still open: the shell title bar collision at 320px (U11); the rest of the app is not translated (ADR 0034); a real device for the touch check and a native speaker for the pt-BR copy.
