# Harness Studio — UX/DX Plan (2026-09-10)

Scope: read-only audit + plan for the Studio canvas editor only (not Agent mode, not Providers). Answers the owner's question — "ainda está bem cru… precisamos que ele seja melhor que um n8n; estamos usando xyflow-react? ou algo melhor? não está didático nem intuitivo, need mais UX e DX." Every claim below is backed by a file path; code read for this pass covers `frontend/src/components/canvas/**`, `frontend/src/components/sidebar/**`, `frontend/src/components/studio/ValidateDock.tsx`, `frontend/src/components/toolbar/Toolbar.tsx`, `frontend/src/components/shell/StatusBar.tsx`, `frontend/src/components/shell/CommandPalette.tsx`, `frontend/src/store/canvasStore.ts`, `frontend/src/lib/{templates,ports,types}.ts`, `frontend/src/app/page.tsx`, `frontend/src/app/globals.css`, `frontend/package.json`.

A sibling audit, `docs/product/competitive-gaps-2026-09-10.md`, covers the whole app against Cursor/Claude Code/Codex. This document is narrower and deeper: it is only about the canvas editor, benchmarked against node-editor tools (n8n, Langflow, Flowise, Rivet, ComfyUI, Make, Zapier, Retool, Stately, Figma), because that is the actual complaint.

**Headline finding**: the visual design system underneath Studio is already unusually disciplined — locked role hues, mono-vs-prose typographic split, orthogonal wires with meaning-carrying colour, registration-mark selection instead of glow, a live GraphAudit strip. The "cru" feeling is not a skin problem, it's a *behavior* problem: the canvas has almost no direct-manipulation affordances beyond drag-from-palette and drag-a-wire. Nothing teaches, nothing previews, one button is a visible no-op, and the very first thing a new user sees is marketing copy inside a tool that otherwise never uses marketing copy anywhere else.

---

## 1. Current Studio UX audit

### 1.1 Add a node
- Only path: drag a row from `NodePalette` (`frontend/src/components/sidebar/NodePalette.tsx:36-73`) onto the canvas; drop position is computed correctly via `screenToFlowPosition` in `HarnessCanvas.tsx:115-133`. This part works well and is a real fix from a documented past bug (comment at `HarnessCanvas.tsx:112-114`).
- Second path: `Mod+K` command palette → "Add {Type}" commands, built in `page.tsx:207-226`. These insert at a **fixed cascading offset** (`x: 160 + nodes.length * 28`, `page.tsx:220`), not at cursor or viewport centre — acceptable but not spatially intentional.
- **No third path.** There is no "+" affordance anywhere on the canvas itself: not on an empty canvas click, not on a node edge, not on a handle. Every mainstream node editor (see §3) offers "drag a wire and drop it on nothing → search a node → it connects itself." OHarness has no `onConnectStart`/`onConnectEnd` handlers at all (confirmed absent — `Grep` for `onConnectStart|onConnectEnd` across `frontend/src` returns nothing), so dragging a wire off a handle onto empty canvas just … cancels. That is the single most requested n8n-style affordance and it does not exist.
- `NodePalette` has no search/filter box (`NodePalette.tsx:75-88` — a static title, a one-line instruction, then the six rows). Fine at 6 node types; will not scale, and a search box is also the fastest way to make the palette feel "keyboard-first" per the brief's own ask (Tab/Space).

### 1.2 Connect nodes
- Wires are excellent once drawn: `HarnessWire.tsx` computes a real orthogonal route, colours by port semantics (`accept`/`reject`/`flow`), and a label chip states the branch. `connectionMode={ConnectionMode.Strict}` is set (`HarnessCanvas.tsx:158`) so only matching handle types connect — good default.
- **No `isValidConnection` prop anywhere** (confirmed absent by grep). Strict mode will silently refuse an illegal drop, but the user gets no explanation — no toast, no shake, no "Gate.fail only accepts a signal input" message. Compare §3: n8n and Retool both surface a reason inline at the cursor.
- Handles do carry meaning (`BaseNode.tsx:203-246`, named `pin`/`pout` rows, wired vs. unwired visual state) — this is genuinely better *information design* than n8n's anonymous dots. The gap is entirely in the *drag interaction*, not the port model.

### 1.3 Configure a node
- `PropertiesPanel.tsx` is solid: identity block, a live `PortTable` (`:47-95`) showing exactly what's wired to each port by name, then type-specific fields. This is close to n8n's node detail view already, minus a couple of things:
  - No inline validation. A `mcp` node with an empty `mcpUrl` and empty `mcpCommand` (both optional-looking text inputs, `PropertiesPanel.tsx:234-251`) gives no signal that the node is unconfigured, on the node plate or in the inspector, until a full bundle Validate run fails elsewhere.
  - No per-field error attachment — `ValidateDock` errors (see 1.4) are a flat string list with no link back into this panel.

### 1.4 Validate
- `GraphAudit.tsx` is the best-designed piece in Studio: three structural faults (`never reached`, `dead end`, missing entry), each a **clickable chip that selects and re-centres the offending node** (`reveal()`, `GraphAudit.tsx:61-65`). This is exactly the "click the error, jump to the node" pattern §4 recommends elsewhere — it just isn't reused.
- `ValidateDock.tsx` (bundle-level Validate/Mock via the backend) renders its errors as a plain `<ul>` of strings (`:224-230`) with **no node linking at all**, even though most validation errors are almost certainly per-node/per-field. It sits under the canvas only once `nodes.length > 0` (`page.tsx:372`), which is reasonable, but its error UX is a regression relative to `GraphAudit` one file away.

### 1.5 Run and see results
- `Toolbar.tsx` Run button is graph-wide only (`onRun`, no per-node run). `BaseNode.tsx:132-139` renders a `NodeToolbar` with a **"Run from here" button whose `onClick` is `() => undefined`** (`BaseNode.tsx:134`) — a real, visible, clickable no-op. This is the kind of thing that reads as "cru" fastest: it looks finished and does nothing.
- Execution *feedback* on the plate is better than it looks at first: `StateSlot` (`BaseNode.tsx:48-60`) shows `running`/`error`/`held`/latency in the header, the plate border recolours by state (`STATE_BORDER`, `:39-45`), a 1px animated strip runs along the bottom while `running` (`:270-272`), and `HarnessWire` has a `live` prop that recolours and animates a wire (`HarnessWire.tsx:77,116-118`, `.live` class in `canvas.module.css`). The **data model for a live execution overlay already exists** (`NodeData.status`, `EdgeData.live`) — it's just not fed by anything richer than a start/complete/error transition; there's no elapsed-time ticker while running, no token count until the very end (`data.tokens`, shown only in `PropertiesPanel.tsx:387-390` after completion), and no streaming preview of `output` mid-run (`BaseNode.tsx:256-260` only renders `output` when `status === "complete"`).
- No data-preview-between-nodes anywhere: the only place output is visible is the completed node's own truncated 110-char strip (`BaseNode.tsx:256-260`) or the inspector's `<pre>` block (`PropertiesPanel.tsx:397-401`). There's no "pinned data" concept, no way to inspect what node A actually handed node B.

### 1.6 Undo
- Real, if minimal: a 50-entry in-memory history stack (`canvasStore.ts:27,92-114`), wired to `Mod+Z`/`Mod+Shift+Z` in the toolbar and command palette. It is **session-only** — reload the page and it's gone, no named snapshots, no diff view. Fine as an editing convenience, not a version history.

### 1.7 Find help
- `?` in the status bar opens `KeymapSheet` (`StatusBar.tsx:73-80`) — a real, well-built shortcut cheat-sheet already (see `docs` note: task item "shortcut cheatsheet" is **already done**, don't re-plan it).
- There is no contextual/in-canvas help: no coach marks, no "what is a Gate node" tooltip beyond the palette's static one-line description (`templates.ts` `description` fields, surfaced only as a drag `title` attribute, `NodePalette.tsx:41`), no guided first run.

### 1.8 First impression (the owner's actual complaint, in code)
- `EmptyStage` (`page.tsx:61-125`) opens with `<h1>Turn a way of working into a system.</h1>` at up to 4.2rem (`page.tsx:90-92`) plus marketing sub-copy ("Compose agents, tools, checks and human decisions on one canvas…", `:93-95`). This is the exact phrase the owner quoted, and it is stylistically inconsistent with the rest of the app, which the visual-language comment block in `HarnessCanvas.tsx:26-38` explicitly says is instrumentation, not a product page. It does already offer two real starter presets with one-line descriptions (`:68-83`) — that part is good and just needs to be the star of the screen, not a sidebar next to a hero.
- `StatusBar.tsx` confirms the "debug strings" complaint literally: `Cell k="sel" v={selectedId}` (`:64`) prints the raw node id (e.g. `agent-1757490000123`) to end users, and `graph`/`mode`/`section` cells are all machine strings by design (stated intent at `StatusBar.tsx:6-11`). The mono-for-machine-copy rule is a good system; showing a raw generated id as if it were useful information to a non-developer is the part that reads as unfinished.

---

## 2. Library question: stay on @xyflow/react v12, or move?

**Recommendation: stay on `@xyflow/react` `^12.3.6` (`frontend/package.json:21`). Do not migrate.**

Reasoning against each alternative, weighted for this stack (React 19, Next 15 static export, Tauri v2 desktop shell, and — critically — a large amount of *already-working* custom canvas code):

| Option | Verdict | Why |
|---|---|---|
| **Vue Flow** (what n8n uses) | No | It's a Vue 3 library. Adopting it means running a Vue island inside a Next/React/Tauri app (two component runtimes, two build pipelines) or rewriting the whole frontend in Vue. n8n's UX is *not* a function of Vue Flow vs. xyflow — they are sibling libraries by the same author with near-identical APIs (nodes/edges/handles, `elkjs`/`dagre` layout, same connection-validation model). What n8n does better lives entirely in interaction code on top of the library, not in the library. |
| **Rete.js** | No | Lower-level (you build ports, rendering and even sockets largely yourself), thinner React adapter, smaller ecosystem for minimap/controls/node-toolbar than xyflow. Would mean re-deriving things Studio already has (minimap, NodeToolbar, background grids) for no behavioral gain. |
| **JointJS / JointJS+** | No | Diagramming-first (BPMN/ERD/flowchart shapes), commercial license for the "+" tier, SVG/Canvas hybrid rendering model that fights the existing CSS-variable/oklch theming already built into every node and wire. |
| **tldraw** | No | Whiteboard-first: shapes, freeform arrows, sticky notes are its native strength (worth *borrowing the idea* — see §4 grouping/comments — not the library). It has no first-class typed-port/handle model; bolting one on is more work than what Studio already has. |
| **litegraph.js** | No | Canvas2D rendering. Loses DOM accessibility (every current node is a real, focusable, ARIA-labelled DOM subtree — `BaseNode.tsx` uses real `<button>`s with `aria-label`), and every themed value (the oklch CSS variables the whole app is built on, `globals.css:26-57`) would need a parallel JS-side colour system instead of just being CSS.
| **Custom canvas from scratch** | No | Would re-derive pan/zoom math, hit-testing, minimap, box-select, edge routing, and drag-and-drop from `HarnessCanvas.tsx`'s working 200 lines. No line item in §4 requires it — every gap is an *interaction feature*, not a rendering-engine limitation. |

What xyflow v12 already buys, unused: **`elkjs`/`dagre` auto-layout** (not a dependency yet — `package.json` has neither; add `elkjs` for the auto-layout item in §4), **`NodeToolbar`** (already used, `BaseNode.tsx:3,132`), **`MiniMap`** (already used, `HarnessCanvas.tsx:188-200`), **subflow/parent-node nesting** (native `parentId`/`extent` support, unused — needed for §4's grouping item), and **`onConnectStart`/`onConnectEnd`** (native, unused — needed for the "+" quick-add). Nothing in §4 requires a library change; it requires using more of the library that's already installed, plus one new dependency (`elkjs`) for layout.

---

## 3. Node-editor UX benchmark (what "better than n8n" has to beat)

- **n8n**: the "+" on a node's output opens a searchable, categorized node picker positioned at the drop point — this is the single most-copied interaction in the category and the one Studio is missing entirely (§1.1). Node detail view splits input/output data panes with **pinned data** (freeze a real payload so downstream nodes can be built/tested without re-running upstream). Single-node execution ("Test step") is a first-class button, not a dead stub. A running workflow overlays the canvas with per-node spinners and a run-summary bar.
- **Langflow / Flowise**: both lean on a component-picker panel with live search and category grouping (closer to a package manager than n8n's flyout), and both show a small live "chat" or IO preview attached to the graph rather than only in a side panel — reinforces that data-between-nodes should be visible near the wire, not just in an inspector tab.
- **Rivet**: node inspector shows real-time streaming token output inside the node body during a run, not just after — directly relevant to §1.5's "data model exists, isn't fed live" gap.
- **Stately Studio**: best-in-class for *state* graphs specifically — it visualizes guards/conditions on transitions as small inline badges on the edge itself (comparable to Studio's edge label chip, which already exists and is good) and simulates a run by highlighting the active state node, one at a time, with a visible trace log alongside — a good model for a "step" run mode later.
- **ComfyUI**: node-level "queue this node only," and a strong convention of colour-coding by *data type* flowing through a socket rather than by node category — Studio already does the stronger version of this (role hue + port tone), so no gap here, just confirms the current model is sound.
- **Make.com / Zapier canvas**: both invest heavily in *inline node summaries* — a one-line, plain-English restatement of what a configured node will actually do ("Send email to {{customer.email}}") rendered right on the node face, not just a type label. Studio's `spec`/`note` slots on `BaseNode` (`BaseNode.tsx:94-96,181-190`) are the exact right primitive for this and are only used by a couple of node role wrappers today — the gap is coverage, not architecture (see §4).
- **Retool Workflows**: strongest "why was this rejected" connection-drag messaging — an inline red banner naming the exact type mismatch. Matches the `isValidConnection` gap in §1.2 directly.
- **Figma-grade interactions**: alignment/distribution on multi-select, live snap/helper lines while dragging (not just a fixed grid), and a command-K-first workflow. Studio already has box-select (`SelectionMode.Partial`, `HarnessCanvas.tsx:157`) and a real command palette (`CommandPalette.tsx`) — it is missing align/distribute and any drag-time snap guides beyond the static grid.

---

## 4. Prioritized plan

Every item names what exists today and what's missing, with a size estimate (S = part of a day, M = 1–3 days, L = 1+ week).

### Stage 1 — biggest perceived improvement, least work (all S, no new dependency)
1. **Wire the "Run from here" button** (or remove it). `BaseNode.tsx:134` is a live no-op — either implement single-node run against the mock adapter (reuse the same path `Toolbar`'s Run already calls, scoped to one node) or delete the button until it's real. Shipping a dead button is worse than not having the feature. **S.**
2. **Replace the marketing hero.** `EmptyStage` (`page.tsx:85-125`): drop the 4.2rem "Turn a way of working into a system." headline and its sub-paragraph; promote the two starter-flow cards (`:68-83`, already good, already wired to real presets) to the primary, centred content, with "Start from scratch" / "Open .ohm" as secondary actions underneath. Keeps every existing hook (`onPreset`, `setPaletteOpen`, `setSection`), just re-balances the layout the way the rest of the app already reads: instrumentation, not a landing page. **S.**
3. **Stop showing raw node ids as UX.** `StatusBar.tsx:64` — either drop the `sel` cell or replace the raw id with the node's `data.label` (already available via the store). **S.**
4. **Link `ValidateDock` errors to nodes**, the same way `GraphAudit.reveal()` already does (`GraphAudit.tsx:61-65`): if a validation error string carries or can be parsed for a node id, make that row clickable and call the same select+center pattern. Reuses an existing, working mechanism one file away. **S.**
5. **Search/filter box in `NodePalette`.** One `<input>` above the list (`NodePalette.tsx:75-88`), filtering `NODE_TEMPLATES` by label/description client-side; wire `/` or the existing `Tab` focus order to jump to it. Also the first half of the brief's "searchable, categorized… Tab/Space" ask. **S.**
6. **Inline config-status badges on the plate.** Extend the existing `spec`/`note` pattern (`BaseNode.tsx:94-96,180-190`) to show a one-line "unconfigured" state (e.g., `mcp` node with empty `mcpUrl`/`mcpCommand`, `agent`/`skill` with no `secretRef` bound) using the same mono `t-meta` slot already styled for machine facts. No new visual language, just more coverage. **S.**

### Stage 2 — the actual "better than n8n" lever (connection + layout)
7. **"+" quick-add on a dropped connection.** Implement `onConnectStart`/`onConnectEnd` on `<ReactFlow>` (`HarnessCanvas.tsx:138-164`, currently absent): on drop over empty canvas, open the same searchable palette from item 5 anchored at the drop point, and on pick, create the node **pre-wired** to the originating handle. This is the one interaction every benchmarked tool in §3 has and Studio doesn't. **M.**
8. **Explain rejected connections.** Add `isValidConnection` to `<ReactFlow>`, deriving the reason from `PORTS`/`findPort` (`lib/ports.ts`, already has everything needed) and surface it as a small inline banner near the cursor (Retool-style) instead of a silent refusal. **M.**
9. **Auto-layout ("Tidy") button.** Add `elkjs` (new dependency — not currently installed), a layered/left-to-right layout matching the existing `COL(i)*280`/`ROW(i)*120` convention already used by presets (`templates.ts:98-99`), triggered from `CanvasDock.tsx` next to the existing Fit/Snap/Lock buttons. **M.**
10. **Multi-select align/distribute + drag-time snap guides.** `CanvasDock.tsx` currently has zoom/fit/snap-to-grid/lock only (`:86-102`); add align-left/center/right/distribute for the existing box-select (`SelectionMode.Partial` is already on), plus Figma-style helper lines while dragging a single node (xyflow recipe, not a built-in — needs custom hook similar to the existing `orthoPath` custom edge work in `HarnessWire.tsx`, so there's local precedent for this kind of build). **M.**

### Stage 3 — run legibility (feed the overlay that already exists)
11. **Live data preview between nodes.** Extend `PortTable` (`PropertiesPanel.tsx:47-95`, already shows *which* nodes are wired to a port) to show the *last value* that crossed that wire, and add a small hover-preview on the wire itself in `HarnessWire.tsx`. The data already lives on `NodeData.output`; this is plumbing, not new state. **M.**
12. **Per-node "Test with sample input."** A small modal reusing `PropertiesPanel`'s field patterns, feeding a single node through the mock adapter with user-supplied input and pinning the result (n8n's "pinned data" concept) so downstream nodes can be built against it without re-running the whole graph. **M.**
13. **Feed the execution overlay while running, not just at completion.** `NodeData.status`/`EdgeData.live` already exist and render correctly (`BaseNode.tsx:39-60,270-272`, `HarnessWire.tsx:77,116-118`) — extend the run stream to update `data.output` incrementally (there is already `appendNodeOutput` in `canvasStore.ts:214-219`, currently unused by anything in the Studio run path per this audit) and show an elapsed-time tick next to `StateSlot`'s "running" label. **M.**
14. **First-run coach marks after loading a preset.** 3–4 short, dismissible callouts anchored to real elements (palette, a node's port row, the Validate button) the first time a preset loads via `loadPreset` (`page.tsx:202-205`). Pairs with item 2 — the empty state should sell the *first action*, the coach marks should sell the *second and third*. **M/L.**

### Stage 4 — structure and history (bigger, more speculative)
15. **Sticky notes / comment nodes.** A new lightweight `NodeType` (no ports, free text, distinct from the nine functional types) — smallest structural addition, high value for "didactic," used constantly in n8n/Make/Zapier boards to annotate intent. **S/M.**
16. **Subflow / grouping.** xyflow's native `parentId`/`extent: "parent"` (unused today) is the right primitive for grouping a sub-team of agents (e.g., collapse "QA Gate → QA → Architecture Gate" into one collapsible frame). **L.**
17. **Named version history + diff**, beyond the current 50-step session-only undo (`canvasStore.ts:27,92-114`): persist snapshots (reuse `HistoryEntry`'s existing shape) with a label and timestamp, and a simple node-added/removed/rewired diff view between two snapshots. **L.**

---

## 5. Studio visual language (for anyone implementing the above)

Already established in `frontend/src/app/globals.css` and `frontend/src/components/canvas/**` — new work must match, not invent:

- **Dark by default.** The `:root` block (`globals.css:26-57`) is the dark palette; a `[data-theme="light"]`-style override follows for light (`:86-98`). Any new surface (coach marks, the "+" picker, align toolbar) styles dark-first.
- **One accent, used only for state and focus.** `--signal: oklch(0.700 0.105 190)` (`globals.css:45`) and its `--signal-deep` variant are the *only* colour that means "this is live / selected / primary." It already carries: running-state border (`STATE_BORDER.running`, `BaseNode.tsx:41`), selection registration marks (`RegistrationMarks`, `BaseNode.tsx:279-289`), the Run button fill (`Toolbar.tsx:85`), and live-wire colour (`HarnessWire.tsx:116`). New affordances (a "+" button glyph, a snap-guide line, a coach-mark ring) reuse this token — never introduce a second accent.
- **Role hues are locked, not decorative.** Six `--role-*` tokens (`globals.css:52-57`) sit at one lightness/chroma band (`L≈0.47–0.61`, `C≈0.035–0.105`) so no node type reads as more or less "important" than another by colour alone — only the glyph and the 3px spine differ. A new node type (sticky note, group frame) needs a seventh token at the same band, not a colour chosen for contrast/attention.
- **No gradients, neon, or glow — ever.** Selection is four corner brackets (`RegistrationMarks`), not a drop-shadow; hover is a flat `color-mix` shift (`BaseNode.tsx:169`, `NodePalette.tsx:53`), not a glow. Any new hover/active/focus state follows the same rule.
- **Mono for machine facts, prose for human copy.** Stated explicitly at `StatusBar.tsx:6-11` and used throughout (`t-meta` for ids/counts/latency, `t-title`/`t-body` for labels and prose). This is also the fix for §1.8's status-bar complaint: it's not that mono-for-machine-data is wrong, it's that a raw generated id isn't *useful* machine data to show a human at all.
- **13px titles, compact but breathable.** Node header height 26px, port rows 20px, toolbar/status-bar 32px/22px (`BaseNode.tsx:164,201`, `Toolbar.tsx:70`, `StatusBar.tsx:51`) — new chrome (the "+" picker, align toolbar, coach-mark card) should sit inside this same compact rhythm, not introduce padding-heavy, card-shadow "web app" density.

---

**Output path**: `D:\Development\src\OHarness\docs\product\studio-ux-plan-2026-09-10.md` (this file).
