# Usage guide

OHarness has three destinations: **Chats** (`Alt+1`), **Studio** (`Alt+2`) and **Providers** (`Alt+3`). `Mod+K` opens the command palette and `?` lists every shortcut. Terms are defined in the [glossary](GLOSSARY.md).

## First run

1. Open **Providers** and connect one provider ([table below](#providers)).
2. Open **Chats** and talk to Nilo, the OHarness assistant. Nilo answers what it can and starts the loaded harness when the request needs the crew.
3. Open **Studio** to see or change the harness.

## Chats

- Pick the provider and model with the composer chip, which reads `{connection} · {model}`. **Auto** uses the first eligible connection, cloud before on-device. The list is grouped by connection, with a search ("Find a model"). `Enter` saves the model as that connection's default; `Shift+Enter`, or "This chat only" in the list, applies it to the open chat alone (the chip then says so). Connections that cannot answer yet appear under **Needs action**, nearest to ready first, each with one step ("Turn on", "Replace key", "Copy `ollama serve`"). Choosing one opens it in Providers; when nothing can answer, the composer shows the same step as a button. A local model that is not downloaded reads "Model not pulled" with a "Copy `ollama pull …`" step. Setup stays on Providers.
- The **harness** chip next to it chooses which harness runs this chat (or "No harness" to talk to the model directly). It applies from your next message; earlier replies keep the harness that wrote them. **Edit in Studio** opens the harness in use.
- Pick the **workspace** with the other chip: the folder the chat's tools read and run commands in. With no folder, tools use a scratch directory.
- **Queue**: type while a turn is running and press `Mod+Enter` (or Queue): the message waits in a visible list above the composer and runs after the current turn, one at a time, in order. Remove one with its button. If the turn stops or fails the queue pauses; Send next or Clear queue decides. Commands (`/exec`, `/read`) wait for the turn to finish.
- **Subagents** (off by default): turn it on and the model can hand tasks to child runs, up to four per run. The chat shows Nilo and each child with its state; **Cancel** stops one child and leaves the rest running.
- **Token ceiling** (no harness): a number in the toolbar. A run that reaches it stops with the status **Budget exceeded**. An invalid entry keeps the last valid ceiling and says so.
- **Files this turn changed**: after a turn in a workspace, the chat lists the files it changed with a diff and a one-time **Revert** per file. A file edited after the turn is left alone.
- Chat tools: `/exec` (run a command), `/read`, `/ls`. They run in the sidecar, never in the UI.
- **Permission mode** (the preset) is per conversation, always visible beside the composer, and `Shift+Tab` cycles Ask, Auto and Plan. The six modes come from one table, [`backend/sandbox/permission_modes.json`](../backend/sandbox/permission_modes.json); the UI keeps a byte-identical copy that a test checks:

| Mode | Behaviour |
| --- | --- |
| Ask (default) | Every `/exec` waits for your approval. |
| Auto | A fixed allowlist runs without asking (read-only `git`, `ls`, `pwd`); in a workspace you marked trusted, also `npm`/`pnpm` test and run scripts and `pytest`. Anything else still asks. |
| Plan | `/exec` is refused; reading still works. The turn ends in a plan card (Approve plan, Discard plan). Nothing runs until you approve; approving moves the chat to Ask and sends the plan as the next turn. The chat cannot leave Plan while a plan waits. With a harness on, Plan mode answers directly and the harness runs after approval. |
| Read-only | Listings and read-only `git` run on their own. Any command that could write is refused, and the chat shows the command and the reason. |
| Workspace write | `mkdir`, `touch`, `cp` and `mv` run without asking when every path stays inside the workspace. A path outside it, or any command Nilo cannot check, asks. |
| Full | Commands run without asking, inside and outside the workspace. High-risk commands, and commands that name a secret file, still ask. Choosing it needs a confirmation, and `Shift+Tab` never lands on it. |

  Reading a path that holds a secret always asks. The exact policy is in [`backend/sandbox/permission.py`](../backend/sandbox/permission.py).
- **Tool hooks** (composer, *Tool hooks*): register a program that must exit 0 before a tool runs. If it fails or takes longer than its timeout (1 to 10 seconds), the tool does not run and the tool card says which hook blocked it. A hook runs without a shell and without your secrets, only ever vetoes (it cannot approve a command), and is stored by the sidecar, never read from a workspace. Edit changes a hook in place; a stored hook that no longer validates blocks every tool until you remove it and register it again. A simulated (mock) run starts no hook; the tool card says it was not run.
- **Turn diff**: when a turn changes files in the workspace, the run detail lists them with `+/−` counts and a diff you can open. **Revert** restores one file to how it was before the turn and leaves the others alone. It refuses (and says why) when the file changed again afterwards, when a link sits on its path, or when the folder is gone; binary and very large files are listed but cannot be reverted, except a file the turn created, which is deleted. Files named like secrets are never tracked. A run reopened from history shows which files were already reverted.
- Run history is stored locally and survives a restart; an interrupted run is marked as such ([details](product/durable-run-history.md)). **Activity** lists every run; open an interrupted one and choose **Continue as a new run** to start a linked run from its saved events (the original never changes).

## Studio

Studio is where you design a harness: overview, canvas, inspector.

- **Starting points** lists the Agile Harness and the other bundled harnesses. **Open harness** always makes an editable copy; the bundled original never changes.
- The editor bar shows the harness name, its origin (Bundled harness, Draft or Saved harness) and unsaved changes.
- Actions: New, Open bundled harness, Import, Export (`.ohm`), Save (`Mod+S`), Save as…, Discard, Delete (both confirm), and **Use in chat** to make the open harness the one Chats runs.
- **Ask Nilo** (`Mod+I`) opens a panel where you describe a flow and Nilo proposes graph edits. Keep or Undo the proposal; it is one undoable step and is validated before it reaches the canvas. With no ready provider, an offline planner answers and the result is tagged *Offline draft*.
- `Mod+Enter` runs the harness; `Mod+Shift+M` cycles the execution mode (mock or live).
- Import and Export currently read and write JSON text inside the `.ohm` file; see [YAML migration](product/ohm-yaml-migration.md).

## Providers

Providers (`Alt+3`) lists your connections on the left and opens one on the right. On a narrow window the list is the screen: pick a connection to open it, and use **Providers** at the top to come back. Each connection shows one status word and, when something is missing, one button that fixes it (paste a key, turn on, choose a model, copy `ollama serve`, open billing, sign in). Under it, **Connection** holds the key, the endpoint and the on/off switch; **Models** holds the default model, with a filter for long lists; **Activity** shows the last tests and the spend.

- **Add a key.** Paste it into the key field and press **Save key**. It is stored by the sidecar and never shown again; you see its prefix and last four characters.
- **Remove a key.** **Remove** asks first, with **Cancel** selected.
- **Sidecar not running.** A notice says so, with **Retry**; the rows then read "Can't check" instead of guessing.
- **Language.** The Providers screen is in English and Brazilian Portuguese. It follows the browser language; `Mod+K`, then "Language", switches it. The rest of the app is still English.

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

## Design system

The interface follows a documented design system: tokens, the brand book, a page per component family, a screen audit and a runnable reference. Start at [`docs/design-system/README.md`](design-system/README.md).
