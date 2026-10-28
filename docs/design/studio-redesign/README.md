# Studio creation redesign — audit, locked spec, phase-2 slices

Phase 1 of 2 (design only). Nothing here is production code. The prototype is
`index.html` in this folder (open it in a browser, use the dashed "PROTOTYPE" switcher
at the top to move between states). Audit screenshots are in `audit/`, prototype
screenshots are `proto-*.jpeg`.

- **Audited build:** `origin/main` @ `e898434`, frontend dev server on :1420 (a CORS-allowed
  origin) against a running sidecar, 1440×900, dark theme, no chat provider connected.
- **Assistant name:** the in-app assistant is **Nilo** (the owl). The current build still
  labels it with a third-party brand name in the editor button, side tab, overview CTA
  and panel heading; that is finding A10 and slice S0.
- **Given, not redesigned:** document actions (save / save as / discard / delete draft /
  import / export / example picker) from `feat/studio-harness-actions`. This spec only
  says *where* that toolbar lives (header, right of the name).

---

## 1. Audit (ranked)

Hallmark audit format: tell · where · severity · fix. 4 critical · 6 major · 2 minor.

### Critical

| # | Tell | Where | Fix |
|---|---|---|---|
| A1 | **"You review every change" is false.** The assistant's proposal is applied to the canvas *before* review (`copilotStore.ts:129` calls `applyGraphPatch` on receipt). The card then offers "Keep / Undo". The new nodes landed **off-screen** with no camera move, so the user approves a list of strings they can't see. | `audit/05-assistant-proposal.jpeg` vs `audit/06-after-fit.jpeg`; `store/copilotStore.ts`, `ProposalCard.tsx` | Proposals render as a **ghost layer** (dashed, "proposed") and nothing is applied until Apply. Auto-frame the proposal. Per-change toggles. Enter applies, Esc discards. |
| A2 | **Manual and agentic creation live in four corners.** Blocks on the left, the assistant behind a header button in a 264 px right tab that shares space with the Inspector, Validate/Import at the bottom, graph audit floating top-right. The overview's describe box, the best entry point, **disappears** once you're in the editor. | `audit/02-new-empty-editor.png`, `audit/04-…`; `app/page.tsx:288-302`, `StudioSidePanel.tsx` | One **composer** docked bottom-centre of the canvas, always present: plain language → Nilo proposal, `/` → block search. The overview hands off to the same composer. |
| A3 | **Five stacked bars of chrome**: title bar (name input), toolbar (Run/Mock/undo/save/export/import), editor bar (Back + name **again** + 2 buttons), bundle dock, status bar. About 190 px of 900 px, with the name shown twice and export/import shown twice under two different formats ("graph JSON (advanced)" vs ".ohm"). | `audit/02-…`; `page.tsx:288-338`, `Toolbar`, `ValidateDock.tsx:86-91` | **One 48 px header**: breadcrumb `Studio / name ● saved-state` · document actions (studio-actions) · Readiness pill · Run split button. Bundle dock removed. Status bar hidden in the editor. |
| A4 | **Run is armed on a broken graph.** With 3 structural faults showing ("never reached", "dead end"), Run is the brightest control on screen. Validation is split three ways: the GraphAudit overlay (clickable), ValidateDock (a flat string list, no node links), and nothing on the node or in the Inspector. | `audit/03-two-nodes-added.jpeg`; `GraphAudit.tsx`, `ValidateDock.tsx` | One **readiness model**: a header pill ("Ready" / "1 thing needed" / "2 problems") that opens a **Problems** tab. Every problem links to node + field. Run stays clickable but runs the check first and explains instead of failing late. |

### Major

| # | Tell | Where | Fix |
|---|---|---|---|
| A5 | **Adding a block never connects it.** Click-to-add stacks blocks at a fixed cascade offset. There's no drop-wire-on-empty-space search, no double-click search, no port "+", and no `isValidConnection` reason. Grep on main confirms `onConnectEnd` and `isValidConnection` are still absent. | `audit/03-…`; `NodePalette.tsx`, `HarnessCanvas.tsx` | Click-add inserts **after the selection and wires it**. Quick-add search on double-click, on wire drop and from a port "+" (React Flow's add-node-on-edge-drop pattern). Rejected connections say why at the cursor. |
| A6 | **The camera fights the user.** Adding 2 blocks auto-zooms to 175 % (mono labels about 20 px). Fit view after the proposal drops to 76 % (body text about 8 px). | `audit/03-…`, `audit/06-…`; `HarnessCanvas.tsx:89-114` | Clamp auto-fit to 85–125 % for ≤ 12 nodes. Below 60 %, use a semantic zoom with compact plates (name + kind only). Never auto-zoom on a manual add; pan to keep the new block in view instead. |
| A7 | **The empty canvas is a single muted sentence** ("Add a node from the palette, or import an OHM file below"). The strongest path, describing it, isn't offered there. | `audit/02-…`; `page.tsx:300` | The empty canvas **is** the composer, centred, with "or + Agent block · Open an example · Import .ohm" beneath. Once a node exists, it docks to the bottom. |
| A8 | **Machine strings shown to people.** Raw UUID in the Inspector header and status bar (`sel gate-7cf3a9ec-…`), `2n · 0e`, `1 in · 1 out`, `AGT`, truncated `Mcp...`, placeholder `stl, qa, arch, sec…`. | `audit/03-…`; `StatusBar.tsx`, `PropertiesPanel.tsx`, `BaseNode.tsx` | Human labels ("Human review", "MCP server"). One-line purpose per block. Ports and id go behind an "Advanced" disclosure with "Copy id". |
| A9 | **The no-provider state is a dead end.** The send button text is clipped ("Connect a provider to…"). "Use offline draft" sits at the top of the panel, far from the composer. Suggestion chips stay after use. | `audit/04-assistant-no-provider.jpeg`; `CopilotPanel.tsx`, `ProviderLine.tsx` | The composer footer shows *which* provider Nilo uses. With none, the primary button becomes "Draft offline" in place, with "Connect provider" as a quiet link. Chips vanish after first use. |
| A10 | **Third-party brand name on the assistant.** Product rule: the assistant is Nilo. | overview CTA, editor header button, side tab, panel heading, Field Assist | Rename every visible string to Nilo ("Ask Nilo", "Nilo proposes…"). Put Nilo's face (`NILO_FACE`, `--nilo-*` tokens) on every assistant surface. |

### Minor

| # | Tell | Where | Fix |
|---|---|---|---|
| A11 | Field Assist is a tiny per-field link offering three unexplained verbs (Draft / Improve / Review). | `FieldAssist.tsx:232-252` | A single "Ask Nilo" per field returns an inline **ghost suggestion**: "Use this" (one undo step) or Discard. "Review" moves into the suggestion as notes. |
| A12 | The offline draft wires `Gate.pass → Researcher` and leaves the user's existing Agent unwired, so the result reads as arbitrary. | `05-…` | Proposals anchor on the selection or on graph sinks. The review list states the anchor ("after Writer"). |

What already works (keep it): the overview's describe-first hierarchy (`01-overview.png`), the named-port model and orthogonal wires, GraphAudit's click-to-reveal chips, the 50-step undo, and the KeymapSheet.

---

## 2. References (primary sources only)

| Pattern taken | Source |
|---|---|
| Empty workflow shows one "Add first step" action; the nodes panel is search-first | n8n — https://docs.n8n.io/workflows/components/nodes/ |
| `N` opens the nodes panel, `Ctrl+Enter` runs, `1` fits, arrows move between neighbours, Command Bar has tidy-up | n8n — https://docs.n8n.io/keyboard-shortcuts/ |
| Describe → watch the build → review → refine by prompt; the builder lists remaining manual steps (credentials, params) | n8n AI Workflow Builder — https://docs.n8n.io/advanced-ai/ai-workflow-builder/ , https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder |
| Double-click the canvas opens node search | ComfyUI — https://docs.comfy.org/interface/shortcuts |
| Drop a connection on the pane to create and connect a node (`onConnectStart`/`onConnectEnd`) | React Flow (our lib) — https://reactflow.dev/examples/nodes/add-node-on-edge-drop |
| Graph mode vs simpler chat mode, thread management | LangSmith/LangGraph Studio — https://docs.langchain.com/langsmith/studio |
| Every flow begins at an explicit Start node that declares trigger and state | Flowise Agentflow V2 — https://docs.flowiseai.com/using-flowise/agentflowv2 |
| Plain-language refine with real-time progress; changes can go to a PR for review | v0 — https://v0.app/docs/introduction |
| Plugin-everything harness with a local web UI; desktop builds reported, not verified on DeepSeek's own site | DeepSeek Harness — https://github.com/deepseek-ai/deepseek-harness (claim of an official desktop app, 2026-10-07: https://tech-ish.com/2026/10/07/deepseeks-ai-agent-now-installs-like-a-normal-app-on-mac-and-windows/) |

Not verified from a primary source and therefore **not** used as evidence: Dify's
add-node affordances (the docs pages fetched didn't cover them), Figma's and Linear's
creation patterns.

---

## 3. Locked spec

### 3.1 Information architecture

```
Studio
├── Library (today's overview — kept): describe box · Your harnesses · Starting points
│     └─ describe → Editor with the SAME text already proposed (composer hand-off)
└── Editor
      ├── Header (48px)  Studio / <name> ● <save state> · [document actions] · (Readiness) · [Run ▾]
      ├── Blocks (left, 200px, collapsible Ctrl+B)   search-first, human labels + one-line purpose
      ├── Canvas
      │     ├── empty → centred composer + "or" row
      │     ├── composer (docked bottom-centre) ⇄ review bar (while a proposal is pending) ⇄ run bar (while running)
      │     └── toast layer (top-centre): "Applied 4 changes · Undo"
      └── Side (right, 320px, resizable 280–460)   tabs: Inspector · Nilo · Problems
            hidden when the canvas is empty and nothing is selected
```

The editor bar ("Back to Studio" / name / Ask / Use in chat), the bundle dock and the
editor status bar are **removed**. "Back" becomes the breadcrumb. "Use in chat" moves into
the Run split menu ("Run in chat"). Validate is implicit and continuous: structure is
checked on every edit, the bundle on save and before Run. Import/Export live only in the
studio-actions document menu.

### 3.2 The unified creation flow (manual + Nilo, one loop)

1. **Start.** From the Library describe box, the empty-canvas composer, an example or
   import. All four land in the same editor state.
2. **Ask or add, from one field.** The composer accepts plain language (→ Nilo proposal)
   or `/` (→ block search listbox). With a block selected, both act *after the selection*:
   Nilo anchors there, and a picked block is inserted and wired to it.
3. **Review on the canvas, never in a list alone.** A proposal renders as dashed ghost
   nodes and wires marked "proposed". The camera frames them. The review bar replaces the
   composer and lists each change with a checkbox, a counted **Apply N changes (↵)**,
   **Discard (Esc)** and **Refine…**. Unchecking a change dims its ghost live. Nothing
   touches the document until Apply, and Apply is one undo step.
4. **Configure.** Selecting a node shows the Inspector with a **"Before this can run"**
   box listing missing fields with jump links. Each free-text field has **Ask Nilo**,
   which returns an inline ghost suggestion (Use this / Discard).
5. **Check.** The Readiness pill is always truthful: *Nothing to check yet* (grey) ·
   *Ready to run* (signal) · *N things needed* (warn) · *N problems* (fault) · *Checking…*
   (pulse). Clicking it opens Problems. Each row selects the node and focuses the field.
6. **Run.** Run ▾ = Mock (default) / Connected / Run in chat. While running, the composer
   becomes a run bar (step · elapsed · Stop), the canvas is read-only, wires animate, and
   "Editing is paused" is said in words.

Manual quick-add paths (all open the same search listbox, filtered to *compatible*
blocks when started from a port): double-click empty canvas · drop a wire on empty space
· hover a node's output → "+" · `N` / `Tab` · `/` in the composer · click or drag in
Blocks. A rejected connection shows the reason at the cursor ("Gate · fail only connects
to a signal input").

### 3.3 States

| State | Header | Canvas | Composer slot | Side |
|---|---|---|---|---|
| Empty | `Untitled harness` · "New · not saved yet" · pill grey | dotted grid only | centred composer + "or" row | hidden |
| Draft (unsaved new) | dot ● warn · "Unsaved · autosaves in 2s" | nodes | docked composer | Inspector if selected |
| Saved | "Saved on this device" | — | — | — |
| Proposal pending | pill "Checking proposal…" · Run disabled ("Review the proposal first") | ghosts + auto-frame | **review bar** (focus moves to Apply) | Nilo tab, thread shows "waiting for your review" |
| Nilo working | — | skeleton ghost at the anchor | composer shows "Nilo is drafting · 4s · Cancel" | — |
| No provider for Nilo | — | — | primary button "Draft offline", quiet "Connect provider" | — |
| Validating | pill pulse "Checking…" | — | — | — |
| Error / problems | pill fault "2 problems" | affected nodes get a warn/fault edge + one-line need | — | Problems tab |
| Running | pill "Running" · Run → "Running…" | read-only, live wires, running plate strip | **run bar** (Stop / Esc) | Inspector shows live output |
| Engine unreachable | pill fault "Engine offline · Retry" | editable (local) | Nilo disabled with reason | — |

### 3.4 Keyboard & DX

`Ctrl K` command palette (all actions) · `/` focus composer in block mode · `N`/`Tab` quick-add
· `Enter` apply proposal / `Esc` discard · `Ctrl Enter` run · `Esc` stop run · `Ctrl S` save
(studio-actions) · `F2` rename · `Ctrl D` duplicate · `Del` delete · arrows nudge, `Alt`+arrows
move selection to a neighbour (n8n) · `Shift 1` fit · `Shift L` tidy layout · `Ctrl Z / Ctrl Shift Z`
· `?` keymap. Every shortcut shows in its tooltip and in the KeymapSheet. The proposal
summary and the "Before this can run" list are copyable as text.

### 3.5 Accessibility

- The composer is a labelled `textarea`. Block mode is a `listbox` with `aria-activedescendant`, and arrows/Enter work.
- Proposal arrival is announced politely ("Nilo proposes 4 changes. Enter applies, Escape discards"), and focus moves to Apply.
- Ghost nodes carry `aria-label="Proposed: Gate Brief check"`. State is never colour-only (dashed + "proposed" text, the "Needs a provider" text).
- Every drag action has a click/keyboard equivalent. Canvas nodes are focusable, and Enter opens the Inspector.
- Contrast uses the existing `--ink-*` on `--sub-*` tokens. `prefers-reduced-motion` stops pulses and camera tweens.
- Targets are ≥ 28 px in chrome and ≥ 24 px on the canvas. No text below 11 px at 100 % zoom, and the semantic-zoom floor protects it when zoomed out.

### 3.6 Visual rules (inside the existing system)

Tokens, fonts (Sora UI, IBM Plex Mono for machine strings only) and colours stay as in
`frontend/src/app/globals.css`. Assistant surfaces use Nilo's face (`NILO_FACE`) and
`--nilo-*` tokens, nowhere else. The ghost style is `--signal` dashed at 14 % fill. Mono is
reserved for provider/model ids, shortcuts and Advanced. Node plates show at most 3 lines:
name + kind, purpose, one "needs" line.

---

## 4. Phase-2 implementation slices (ordered, each one PR, TDD)

| # | Slice | Done when |
|---|---|---|
| S0 | **Nilo naming.** Rename every visible assistant string to Nilo and add Nilo's face to assistant surfaces. (Internal module names can follow later.) | A grep of rendered strings finds no third-party brand. Tests updated. |
| S1 | **Review-before-apply.** Add a `pending` proposal state in the store, a ghost render layer in `HarnessCanvas`, auto-frame, per-change toggles, Apply = one `applyGraphPatch` + one undo entry, Enter/Esc. | Unit: the store never mutates the graph while pending. E2E: propose → ghosts visible in viewport → discard leaves the graph identical. |
| S2 | **One header.** Merge title bar, toolbar and editor bar. Host the studio-actions toolbar. Remove the bundle dock and the editor status bar. Move "Use in chat" into the Run menu. (Rebase after `feat/studio-harness-actions` lands.) | 1 header at 48 px. The name appears once. Import/export appear once. |
| S3 | **Unified composer.** Docked/centred variants, `/` block mode, provider line, offline fallback in place. The Library describe box hands off into it (`copilotEntry.ts`). | The empty canvas shows the composer. NL → S1 review. `/agent` + Enter inserts a wired block. |
| S4 | **Quick-add & connect.** `onConnectEnd` search, double-click search, port "+", insert-after-selection auto-wire, `isValidConnection` with a reason tooltip. | Each path is covered by an RTL/e2e test. An illegal drop shows a reason. |
| S5 | **Readiness model.** A derived per-node `needs[]` (provider, profile, checklist, unwired route). Plate need-line, Inspector "Before this can run", a Problems tab merging GraphAudit + bundle validate errors with node/field links, and the header pill. Run pre-checks. | Every validate error maps to a node or says "harness-level". The pill matches Problems. |
| S6 | **Camera & legibility.** Clamped auto-fit, no auto-zoom on add, semantic zoom < 60 %, `Shift L` tidy (needs a layout lib; none in deps today — ADR for dagre vs elkjs). | Screenshot test at 3 / 8 / 20 nodes. No text < 11 px rendered. |
| S7 | **Inspector & Field Assist.** Human labels, Advanced disclosure (ports, Copy id), single "Ask Nilo" ghost suggestion per field. | The raw UUID is never visible by default. Field Assist is one control. |
| S8 | **States & a11y pass.** Engine-offline, running read-only, live-region announcements, reduced motion, KeymapSheet entries. Extend `scripts/e2e-studio-clarity.mjs`. | axe clean on the editor. Keyboard-only walkthrough of §3.2 passes. |

S1 and S2 can run in parallel. S3 depends on S1. S5 can start after S2.

---

## 5. Self-critique (hallmark pre-emit, 1–5)

Philosophy 4 · Hierarchy 4 · Execution 3 (throwaway: wire routing and layout are faked) ·
Specificity 4 · Restraint 4 · Variety 3 (it deliberately reuses the app's own system rather
than a new theme, as a redesign inside existing boundaries should). The prototype was
checked at 1440 px and at the browser's 500 px minimum width (no horizontal scroll); below
1100 px the Blocks panel hides, and below 780 px the side panel hides.
