# OHarness — Competitive Gap Audit (2026-09-10)

Scope: read-only code audit of `frontend/src/components/**`, `frontend/src/store/**`, `frontend/src/lib/**`, `frontend/src/app/page.tsx`, and `backend/routers/**`, compared against Cursor, Claude Code / the Claude desktop app, and OpenAI Codex as of 2026. All claims below are backed by a file path (and line, where a single line is the evidence); anything not directly verified in code is marked **uncertain**.

---

## 1. What OHarness actually implements today

| Area | Status | Evidence |
|---|---|---|
| Agent chat (single-turn composer → SSE run → transcript) | **Real** | `frontend/src/components/agent/AgentStage.tsx`, `frontend/src/components/agent-run/useRunStream.ts`, `backend/routers/execution.py` (`/execute/direct`, `/execute/`) |
| Threads list (create/select/rename, arrow-key nav) | **Real**, but **client-only** — no backend model, no cross-device sync, no search | `frontend/src/components/agent/ThreadsSidebar.tsx`, `frontend/src/store/threadStore.ts` (persisted to `localStorage` under `oh.threads.v1`, no server API) |
| Harness on/off toggle + bundle picker in composer | **Real** | `frontend/src/components/agent/HarnessBar.tsx`, `frontend/src/store/harnessSessionStore.ts` |
| Harness Studio canvas (xyflow, node palette, properties panel, undo/redo, graph audit) | **Real** | `frontend/src/components/canvas/HarnessCanvas.tsx`, `frontend/src/components/canvas/GraphAudit.tsx`, `frontend/src/store/canvasStore.ts` |
| Human-in-the-loop gate (approve/reject + note, blocks downstream) | **Real** — functions like a permission prompt | `frontend/src/components/agent-run/Gate.tsx`, `backend/routers/execution.py` `ControlRequest` (`decision`, `note`) |
| Run ladder (per-node plan progress bar) | **Real**, but read-only during a run — no editable to-do list | `frontend/src/components/agent-run/RunLadder.tsx` |
| Steering (send a message mid-run) | **Real** (backend `control` action `"message"` → `control.inbox`) | `backend/routers/execution.py:341-343`; frontend send path uses same `/execute/{run_id}/control` — **uncertain** whether AgentStage/Transcript expose a UI affordance to send a steer (not found wired into `AgentStage.tsx`) |
| Harnesses library (import/export `.ohm`, activate, remove) | **Real** for local storage; **partial** for backend persistence (CRUD API exists but only one entry point, no versioning/sharing) | `frontend/src/components/harnesses/HarnessLibrary.tsx`, `backend/routers/harnesses.py` |
| Providers (connection wallet: residence, capability, billing, health probes) | **Real**, well-designed data model | `frontend/src/components/providers/catalog.ts`, `frontend/src/components/providers/providerStore.ts`, `frontend/src/components/providers/Dossier.tsx` |
| Provider execution adapters (actually usable by a run) | **Partial** — only `mock`, `claude`, `ollama`, `openai`, `lmstudio`, `codex` (all OpenAI-compatible) are wired; **`cursor` and `openrouter` have no backend adapter** and are not even in the frontend's node `adapter` dropdown | `backend/adapters/__init__.py:8-15` (`get_adapter` dict has no `cursor`/`openrouter` key — falls back silently to `MockAdapter`), `frontend/src/components/sidebar/PropertiesPanel.tsx:22` (`ADAPTERS` list omits both) |
| "Delegate node" (referenced for Cursor/agent-only providers) | **Does not exist** — UI copy tells the user to use it, but no such node type is in the schema | `frontend/src/components/providers/catalog.ts:33,117`, `frontend/src/components/providers/RunBinding.tsx:180`, vs. `frontend/src/lib/types.ts:1-7` (`NodeType` = `agent \| gate \| hitl \| skill \| mcp \| tool` — no `delegate`) |
| Cursor cloud-agent / CLI handoff buttons | **Stub** — buttons render with no `onClick` | `frontend/src/components/providers/ModelSection.tsx:272` (`<Btn>Delegate a task</Btn>`), `:279-282` (`<Btn>Launch in terminal</Btn>`) |
| MCP support | **Stub / data-model only** — a canvas node type with `mcpCommand`/`mcpUrl` fields exists, but there is no MCP client, transport, or tool-call bridge anywhere in the backend | `frontend/src/lib/types.ts:6,44-46`; `grep -ri mcp backend/` returns **zero** matches outside frontend |
| Automations (schedules) | **Partial** — real CRUD, a real in-process cron matcher/poller, but the job it runs is a canned stand-in, not the actual agent/harness pipeline | `backend/routers/automations.py`, `backend/automations/scheduler.py:63-87` (`mock_execute`: *"Stand-in for Agent execute pipeline"*) |
| Cowork (project workspaces) | **Partial** — real CRUD/DB persistence for name/path/instructions/memory JSON, but no filesystem access, no run wiring, no actual "work in this folder" behavior | `backend/routers/cowork.py`, `frontend/src/components/cowork/CoworkPanel.tsx` |
| Pull requests / Git panel | **Partial** — real GitHub/GitLab REST adapters exist (`repos/github.py`, `repos/gitlab.py`), but the **default provider is `fake`** and that literal string is shown to users as a UI badge unless an env var is set | `backend/repos/factory.py:16-33`, `frontend/src/lib/reposApi.ts:42-49`, `frontend/src/components/git/GitPanel.tsx:79` (`<Panel title="Pull requests" meta={provider} …>`) |
| Run history / "Runs" section | **Stub in the UI despite a real backend** — `/execute/logs` exists and returns real run records, but no frontend code calls it; the rail item is permanently disabled | `backend/routers/execution.py:358-374` (`GET /execute/logs`, unused by frontend — confirmed via repo-wide search for `execute/logs`/`list_logs`), `frontend/src/components/shell/ActivityRail.tsx:33-38,46-51` (`disabled: true` in both `AGENT_SECTIONS` and `STUDIO_SECTIONS`), `frontend/src/app/page.tsx:347-357` (`StubPanel` placeholders) |
| Thinking/status indicator | **Partial** — a "Running…" label and a `phase`/`phaseDetail` field exist, but no elapsed-seconds counter or rotating status verbs in the composer/transcript | `frontend/src/components/agent-run/types.ts:27,39` (`Phase`), `frontend/src/components/agent/AgentStage.tsx:194-206` (static "Running…" text, no timer) |
| File attachments / @-mentions in composer | **Not implemented** — composer is a plain `<textarea>` | `frontend/src/components/agent/AgentStage.tsx:236-249` |
| Slash commands | **Not implemented** in Agent chat (the command palette is a separate global overlay, not an in-composer `/` menu) | `frontend/src/components/shell/CommandPalette.tsx`, `frontend/src/components/agent/AgentStage.tsx` (no `/`-trigger handling) |
| Checkpoints / rewind / diff review panel | **Not implemented** anywhere in frontend or backend | repo-wide search for `checkpoint`, `rewind`, `diff review` in `frontend/src` returns no matches beyond node/type scaffolding unrelated to run checkpoints |
| Subagents / hooks / skills-as-first-class / CLAUDE.md-equivalent memory | **Not implemented** — "skill" exists only as one canvas `NodeType` (a role/skill id string bound to a node), not a marketplace or hook system | `frontend/src/lib/types.ts:5,21,30-32` |
| Keyboard map / command palette | **Real**, well executed — single source of truth, `?` opens a legend, `Mod+K` opens palette | `frontend/src/components/shell/KeymapSheet.tsx`, `frontend/src/components/shell/CommandPalette.tsx` |
| Theme toggle | **Real** (light/dark, persisted to `localStorage`) | `frontend/src/components/shell/ActivityRail.tsx:104-119` |
| Usage / spend / limit display | **Not implemented** — Providers panel shows connection health and billing *type* (metered/credits/subscription) but no actual spend, token usage, or rate-limit readout | `frontend/src/components/providers/catalog.ts` (`Billing` is a label, not a live number); no usage endpoint found in `backend/routers/**` |

---

## 2. Gap list vs. Cursor / Claude Code & Claude desktop / OpenAI Codex

P0 = expected by any user of an agent app · P1 = parity or strong differentiator · P2 = later

| # | Feature | Who has it | OHarness today | Priority | New IA location | Size |
|---|---|---|---|---|---|---|
| 1 | Run history / past runs list | Cursor, Claude Code, Codex | Backend endpoint exists (`/execute/logs`) but zero frontend consumer; rail item hard-disabled | **P0** | Agent (per-thread) + a real Runs/History item | S |
| 2 | Thinking indicator with elapsed time / status verbs | Claude Code, Claude desktop, Cursor | Static "Running…" text only, no timer, no phase verbs surfaced to the user | **P0** | Agent composer/transcript | S |
| 3 | Real automations (trigger actually runs the harness, not a mock) | Cursor Automations, Claude scheduled tasks | Cron matching + scheduler loop are real; execution is `mock_execute`, a stand-in | **P0** | Automations (promoted to top-level sidebar item) | M |
| 4 | Working provider adapters for every provider shown in Providers | Cursor, Claude Code, Codex all execute against what they advertise | `cursor` and `openrouter` are listed as connectable providers but have no backend adapter and aren't selectable on a node; silently falls back to Mock | **P0** | Providers + Studio node config | M |
| 5 | Diff / changes review panel before applying edits | Cursor changes panel, Claude Code, Codex | Not implemented at all | **P0** | New "Changes" panel off Agent/Studio | L |
| 6 | Permission modes / trust levels (auto-approve vs. always-ask) | Claude Code permission modes, Cursor | Only a single binary Gate (approve/reject per node); no policy/mode concept | **P0** | Settings + per-harness gate config | M |
| 7 | File attachments in composer | Cursor, Claude Code, Claude desktop | Not implemented — plain textarea | **P0** | Agent composer | S |
| 8 | Search across threads/messages | Cursor Ctrl+K search, Claude Code | `Mod+K` only opens the command-verb palette; no message/thread content search | **P0** | New sidebar "Search" entry | M |
| 9 | Usage / spend / rate-limit display | Claude Code usage display, Cursor plan usage | Not implemented; Providers shows billing *type*, not live numbers | **P0** | Providers + status bar | M |
| 10 | Cowork/project actually running work in a folder | Claude Code (CWD-scoped), Cursor background agents, Codex cloud tasks | CRUD-only metadata store; no filesystem access, no execution tie-in | **P0** | Cowork (top-level sidebar item) | L |
| 11 | PR creation against a real repo by default | Codex, Cursor, Claude Code | Defaults to a `fake` provider shown literally in the UI; real GitHub/GitLab adapters exist but aren't the default and aren't configurable from the UI | **P0** | Providers (add repo/token) + Pull requests | M |
| 12 | To-do / plan list the user can see update live, independent of the run ladder | Claude Code todo list, Cursor plan mode | `RunLadder` shows node progress but it's graph-structural, not a generated task list with checkable items | **P1** | Agent transcript | M |
| 13 | @-mentions (files, docs, past runs) | Cursor, Claude Code | Not implemented | **P1** | Agent composer | M |
| 14 | Slash commands in the composer | Claude Code | Only a global `Mod+K` palette exists; no `/`-triggered in-composer menu | **P1** | Agent composer | S |
| 15 | Checkpoints / rewind to a prior state | Claude Code checkpoints, Cursor checkpoints | Not implemented anywhere | **P1** | Agent thread + Studio graph history | L |
| 16 | MCP connectors (real client, not just a node shape) | Cursor, Claude Code/desktop, Codex | Only `mcpCommand`/`mcpUrl` fields on a canvas node; zero backend MCP client/transport | **P1** | Providers (new "Connectors" section) or Studio node | L |
| 17 | Parallel/background runs the user can manage as a list | Cursor background agents, Codex cloud tasks | Backend supports multiple `RUNS[run_id]` concurrently (`execution.py`), but frontend surfaces at most the active run per thread — no multi-run manager UI | **P1** | New Runs/Automations view | M |
| 18 | Rules / standing instructions (repo- or workspace-scoped) | Cursor rules, Claude CLAUDE.md/memory | Cowork has a free-text "instructions" field per project, but nothing workspace-global, no `.md`-file convention | **P1** | Cowork + a new "Rules" concept | M |
| 19 | Skills as a discoverable, reusable library (not just a graph-node field) | Claude Code skills, Cursor rules/commands | `skillId` is a free-text string on one node type; no skill browser, versioning, or marketplace | **P1** | Harnesses/Studio | M |
| 20 | Subagents (a node/task that spawns an isolated agent with its own context) | Claude Code subagents | Not implemented; `agent` node type is a single LLM call bound to a role, not a nested agent | **P1** | Studio node types | L |
| 21 | Hooks (pre/post-tool-call automation) | Claude Code hooks | Not implemented | **P2** | Studio / Providers | L |
| 22 | Artifacts / rich structured output rendering | Claude desktop artifacts | Transcript renders plain text/tool blocks only, no structured/rendered output surface | **P2** | Agent transcript | L |
| 23 | Delegate node that actually exists (fixes a currently-broken promise, see §3) | N/A (internal consistency, not a competitor feature) | UI tells users to use a "Delegate node" that isn't in the schema | **P0** (bug, not a feature gap) | Studio node palette | S |
| 24 | Cross-device / account sync for threads and harnesses | Claude Code (login-scoped), Cursor | Threads are `localStorage`-only; Harnesses persist to a local SQLite-style DB only (**uncertain** exact backend store — not fully traced) | **P2** | Settings/account (if ever added) | L |
| 25 | Steering UI (mid-run message) surfaced to the user | Claude Code (interrupt & redirect) | Backend supports it (`control` action `"message"`); no confirmed UI affordance in `AgentStage`/`Transcript` to send one | **P1** | Agent composer, while a run is live | S |

---

## 3. Confusing-menu / IA problems found in the current code

1. **"Runs" nav item is permanently disabled but still carries a keyboard shortcut hint.** `frontend/src/components/shell/ActivityRail.tsx:33-38` gives the Agent-mode "Runs" entry `chord: "Alt+3"` and `disabled: true`; the button renders the Alt+3 hint via `RailButton`'s `hint` prop, but `frontend/src/components/shell/AppShell.tsx:226-230` only acts on Alt+3 when `mode === "studio"` — so the shortcut shown next to a disabled item does nothing in Agent mode. Studio's own `Runs` item (`ActivityRail.tsx:46-51`) reuses the same disabled pattern but with an empty `chord: ""`, an inconsistency between the two copies of the same stub.

2. **Dev/internal phrasing shown directly to end users as the "Runs" panel content.** `frontend/src/app/page.tsx:349` — *"Execution history lands here once the run panel ships."* — and `:356` — *"Agent run history mounts with the agent-run panel."* These are roadmap/implementation notes, not user-facing copy, and they ship in the built app via `StubPanel`.

3. **A literal dev config value (`"fake"`) is shown as a UI badge to real users by default.** `frontend/src/components/git/GitPanel.tsx:79` renders `<Panel title="Pull requests" meta={provider} …>` where `provider = defaultRepoProvider()` defaults to `"fake"` (`frontend/src/lib/reposApi.ts:42-49`) unless `NEXT_PUBLIC_REPO_PROVIDER`/`REPO_PROVIDER` is set. A user opening Pull Requests for the first time sees a panel badge that says "fake."

4. **Automations, Cowork, and Pull requests are reachable only from the command palette** — they have no nav-rail entry, no chord, and are not listed in the Keyboard map sheet. `frontend/src/components/shell/commands.ts:97-127` (`shellOverlayCommands`, no `chord` field on any of the three) vs. `frontend/src/components/shell/KeymapSheet.tsx:11-49` (`GROUPS` never mentions Cowork/Automations/Pull requests). This matches the owner's "menus are confusing" complaint directly — three real surfaces exist with no discoverable entry point outside typing into `Mod+K`.

5. **A named UI concept that does not exist in the data model.** The Providers surface repeatedly instructs the user to use a "Delegate node" for agent-only providers (Cursor): `frontend/src/components/providers/catalog.ts:33,117`, `frontend/src/components/providers/RunBinding.tsx:180`, `frontend/src/components/providers/ModelSection.tsx:272` ("Delegate a task" button). But `frontend/src/lib/types.ts:1-7` defines `NodeType` as `agent | gate | hitl | skill | mcp | tool` — there is no `delegate` node the user can ever add. This is a dead reference baked into copy, not just a missing feature.

6. **Dead buttons with no handler in the Providers → Cursor dossier.** `frontend/src/components/providers/ModelSection.tsx:272` (`<Btn>Delegate a task</Btn>`) and `:279-282` (`<Btn>Launch in terminal</Btn>`) render without an `onClick`, so they visually invite a click that does nothing.

7. **Silent fallback to Mock for providers the UI presents as connectable.** Selecting `cursor` or `openrouter` as a node's adapter is impossible from the Studio dropdown (`frontend/src/components/sidebar/PropertiesPanel.tsx:22`, `ADAPTERS` omits both), and even if an `adapter` value slipped through some other path, `backend/adapters/__init__.py:7-16` maps any unrecognized name to `MockAdapter()` with no warning surfaced to the user — a harness could silently run on mock output while the UI implies a real provider is bound.

8. **Inconsistent chord binding across modes for the same physical key.** `Alt+3` means "Runs (disabled, does nothing)" in Agent mode and "Canvas" in Studio mode (`frontend/src/components/shell/AppShell.tsx:218-230`, `frontend/src/components/shell/ActivityRail.tsx:29-51`). A user who learns Alt+3 in one mode gets a different, mode-dependent result — not itself wrong, but worth flagging since the new IA's single fixed sidebar removes the mode split this behavior currently depends on to make sense.

9. **Naming drift between the URL/internal id and the label the user sees.** The rail section id is `"files"` internally (`frontend/src/components/shell/shellStore.ts:11`) but always renders as "Harnesses" to the user (`frontend/src/components/shell/ActivityRail.tsx:30,44`) — low severity (invisible to users), but worth a rename pass since the new IA is being redrawn anyway; a future contributor reading `section === "files"` in `frontend/src/app/page.tsx:358-364` has to know it means the Harnesses list.

10. **The Providers panel title is centralized (`PROVIDERS_PANEL_TITLE` in `frontend/src/components/providers/copy.ts`) while other panel titles are hardcoded strings scattered per-component** (`"Pull requests"` in `GitPanel.tsx:79`, `"Cowork"` in `CoworkPanel.tsx:90`, `"Automations"` in `AutomationsPanel.tsx:105`, and again separately in `ShellOverlayHost.tsx:13-17`'s `TITLES` map). Three of the four titles are defined twice (once in the panel component, once in `ShellOverlayHost`'s `TITLES`), a place a rename is likely to go stale in one location and not the other.

---

## Summary for the redesign

The strongest real assets to carry into the new fixed sidebar: the human-in-the-loop Gate, the command palette/keymap system, and the Providers "wallet" data model are all genuinely well-built and differentiated. The weakest points are exactly the three items currently palette-only (Automations, Cowork, Pull requests) — each is a thin CRUD shell over a mock or default-fake execution path, so promoting them to first-class sidebar items will expose functionality gaps (items 3, 10, 11 above) that were previously hidden behind low discoverability. Runs/history is the fastest win: the backend already has it (`/execute/logs`), only the frontend is missing.
