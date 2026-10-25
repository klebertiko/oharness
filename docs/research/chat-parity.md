# Paridade do chat agêntico: densidade de informação por passo

Pesquisa feita em 2026-10-10. Base do OHarness: `main` @ `a96eeff`.

**Pergunta.** O que os apps desktop de referência (DeepSeek Harness desktop, Claude desktop na aba Code, Cursor desktop e Codex app) mostram sobre o que o agente está fazendo, a cada passo e a cada turno, que o chat do OHarness não mostra ou mostra mal?

**Recorte.** A reclamação é de **densidade de informação**. O OHarness já mostra o harness passo a passo, via `RunLadder`, `Transcript`, `ToolCard`, `Gate` e `rollup` em `frontend/src/components/agent-run/`. Por isso a matriz começa pelo que aparece em cada passo e em cada turno. Os recursos de interação vêm depois.

Dois itens já estão sendo implementados por outros agentes e só aparecem listados aqui: o resumo de atividade ("Ran N commands") e os modos de permissão.

**Regras usadas.**
- Cada célula cita uma fonte primária, com código-fonte ou documentação oficial do app desktop.
- Doc de CLI ou IDE só entra quando descreve o mesmo recurso no desktop, e isso fica dito na célula.
- O que não consegui verificar está marcado **?** (não verificado). Essas células não foram preenchidas por suposição.

## Legenda

| Marca | Significado |
|---|---|
| ✅ | tem |
| ◐ | parcial |
| ✗ | não tem |
| ? | não verificado em fonte primária |

Na coluna OHarness, cada lacuna recebe uma de três classes:
- **[evento]**: o dado já chega do backend e só não é renderizado.
- **[backend]**: o backend não emite o dado.
- **[UI]**: o backend já suporta e falta só a interface.

## Fontes

### DeepSeek Harness desktop (DSH)

**[D1] Código-fonte.** `C:\Users\klebe\DeepSeekHarness\deepseek-harness` @ `b150a55` (2026-08-21), upstream https://github.com/deepseek-ai/deepseek-harness. A UI fica em `packages/client/*`. Os caminhos citados abaixo são relativos a `packages/client/`.

**[D0] Build desktop instalado.** `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar` é um app Electron, canal `nightly` segundo `resources/app-update.yml`, publicado pela Hangzhou DeepSeek AI.

O bundle contém os identificadores `QueueDock`, `ContextMeter`, `TodoPanel`, `DiffBlock`, `ReasoningRow`, `SubagentHeaderLineage`, `contextPressure`, `MessageIconActions`, `CompactionItem`, `PlanReviewPanel`, `ApprovalPanel`, `TerminalBlock` e `GoalBar` (contagem com `grep -a -c`). Isso confirma que o desktop entrega a mesma UI de [D1].

Dois identificadores **não** aparecem no bundle por nome: `StatsLine` e `interrupt_receipt`. `TrajectoryView` aparece com contagem baixa. As células que dependem de `StatsLine` dizem "fonte; não confirmado no bundle".

A fixture `backend/oharness/fixtures/deepseek-harness.ohm` do OHarness cita a release `dsh-v0.2.1-alpha.2`. O checkout local é mais antigo (tag `dsh-v0.1.1-rc.2`).

### Claude desktop (aba Code)

- **[A1]** https://code.claude.com/docs/en/desktop. É a referência da aba Code. Seções usadas: "Transcript view", "Review changes with diff view", "Check usage", "Watch background tasks", a tabela "Feature comparison" e a nota de notificações.
- **[A2]** https://code.claude.com/docs/en/checkpointing. A página documenta `/rewind` e `Esc Esc`. É doc da CLI, e a página do desktop [A1] não menciona rewind.

### Codex app

As páginas de `developers.openai.com/codex/...` redirecionam (308) para `learn.chatgpt.com/docs/...`. A doc trata o app como parte do "ChatGPT desktop app".

- **[X1]** https://learn.chatgpt.com/docs/code-review?surface=app
- **[X2]** https://learn.chatgpt.com/docs/prompting?surface=app
- **[X3]** https://learn.chatgpt.com/docs/notifications
- **[X4]** https://learn.chatgpt.com/docs/long-running-work
- **[X5]** https://learn.chatgpt.com/docs/integrated-terminal
- **[X7]** https://learn.chatgpt.com/docs/app
- **[X6]** https://github.com/openai/codex @ `c3d3b14`, `sdk/typescript/src/items.ts`. É o schema dos eventos de `codex exec --json`, ou seja, CLI/SDK e não o app. Entra aqui só para mostrar o que o adapter do OHarness descarta.

### Cursor desktop

- **[U1]** https://cursor.com/help/ai-features/agent
- **[U2]** https://cursor.com/docs/agent/overview
- **[U3]** https://cursor.com/changelog/1-2
- **[U4]** https://cursor.com/changelog/1-6
- **[U5]** https://cursor.com/docs/agent/agents-window
- **[U6]** https://cursor.com/docs/agent/tools/terminal

### OHarness

Código em `main` @ `a96eeff`. Os caminhos citados na matriz são relativos à raiz do repo.

## Matriz 1: o que aparece por passo e por turno (foco)

| # | Recurso | DSH desktop | Claude desktop (Code) | Cursor desktop | Codex app | OHarness hoje |
|---|---|---|---|---|---|---|
| 1 | **Comando executado com saída e exit code** | ✅ toolview de bash com a saída via `TerminalBlock`, linha recolhível; em erro, a primeira linha da falha aparece em cor de erro (`ui-tool/src/client/tool/toolviews/bash-sample.tsx`) [D1, D0] | ◐ o modo **Verbose** mostra "every tool call, file read, and intermediate step"; o **Normal** recolhe as tool calls em resumos [A1]. Exit code: ? | ◐ o Agent "runs terminal commands" e mostra saída inline [U1, U6]. Exit code: ? | ? o terminal integrado existe, mas a página não diz como os comandos do agente aparecem no thread [X5] | ◐ ver detalhe 1 abaixo |
| 2 | **Arquivos lidos e editados, com diff** | ✅ `file-mutation-row.tsx` mostra edit/write com o diff aplicado em `DiffBlock`; `read-row.tsx` mostra leituras [D1, D0] | ✅ indicador `+12 -1`, diff por arquivo, comentários por linha; no modo Manual, aceitar ou rejeitar cada mudança [A1] | ✅ "Review them in the diff view and reject" [U1]; "New diffs view" [U5] | ✅ painel de review com escopos Unstaged/Staged/Commit/Branch/**Last turn**, stage e revert por arquivo ou hunk, comentários inline [X1] | ✗ ver detalhe 2 abaixo |
| 3 | **Raciocínio (thinking)** | ✅ `ui-conversation/src/client/chat/ReasoningRow.tsx` [D1, D0] | ✅ modo de transcrição **Thinking** [A1] | ? | ? | ◐ ver detalhe 3 abaixo |
| 4 | **Ação atual ao vivo** | ✅ a linha da tool em andamento mostra um "running sweep" (`ui-tool/.../components/ToolRow.tsx`) [D1] | ? | ? | ? | ◐ ver detalhe 4 abaixo |
| 5 | **Tempo por passo e por turno (duração, TTFT, tok/s)** | ✅ `MessageIconActions.tsx` mostra "Ran for", TTFT e tok/s por turno [D1, D0]. Tempo de LLM e de tool por janela em `StatsLine.tsx` (fonte; não confirmado no bundle) | ? | ? | ? | ◐ ver detalhe 5 abaixo |
| 6 | **Tokens e custo por passo** | ◐ tokens e duração por subagente em `ui-subagent/.../SubagentHeaderLineage.tsx` [D1, D0]. Custo: ? | ◐ anel de uso com contexto e plano por sessão [A1]. Por passo: ? | ? | ? | ◐ ver detalhe 6 abaixo |
| 7 | **Modelo usado em cada passo** | ? | ? (a CLI mostra o modelo por mensagem com `Ctrl+O`, mas isso é CLI) | ? | ? | ✅ cabeçalho do segmento `type · model\|\|adapter`; badges de pinned e failover em `NodeBreakdown` (`Transcript.tsx` ~240, ~470). Ver detalhe 7 |
| 8 | **Plano e to-do do agente com progresso** | ✅ `ui-conversation/.../skeleton/TodoPanel.tsx` (faixa acima do composer), `ui-plan/.../PlanModeControl.tsx`, `ui-user-questions/.../PlanReviewPanel.tsx` [D1, D0] | ◐ existe um painel "plan" entre os painéis da aba Code [A1]. Checklist de to-do no desktop: ? | ✅ "structured task lists", revisadas conforme o trabalho avança [U3] | ◐ `/plan` [X2] e uma linha de progresso do goal "above the composer" [X4]. To-do: ? | ◐ ver detalhe 8 abaixo |
| 9 | **Atividade de subagentes** | ✅ linhagem com tokens e duração, mais composer read-only do filho (`ui-subagent/*`) [D1, D0] | ✅ o painel **tasks** lista subagentes e shells em background; clicar mostra a saída ou para [A1] | ◐ "spin up specialized subagents" [U1]. Exibição: ? | ? | ✗ não há conceito de subagente nos eventos (os nós do harness são o análogo) **[backend]** |
| 10 | **Erros e retries** | ◐ linha de erro com a primeira linha em cor de erro (`ToolRow.tsx`) [D1]. Retry: ? | ? | ? | ? | ◐ ver detalhe 10 abaixo |
| 11 | **Medidor de contexto e compactação** | ✅ anel `ContextMeter.tsx` com breakdown sistema/tools/mensagens; `CompactionItem.tsx` [D1, D0] | ✅ anel de uso ao lado do seletor de modelo; resumo automático e `/compact` [A1] | ◐ resumo automático ao atingir o limite e `/summarize` [U4]. Medidor: ? | ? | ✗ ver detalhe 11 abaixo |
| 12 | **Resumo de atividade ("Ran N commands")** | ◐ árvore de tool calls `ui-tool/.../ToolCallTree.tsx` [D1] | ✅ o modo Normal recolhe as tool calls em resumos [A1] | ? | ? | **em implementação (outro agente)** |
| 13 | **Resposta final em markdown, com blocos de código** | ✅ `ui-conversation/.../AssistantMarkdown.tsx` [D1] | ? | ? | ? | ✗ texto puro com `whitespace-pre-wrap` (`frontend/src/components/agent/AgentStage.tsx:308-315`) **[UI]** |

### Detalhes da coluna OHarness

**1. Comando com saída e exit code.**
- `ToolCard.tsx` mostra argv, exit code, "saída truncada", redações e a saída expansível. Mas só aparece para chamadas do broker: approval, denied, simulated ou origin (`Transcript.tsx:105`).
- O `ToolRow` genérico mostra só nome, args, resultado truncado numa linha e a duração. `exitCode`, `truncated`, `timedOut` e `redactions` estão em `ToolCall` (`types.ts:28-32`) e não são renderizados ali. **[evento]**
- Nos adapters CLI, os comandos nem chegam como evento. `cli_codex._parse_jsonl` guarda só `agent_message` e descarta os itens `command_execution`, que trazem `command`, `aggregated_output` e `exit_code` [X6]. **[backend]**

**2. Arquivos lidos e editados.**
- `read` mostra o path. Não existe tool de edição: as capabilities são `discover`, `read` e `exec` (`types.ts:39`).
- O `cli_codex` descarta os itens `file_change` (`path`, `kind`) [X6]. **[backend]**

**3. Raciocínio.**
- O bloco `Reasoning` existe e recolhe ao fim do nó (`Transcript.tsx:162`).
- Nenhum adapter real emite `{"kind":"reason"}`, só o `mock.py`. O `openai_compatible.py` não lê campos de reasoning, e o `cli_codex` descarta os itens `reasoning` [X6]. **[backend]**

**4. Ação atual ao vivo.**
- `node_phase {phase, detail}` aparece só no cabeçalho do segmento dentro do `Transcript`, que fica atrás de um toggle.
- Na tela principal, `ThinkingStatus` mostra o texto fixo "Walking the harness graph." mais tempo e tokens (`AgentStage.tsx:332-337`). Não mostra o nó, a fase, o detalhe nem a tool corrente. **[evento]**

**5. Tempo.**
- Já existem a latência por nó (`latencyMs`), a duração por tool e o `elapsed` do run com proveniência (`rollup.ts`).
- TTFT e throughput não são capturados. **[backend]**

**6. Tokens e custo por passo.**
- Já existem os tokens por nó e no rollup, com proveniência medida/estimada.
- O custo por nó existe no banco (`backend/models.py`, `UsageRecord.cost_usd` com `run_id` e `node_id`), mas não vai nos eventos. **[backend]** pequeno.
- Não há separação entre tokens de input e output: a tabela só guarda `tokens_total`. **[backend]**

**7. Modelo por passo.**
- O evento `runtime_selected {kind, name, reason}` é emitido (`backend/engine.py:367`), mas `runReducer.ts` não o trata e cai no `default`. **[evento]**

**8. Plano e to-do.**
- O `RunLadder` mostra o progresso do grafo, um plano fixo vindo do grafo e não do modelo.
- Não há to-do do modelo. O `cli_codex` descarta os itens `todo_list` [X6]. **[backend]**

**10. Erros e retries.**
- Já aparecem a caixa "fault" do `node_error`, "falhou" e "timeout" no `ToolCard`, e o `FailoverBadge`.
- Três eventos são emitidos e **ignorados** pelo `runReducer`:
  - `gate_retry {attempt, cap, target}` (`engine.py:384`)
  - `node_token_warning {tokens, limit, pct}` (`engine.py:381`)
  - `budget_warning` (`backend/routers/execution.py:254`)
- O `node_skipped.reason` também é descartado. **[evento]**

**11. Contexto e compactação.**
- Não há tokens de input por request nem janela de contexto do modelo nos eventos. **[backend]**

## Matriz 2: interação (secundária)

| # | Recurso | DSH desktop | Claude desktop (Code) | Cursor desktop | Codex app | OHarness hoje |
|---|---|---|---|---|---|---|
| 14 | **Steer e fila durante a execução** | ✅ `QueueDock.tsx`; envio com modo `'queue' \| 'steer'` (`runtime/src/client/contract/session.ts:38-43`) [D1, D0] | ✅ "type a correction and press Enter to send it without stopping the running action" [A1] | ✅ fila e **Send now** ("delivered at the agent's next tool call") [U2]; "Submit your next instruction while Agent is busy" [U1] | ✅ Steer contra Queue; fila editável e reordenável acima do composer [X2] | ✗ o composer fica `disabled={live}` (`ChatComposer.tsx:95,117`). O backend já aceita `action: "message"` (`execution.py:796`, gera `user_message`). `useRunStream.steer` existe mas nenhuma UI o chama. `RunState.steers` nunca é renderizado. **[UI]** |
| 15 | **Interromper** | ? | ✅ `Esc` ou botão stop [A1] | ✅ "Stop" [U1] | ? | ✅ botão Stop (`AgentStage.tsx` ~395) |
| 16 | **Checkpoints e rewind** | ? (só `'rewind'` como tipo de origem de contexto em `runtime/src/client/sessions/conversation-context.ts:5`; não achei UI) | ? (documentado para a CLI [A2]; ausente em [A1]) | ✅ "Restore Checkpoint" reverte arquivos e mantém a conversa [U1, U2] | ◐ revert por hunk ou arquivo no painel de review, baseado em git [X1] | ✗ **[backend]** |
| 17 | **@-menção de arquivos** | ✅ trigger `'@'` (`ui-reference/src/client/index.ts:34`) [D1] | ✅ "@mention files", com autocomplete, local e SSH [A1] | ◐ só verifiquei @-menção de side chat [U2] | ✅ "@ to add files" [X2] | ✗ **[UI]** + endpoint de listagem (o `discover` já existe) |
| 18 | **Paleta de slash** | ✅ trigger `'/'` (`ui-commands/src/client/service.ts:147`) [D1] | ✅ digitar `/` no prompt [A1] | ✅ `/summarize` [U4] | ✅ `/plan`, `/goal` [X2] | ✅ `chatCommands.ts` (new, shortcuts, skills, exec/read/ls), mas indisponível durante o run (`ChatComposer.tsx:78`) |
| 19 | **Notificações** | ? | ✅ notificação do SO quando a sessão termina e você não está nela [A1] | ? | ✅ fim de turno, permissão e pergunta, configuráveis [X3] | ✗ não há Notification API em `frontend/src` nem em `src-tauri/src` **[UI]** |
| 20 | **Copiar, retry e branch por mensagem** | ✅ copiar e branch (`ui-conversation/.../MessageIconActions.tsx`) [D1, D0] | ? | ? | ? | ✗ a mensagem só tem rótulo e conteúdo (`AgentStage.tsx:293-327`) **[UI]**. Branch e retry: **[backend]** |
| 21 | **Retomar sessão e histórico** | ? | ✅ sessões na sidebar [A1] | ? | ✅ "move between chats quickly" [X7] | ✅ `ThreadsSidebar.tsx` e replay em `HistoricalRunDetail.tsx` |
| 22 | **Tarefas em background** | ✅ lista de background jobs em `ui-jobs` [D1] | ✅ painel tasks [A1] | ✅ agentes paralelos na nuvem e worktrees [U5] | ◐ goal de longa duração [X4] | ✗ **[backend]** |
| 23 | **Modos de permissão** | ✅ `PermissionSelect.tsx` [D1, D0] | ✅ Manual, Accept edits, Plan, Auto [A1] | ✅ Run Mode [U6] | ? | **em implementação (outro agente)** |

## Backlog ranqueado: top 8 (densidade primeiro)

Os tamanhos são estimativas grosseiras: S ≤ 1 dia, M 2–4 dias, L 1 semana ou mais.

### 1. Linha de "ação atual" ao vivo no chat principal (S, só frontend)

- **O que é.** Nome do nó, fase, detalhe, tool corrente com args curtos e tempo do passo.
- **Valor.** Hoje, durante o run, a tela principal só diz "Walking the harness graph.". O usuário não sabe o que está acontecendo sem abrir o detalhe.
- **Onde encaixa.** `frontend/src/components/agent/AgentStage.tsx:332-337` (props de `ThinkingStatus`) e `frontend/src/components/brand/ThinkingStatus.tsx`. Os dados vêm de `run.plan[run.cursor]` (`label`, `phase`, `phaseDetail`, último bloco `tool` com `ok === undefined`) e `startedAt`.
- **Dependências.** Nenhuma. **[evento]**
- **DSH.** ✅ ("running sweep" em `ToolRow.tsx`).

### 2. Linha de tool completa para toda chamada (S, só frontend)

- **O que é.** Exit code, truncada, timeout, redações, saída expansível por inteiro e duração, também no `ToolRow` genérico, não só no `ToolCard` do broker.
- **Valor.** É o "comando com saída e exit code" pedido pelo usuário. O dado já está em `ToolCall` e é jogado fora na renderização.
- **Onde encaixa.** `frontend/src/components/agent-run/Transcript.tsx:85-156` (`ToolRow`) e `ToolCard.tsx:113-127`, de onde dá para extrair um `ToolOutput` compartilhado.
- **Dependências.** Combina com o resumo "Ran N commands" que está em andamento. **[evento]**
- **DSH.** ✅ (`bash-sample.tsx`, `ToolRow.tsx`).

### 3. Mostrar avisos e retries que o backend já emite (S, só frontend)

- **O que é.** `gate_retry` ("tentativa 2/3, voltou para X"), `node_token_warning` (80% do `tokenLimit`), `budget_warning`, `runtime_selected` (CLI ou API e por quê) e `node_skipped.reason`.
- **Valor.** Erros e retries passam a ficar visíveis. Hoje caem no `default: return state`.
- **Onde encaixa.** `frontend/src/components/agent-run/runReducer.ts` (novos `case`), `types.ts` (`Segment.retries`, `Segment.warnings`, `RunState.runtime`) e os chips em `Transcript.tsx` (`SegmentView`, ~237-257).
- **Dependências.** Nenhuma. **[evento]**
- **DSH.** ◐ (erro em linha; retry não verificado).

### 4. Traduzir os eventos estruturados dos adapters CLI (L, backend)

- **O que é.** Os itens de `codex exec --json` [X6] viram eventos do contrato `adapters/base.py`:
  - `command_execution` → `tool_call` / `tool_result` com `exit_code`
  - `file_change` → tool de arquivo com path e kind
  - `reasoning` → `reason`
  - `todo_list` → novo evento de plano
  - `mcp_tool_call`, `web_search` e `error` também
- **Hoje.** `cli_codex` só lê o resultado final. O `cli_claude` roda com `--tools ""` e `--output-format json`, ou seja, só chat, sem tools.
- **Valor.** É o maior ganho de densidade com provedores CLI. Hoje um passo Codex mostra só o texto final.
- **Onde encaixa.**
  - `backend/adapters/cli_codex.py` (`_parse_jsonl` e `stream`, que hoje entrega um único chunk ao final)
  - `backend/adapters/cli_shared.py` (`run_cli` teria de ler o stdout linha a linha para dar progresso ao vivo)
  - `backend/engine.py:~1000-1040` (tradução de `kind`)
  - `backend/routers/execution.py:~620-650` (caminho direct)
  - no frontend, o `runReducer` já cobre `tool_call`, `tool_result` e `node_reason`
- **Dependências.**
  - Revisão SEC, porque muda a superfície do subprocesso.
  - O evento de plano exige um tipo novo no contrato.
  - O Claude CLI com tools está fora de escopo enquanto `--tools ""` for política de segurança.
- **DSH.** ✅ nativo (o próprio loop emite tudo).

### 5. Custo, tokens in/out e TTFT por passo (M, backend + frontend)

- **O que é.** `node_done` passa a carregar `cost_usd` (já calculado em `UsageRecord`), `input_tokens`/`output_tokens` e `first_token_ms`. O `NodeBreakdown` ganha as colunas custo e TTFT, e o rodapé do turno mostra tok/s.
- **Valor.** "Tempo, tokens e custo por passo" foi pedido explicitamente. Hoje o custo existe só no banco.
- **Onde encaixa.**
  - `backend/engine.py` (emissão de `node_done`, ~1036-1100)
  - `backend/usage_tracking.py` (`record_usage`)
  - adapters: o `usage` precisa separar in/out (`claude.py:23-26`, `openai_compatible.py:51-53`)
  - `frontend/src/components/agent-run/types.ts` (`Segment`), `runReducer.ts` (`node_done`), `Transcript.tsx` (`NodeBreakdown` ~445, cabeçalho ~245)
- **Dependências.** Manter a proveniência medida/estimada que o `rollup.ts` já respeita. **[backend]**
- **DSH.** ◐ (Ran for, TTFT e tok/s por turno ✅; custo ?).

### 6. Raciocínio dos provedores HTTP (M, backend)

- **O que é.** O `openai_compatible.py` passa a emitir `{"kind":"reason"}` a partir dos campos de reasoning do delta. O frontend já renderiza (`Transcript.tsx:162`).
- **Valor.** Hoje o bloco "thinking" nunca aparece com provedor real.
- **Onde encaixa.** `backend/adapters/openai_compatible.py:~40-75` (parse do stream).
- **Dependências.** Os nomes exatos dos campos de reasoning por provedor (DeepSeek, OpenRouter etc.) **não foram verificados nesta pesquisa**. Confirmar na doc de cada provedor antes de implementar. **[backend]**
- **DSH.** ✅ (`ReasoningRow.tsx`).

### 7. Arquivos editados com diff (L, backend + frontend)

- **O que é.** Uma linha de arquivo com path e `+N −M`, mais o diff recolhível por chamada (e por turno, no estilo "Last turn" do Codex [X1]).
- **Valor.** As quatro referências têm isso. É o maior gap de confiança na hora de revisar o que o agente fez.
- **Onde encaixa.**
  - No backend, um tool de edição no broker de chat tools (`backend/routers/chat_tools.py`, capabilities em `types.ts:39`), com o diff no `tool_result`. Ou os `file_change` do item 4, que trazem só path e kind, sem conteúdo [X6]. Nesse caso o diff teria de ser calculado via git no workspace.
  - No frontend, um componente `DiffBlock` novo em `frontend/src/components/agent-run/`, usado pelo `ToolRow`.
- **Dependências.** Item 4 ou o tool de edição; threat-model (escrita no workspace com aprovação). **[backend]**
- **DSH.** ✅ (`file-mutation-row.tsx` + `DiffBlock`).

### 8. Medidor de contexto e compactação (M/L, backend + frontend)

- **O que é.** Um anel ao lado do seletor de provedor, com tokens de input do último request contra a janela de contexto do modelo. O backend passa a avisar quando há resumo ou compactação.
- **Valor.** O usuário não sabe quando a conversa está perto do limite.
- **Onde encaixa.**
  - backend: `usage` com input tokens por request (adapters), janela de contexto por modelo no catálogo de provedores (`backend/routers/providers.py`)
  - frontend: barra do composer em `frontend/src/components/agent/AgentStage.tsx:378-381`, ao lado de `ChatProviderPicker`
- **Dependências.** Item 5 (separação in/out). Compactação de verdade depende de o OHarness manter um histórico multi-turno enviado ao modelo, o que não foi verificado aqui. **[backend]**
- **DSH.** ✅ (`ContextMeter.tsx`, `CompactionItem.tsx`).

### Fora do top 8 (próximos, em ordem)

| Recurso | Tamanho | Onde encaixa | Classe | DSH |
|---|---|---|---|---|
| Steer e fila durante o run | S/M | habilitar o composer com `live`, chamar `useRunStream.steer`, renderizar `RunState.steers` no `Transcript` | **[UI]** (o backend aplica o steering na fronteira de nó, `engine.py`) | ✅ |
| Faixa de to-do do agente | S, depois do item 4 | — | — | ✅ |
| Resposta em markdown | S | — | — | ✅ |
| Notificações nativas via Tauri | S | — | — | ? |
| Copiar por mensagem | S | — | — | ✅ |
| @-menção usando o `discover` | M | — | — | ✅ |
| Checkpoints e rewind | L | — | — | ? |

## O que ficou sem verificar

- **Codex app.** Exibição de comando com saída e exit code, thinking, medidor de contexto, to-do e subagentes. A doc do app que encontrei não descreve nada disso.
- **Cursor desktop.** Thinking, medidor de contexto, exibição de exit code, notificações e histórico.
- **Claude desktop.** Exit code por comando, modelo por passo e rewind no desktop.
- **DSH.** Modelo por passo, custo, notificações, rewind (só o tipo de dado foi encontrado) e histórico de sessões.
