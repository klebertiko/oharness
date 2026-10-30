# OHarness

Desktop Agent + Harness Design Studio: run agents against Providers, and author harnesses as an OHarness Model (`.ohm`).

## Language

### Model

**OHarness Model (OHM)**:
The portable JSON document that describes a harness — graph, content, connectors, and runtime. File extension `.ohm`.
_Avoid_: oharness file, wallet bundle, pipeline JSON

**Harness**:
A composed system of Agents, Gates, HITL, Skills, and Signals that orchestrates work. Everything the product ships, shows or opens is a harness.
_Avoid_: framework, template, preset, sample, starter, workflow (ambiguous with BPM), pipeline, agent chain

**Bundled harness**:
A harness that ships inside the app. Opening one always makes an editable copy; the original is never changed. Some show one pattern: a minimal agent-plus-review loop, or a harness modelled on a published project (DeepSeek, Matt Pocock skills); their description cites the source. The label "Example harness" is retired in the UI; the code keeps `example` in identifiers and the `/bundles/examples` route.
_Avoid_: example harness (as a UI label), built-in template, snapshot, default sample, demo

**Agile Harness**:
The bundled harness for Agile/Scrum/Kanban delivery, adapted from the skills-framework `engineering/harness` project. The first harness listed in Starting points.
_Avoid_: OHarness Agile, the framework, skills-framework (as a product label)

**Starting points**:
The Studio overview section that lists the Agile Harness and the other bundled harnesses.
_Avoid_: templates, gallery, samples

**Saved harness**:
A harness the person keeps on this device. A **draft** is a harness that has not been saved yet.
_Avoid_: project, document, file (except the `.ohm` file itself)

### Flow pieces (canvas)

**Node**:
One piece placed on the canvas (an Agent, Gate, HITL, Skill, or Connector). Connected by edges that carry Signals.
_Avoid_: block, box, widget

**Step**:
One Node's turn inside a run or a simulation plan. A Node is authored; a Step is executed.
_Avoid_: stage (reserved for the chat view), task

**Agent**:
A role-bound actor with a profile, exit signals, and optional provider/tool bindings (e.g. PO, BE, QA).
_Avoid_: LLM node, worker, bot

**Gate**:
A blocking checkpoint with checklist, PASS/FAIL exits, and routing (e.g. Stop-the-Line, QA Gate).
_Avoid_: if-node, router, evaluator (as the primary name)

**HITL**:
The human authority piece — merge, Sprint Goal confirmation, acceptance. Distinct from Agent.
_Avoid_: human-in-the-loop node as a generic Agent, approval widget

**Skill**:
A named capability an Agent may invoke or that may appear as a canvas node (e.g. `tdd`, `hallmark`).
_Avoid_: plugin, prompt pack (unless referring only to content)

**Token ceiling**:
The most tokens one run may use. A run that reaches it stops with the explicit status `budget_exceeded`; a context compaction is reported with its tokens before and after.
_Avoid_: quota, limit (ambiguous with the global USD budget)

**Signal**:
A typed exit-state on an edge (e.g. `"Ready for QA"`). Agents and Gates emit and consume Signals; they do not call each other directly.
_Avoid_: unlabeled edge, message, event (unless domain event elsewhere)

### Connections

**McpServer**:
A connector that exposes MCP tools/resources to bound Agents.
_Avoid_: tool node as synonym for MCP

**Tool**:
A native (non-MCP) capability an Agent may call (HTTP, shell, repo, …).
_Avoid_: function, action

**Connector**:
Either an McpServer or a Tool in the Connections dock.
_Avoid_: integration, plugin

**Hook**:
A program the person registers in the sidecar (never taken from a workspace). Before a tool runs, each hook that names the tool must exit 0; an error or a timeout blocks the tool and the run records the hook id. A hook can only veto, never approve.
_Avoid_: plugin, callback

### Providers

**Provider**:
A registered LLM backend (cloud or local) with credentials. Agents and Skills bind **1..N** Providers (primary + fallbacks; optional task routing).
_Avoid_: wallet, model host, adapter (UI copy — adapter remains an internal runtime term)

### Chat and runs

**Permission mode**:
How much a chat may do on its own, one of Plan, Read-only, Ask, Auto, Workspace write, Full. Per conversation, enforced by the sidecar, never a bypass.
_Avoid_: access level, safe mode, YOLO

**Needs action**:
The group in the chat's model picker for connections that cannot answer yet, each with the one step that fixes it, in the same words as Providers.
_Avoid_: unavailable list, broken providers

**Queue**:
Messages typed while a turn runs; they run after it, in order. A turn that stops or fails pauses the queue.
_Avoid_: backlog, pending messages

**Subagent**:
A task the model hands to a child run during a turn. Each child can be cancelled alone.
_Avoid_: worker, thread

**Turn diff**:
The files a turn changed in the workspace, each with its own one-time revert.
_Avoid_: undo all, changeset

**Token ceiling**:
The token total at which a run stops with the status Budget exceeded.
_Avoid_: budget (as a field label), limit

**Activity**:
The list of every run, wherever it started, with Continue as a new run for an interrupted one.
_Avoid_: history log, executions

### Assistant and places

**Nilo**:
The OHarness assistant: it drafts harnesses in Studio and answers in chat. Not a role in the crew.
_Avoid_: Copilot (a Microsoft brand; never in UI copy, docs or examples), AI assistant, bot

**Turn diff**:
The list of files a turn changed in the Workspace, with the diff of each. Reverting restores one file to how it was before the turn and never touches another; it refuses a file that changed again afterwards.
_Avoid_: undo (that word is for Studio edits), patch

**Subagent**:
A helper Nilo starts for one task during a turn. It answers once, has no tools of its own and cannot start others. Cancelling one subagent leaves the turn and its siblings running; stopping the run ends all of them.
_Avoid_: worker, child agent (in UI copy), Agent (that is a crew role)

**Studio**:
The place where a person designs a harness: overview, canvas, inspector.
_Avoid_: designer, builder

**Workspace**:
The folder on this device that a chat's tools read and run commands in.
_Avoid_: project, repo, cwd

## Copy standard

Every user-facing string follows the terms above: UI, dialogs, menus, README, and the `name`/`description` of every bundled harness. A description may cite the project a harness is modelled on (`skills-framework`, `deepseek-ai/deepseek-harness`, `mattpocock/skills`); the product label stays a harness. Code identifiers may keep older words; only text a person reads is bound by this standard.

| Retired wording | Say instead |
|---|---|
| "OHarness Agile (skills-framework)", "OHarness Agile", "the framework" | Agile Harness |
| "Sample: Agent + review", "OHarness sample", "Open sample" | Agent + review (Bundled harness) |
| "skills-framework · bundled snapshot" | Bundled harness |
| "Open framework", "Open copy", "Open sample" | Open harness (same label on every starting point) |
| "Open example" (menu) | Open bundled harness |
| "Open preset", "Open example harness" (command palette) | Open bundled harness |
| "Example harness" (card label) | Bundled harness |
| "Copilot" in UI text | Nilo |
| "Wallet" in UI text | Providers |

## Dogfood

The Agile Harness (adapted from skills-framework `engineering/harness`) is the proving harness: if OHM pieces cannot rebuild it, the catalog is wrong.
