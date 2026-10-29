# Glossary

Short reader's version of [`CONTEXT.md`](../CONTEXT.md), which is the source of truth; if they differ, `CONTEXT.md` wins.

Two rules shape every word below:

- **Everything is a harness.** What the product ships, shows or opens is a harness, never a framework, template, preset, sample or example. The bundled ones are **Bundled harnesses**.
- **The assistant is Nilo.** Nilo greets, drafts harnesses in Studio and answers in chat. Nilo is not a role in the crew and is never called Copilot, AI assistant or bot.

| Term | Meaning |
| --- | --- |
| **OHarness Model (OHM)** | The portable document (`.ohm`) that describes a harness: graph, content, connectors, runtime. |
| **Harness** | Agents, Gates, HITL, Skills and Signals composed to orchestrate work. |
| **Bundled harness** | A harness that ships in the app. Opening it makes an editable copy. The Agile Harness is the first one. |
| **Starting points** | The Studio overview section listing the bundled harnesses. |
| **Saved harness / draft** | A harness kept on this device / one not saved yet. |
| **Node, Step** | A Node is a piece on the canvas; a Step is one Node's turn in a run. |
| **Agent** | A role-bound actor (PO, BE, QA…). |
| **Gate** | A blocking checkpoint with PASS/FAIL routing. |
| **HITL** | The human authority piece (merge, acceptance); not an Agent. |
| **Skill** | A named capability an Agent may invoke. |
| **Signal** | A typed exit state on an edge. |
| **Connector** | An McpServer or a Tool in the Connections dock. |
| **Hook** | A program you register that must exit 0 before a tool runs. An error or a timeout blocks the tool, and the run records which hook decided. |
| **Provider** | A registered LLM backend with credentials (shown on Providers). |
| **Workspace** | The folder on this device a chat's tools read and run in. |
| **Studio, Chats, Providers** | The three destinations of the app. |
| **Nilo** | The OHarness assistant. |

Code may keep older words (`example` in the `/bundles/examples` route, `copilot` in some module names); only text a person reads follows this glossary. Retired UI wording is mapped in the Copy standard of `CONTEXT.md`.
