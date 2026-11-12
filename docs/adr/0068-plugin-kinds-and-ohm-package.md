# ADR 0068 — Dois tipos de plugin e o `.ohm` de pacote

Status: aceita por decisão do dono na issue #441 (2026-11-06). Complementa [ADR 0002](0002-ohm-model.md), [ADR 0003](0003-ohm-yaml.md) e [ADR 0067](0067-forja-name-and-ohm-format.md). Esta fatia só registra a decisão: não altera o codec, a tela nem o host.

## Contexto

"Plugin" nomeia duas coisas no mercado de agentes de código. Um pacote de harness (mattpocock/skills, skills-framework, superpowers, claude-mem) reúne agentes, skills, scripts, hooks, comandos, MCP e instruções. Código que estende um host Node, no estilo do DeepSeek Harness, é outra.

O Studio já grava um harness como OHarness Model (`.ohm`): YAML 1.2 restrito na autoria, JSON ainda importável, um único modelo normalizado (ADR 0003). Esse modelo é o `HarnessBundle` em `backend/oharness` (`models.py`, `codec.py`). Em `main` não há pasta `ohm/` nem árvore `.openharness` com `AGENTS.md` e `SKILL.md`. O que existe é o compilador `compile_skills_harness`: ele lê um diretório de harness (`SKILL.md`, `agents/*.md`, `HOOKS.md`, documentos de processo, `scripts/`) e preenche o bundle.

## Decisão

### 1. Vocabulário fixo

- **Plugin** é um pacote de harness: agentes, skills, scripts, hooks, comandos, MCP e instruções. Os exemplos nomeados são mattpocock/skills, skills-framework, superpowers e claude-mem.
- **Cordis Plugin** é código que estende um host Node, no estilo do DeepSeek Harness. Não é um Plugin. Manifesto, host e criação ficam para as fatias seguintes.
- **`.ohm`** é o formato do Studio para desenhar um harness e exportá-lo, inclusive como Plugin. É a camada que diz como tarefas e pedidos são atendidos, por cima de Claude, Codex ou DeepSeek Harness. Continua um documento só (ADR 0003): exportar é projetar esse documento, não criar um segundo modelo.

Um Skill, um Hook e um Connector não são um Plugin. A definição da Forja usa o mesmo codec (ADR 0067) e também não é um Plugin.

### 2. O que um `.ohm` de pacote contém

O bundle que o código já valida (`schemaVersion`, `manifest`, `graph`, `content`, `runtime`, `validation`) é o pacote. Cada peça cai num lugar que o código já tem, ou fica explícita como ainda sem campo:

| Peça | Onde o código já guarda | Decisão |
| --- | --- | --- |
| Agentes | `content.agents`; nós `type: agent` | Entram no pacote. |
| Skills | `content.skills`; nós `type: skill` | Entram no pacote. |
| Scripts | `content.scripts` | Entram no pacote. |
| Hooks | `content.hooks` (o compilador grava o texto de `HOOKS.md`) | Entram como esse texto. O Hook do glossário — programa do sidecar que só veta — não muda de lugar e não vira Plugin. |
| Comandos | `content.commands` (o compilador reserva o mapa; pode estar vazio) | Entram no pacote. |
| MCP | nó `type: mcp`, com `data.connectorIds`, `data.mcpCommand` e `data.mcpUrl` | Entra como Connector (ADR 0002). Não há chave `content.mcp`. |
| Instruções | `content.prompts` e `data.systemPrompt` | Entram no pacote. Não há chave `content.instructions`. |
| Alvos | não há campo | O pacote declara os alvos que serve. O campo ainda não existe no codec; criá-lo é fatia de código. |
| Modelos aceitos | `data.providerIds` (o primeiro é o primário, os demais são fallback), `data.providerRoutes`, e `data.model` quando o autor fixa um modelo | São os vínculos de Provider da ADR 0002. `runtime.preferred` é o modo de execução, não a lista de modelos. |

Credencial não viaja no pacote. A composição do bundle a partir do canvas já omite `apiKey` e conserva só `secretRef` opaco. Provedores e a via de assinatura ficam fora de qualquer Plugin e de qualquer Cordis Plugin.

### 3. Como cada alvo recebe

O Studio recebe o `.ohm` como já recebe hoje: o codec lê o documento e o canvas o edita.

A exportação como Plugin não existe no código. Quando existir, projeta o mesmo bundle:

- **Claude Code** é o primeiro alvo, no layout que o dono nomeou na #441: diretório `.claude-plugin/` com skills, agents, commands, hooks e `.mcp.json`. Este ADR não conferiu esse layout na documentação da Claude. A fatia que gravar os arquivos confere a fonte primária antes.
- **Codex** e **Cursor**: o formato nativo do pacote não foi verificado. Este ADR não promete exportação para eles.
- **DeepSeek Harness**, como alvo de um Plugin (pacote de harness): o diretório nativo não está decidido. Instalar um Cordis Plugin é outra decisão e não cabe aqui.

## Em aberto

- Nome e forma do campo de alvos no codec.
- Conferência do layout `.claude-plugin/` em fonte primária, antes de qualquer exportador.
- Formatos nativos de Codex e de Cursor.
- Diretório de instalação de um Plugin (pacote de harness) no DeepSeek Harness.
- Cordis Plugin: host, manifesto, criação e compartilhamento.

## Fora desta fatia

Tela de Plugins, importador, exportador, host Node, telas de Cordis Plugin, criação por chat e a auditoria das regras de fluxo.

## Consequências

O glossário (`CONTEXT.md` é a fonte; `docs/GLOSSARY.md` é a versão curta) separa Plugin, Cordis Plugin e `.ohm`. O codec permanece o da ADR 0003. Quem implementar a exportação lê o bundle e projeta; não inventa um segundo documento.
