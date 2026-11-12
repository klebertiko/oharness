# Exportação para Claude Code

Um `.ohm` continua um documento só. Exportar para Claude Code projeta o mesmo bundle; não cria um segundo modelo.

A conferência em [Create a plugin](https://code.claude.com/docs/en/plugins/create) e no [manifesto](https://code.claude.com/docs/en/plugins/manifest-reference) (2026-11-12) corrige o layout citado na issue: só `plugin.json` fica em `.claude-plugin/`. Skills, agents, commands, hooks e `.mcp.json` ficam na raiz do plugin. Componente dentro de `.claude-plugin/` não carrega.

| Peça do bundle | Arquivo |
| --- | --- |
| `manifest` | `.claude-plugin/plugin.json` (`name` em kebab-case, a partir do `id`) |
| `content.skills` e `content.prompts` | `skills/<nome>/SKILL.md` |
| `content.agents` e `data.systemPrompt` de nó `agent` | `agents/<nome>.md` |
| `content.commands` | `commands/<nome>.md` |
| `content.scripts` | `scripts/<nome>` |
| `content.hooks` em texto | `hooks/<nome>.md` (prosa do harness; não é hook de ciclo de vida) |
| `content.hooks` com mapa `hooks` | `hooks/hooks.json` |
| nó `type: mcp` | `.mcp.json`, chave `mcpServers` |

Credencial não sai no pacote: `apiKey`, senha na URL e `runtime.secrets` não são gravados. Um nó MCP sem comando e sem URL não vira servidor. Codex e Cursor não são alvo desta projeção.

A função é `export_claude_code_plugin` em `backend/oharness/claude_plugin_export.py`. O destino ainda não pode existir.
