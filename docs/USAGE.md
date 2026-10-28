# Usage guide

OHarness has three destinations: **Chats** (`Alt+1`), **Studio** (`Alt+2`) and **Providers** (`Alt+3`). `Mod+K` opens the command palette and `?` lists every shortcut. Terms are defined in the [glossary](GLOSSARY.md).

## First run

1. Open **Providers** and connect one provider ([table below](#providers)).
2. Open **Chats** and talk to Nilo, the OHarness assistant. Nilo answers what it can and starts the loaded harness when the request needs the crew.
3. Open **Studio** to see or change the harness.

## Chats

- Pick the provider with the composer chip. **Auto** uses the first eligible connection, cloud before on-device. Setup stays on Providers.
- Pick the **workspace** with the other chip: the folder the chat's tools read and run commands in. With no folder, tools use a scratch directory.
- Chat tools: `/exec` (run a command), `/read`, `/ls`. They run in the sidecar, never in the UI.
- **Permission mode** (the preset) is per conversation, always visible beside the composer, and `Shift+Tab` cycles Ask, Auto and Plan. The six modes come from one table, [`backend/sandbox/permission_modes.json`](../backend/sandbox/permission_modes.json); the UI keeps a byte-identical copy that a test checks:

| Mode | Behaviour |
| --- | --- |
| Ask (default) | Every `/exec` waits for your approval. |
| Auto | A fixed allowlist runs without asking (read-only `git`, `ls`, `pwd`); in a workspace you marked trusted, also `npm`/`pnpm` test and run scripts and `pytest`. Anything else still asks. |
| Plan | `/exec` is refused; reading still works. |
| Read-only | Listings and read-only `git` run on their own. Any command that could write is refused, and the chat shows the command and the reason. |
| Workspace write | `mkdir`, `touch`, `cp` and `mv` run without asking when every path stays inside the workspace. A path outside it, or any command Nilo cannot check, asks. |
| Full | Commands run without asking, inside and outside the workspace. High-risk commands and secret files still ask. Choosing it needs a confirmation, and `Shift+Tab` never lands on it. |

  Reading a path that holds a secret always asks. The exact policy is in [`backend/sandbox/permission.py`](../backend/sandbox/permission.py).
- Run history is stored locally and survives a restart; an interrupted run is marked as such ([details](product/durable-run-history.md)).

## Studio

Studio is where you design a harness: overview, canvas, inspector.

- **Starting points** lists the Agile Harness and the other bundled harnesses. **Open harness** always makes an editable copy; the bundled original never changes.
- The editor bar shows the harness name, its origin (Bundled harness, Draft or Saved harness) and unsaved changes.
- Actions: New, Open bundled harness, Import, Export (`.ohm`), Save (`Mod+S`), Save as…, Discard, Delete (both confirm), and **Use in chat** to make the open harness the one Chats runs.
- **Ask Nilo** (`Mod+I`) opens a panel where you describe a flow and Nilo proposes graph edits. Keep or Undo the proposal; it is one undoable step and is validated before it reaches the canvas. With no ready provider, an offline planner answers and the result is tagged *Offline draft*.
- `Mod+Enter` runs the harness; `Mod+Shift+M` cycles the execution mode (mock or live).
- Import and Export currently read and write JSON text inside the `.ohm` file; see [YAML migration](product/ohm-yaml-migration.md).

## Providers

| Vendor | Connects through |
| --- | --- |
| Anthropic | Local `claude` CLI (`claude login`); chat only, tools disabled |
| OpenAI | Local `codex` CLI (`codex login`); shell commands in a read-only sandbox |
| OpenRouter | API key |
| Ollama | Local daemon (default `http://127.0.0.1:11434/v1`); Ollama Cloud is a separate connection |
| Cursor | Local `cursor-agent` CLI; agent-only, on Windows through WSL2 |

A node can pin an ordered list of providers; if one rejects the call the next is tried and the attempts appear in the run transcript. If nothing resolves the run stops at that node with an error and never swaps providers silently ([rule](product/provider-harness-rule.md)). API keys are stored by the sidecar's secrets store, never by the Tauri shell.

## Workspaces

A workspace is a folder on this device. Add one from the workspace chip in Chats. Trusting a workspace (needed for Auto to run project scripts) is a separate, explicit step with a warning, and you can revoke it in one click.
