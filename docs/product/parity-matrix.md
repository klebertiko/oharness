# Matriz de paridade: referências → OHarness → backlog

Consolidada em 2026-10-29 sobre a `main` @ `72045e6`. Junta o que cinco referências fazem, o que o OHarness já tem, o que está em voo e o que falta, e liga cada lacuna a uma issue. Substitui como visão atual as três pesquisas anteriores, que continuam como histórico: `docs/research/chat-parity.md` (2026-10-10), `docs/product/competitive-gaps-2026-09-10.md` e `docs/product/gauntlet-automate/bar-cursor.md`. Os conceitos de fábrica vêm da issue #244.

## Como ler

**Estado do OHarness**

| Marca | Significa |
| --- | --- |
| **main** | Está na `main` (a referência cita o ADR ou o arquivo). |
| **PR #n** | Em revisão. |
| **issue #n** | Falta; a issue está no backlog (ou em andamento). |
| **fora de escopo** | Decisão de produto: sem nuvem hospedada, sem marketplace. Os itens marcados com \* são proposta desta matriz e precisam da confirmação do dono. |
| **?** | Não verificado em fonte primária ou no código. |

**Fontes** (coluna "Fontes": ✓ = a fonte tem o recurso, ◐ = em parte, ? = não verifiquei, — = a fonte não tem ou não se aplica).

| Código | Fonte | Verificação |
| --- | --- | --- |
| **CL** | Claude desktop, aba Code: https://code.claude.com/docs/en/desktop (e `/checkpointing`) | Página lida em 2026-10-29. |
| **CX** | ChatGPT desktop app e Codex: páginas `app`, `code-review`, `notifications`, `long-running-work`, `prompting` e `integrated-terminal` em https://learn.chatgpt.com/docs/ | Lidas em 2026-10-29 (versão `.md` de cada página). |
| **CU** | Cursor: https://cursor.com/docs/agent/overview e `/agent/agents-window` (corpo lido), mais a navegação de https://cursor.com/docs (nomes de páginas e recursos) | Lidas em 2026-10-29. A página de terminal foi baixada mas não lida. |
| **DS** | DeepSeek Harness desktop (código aberto) | O repositório respondeu 403 ao sandbox em 2026-10-29. Células herdadas de `docs/research/chat-parity.md` (checkout de 2026-08-21); **não reverificadas**. |
| **WF** | Warp Factories: https://www.warp.dev/factories e https://docs.warp.dev/factories | Lidas em 2026-10-29. As subpáginas de formato e de scorers não foram abertas: ? onde o detalhe depende delas. |

Cada célula resume em palavras próprias o que a página descreve; nenhum trecho foi copiado. O estado do OHarness vem do código da `main` (`git grep` em 2026-10-29), não da pesquisa antiga: vários itens daquela pesquisa já foram entregues. Exceção: o formato dos itens de `codex exec --json` (linha A7) vem do SDK da CLI e não foi relido aqui.

## A. O que o chat e o transcrito mostram

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| A1 | CU ✓ (comando de terminal com saída acompanhada), CL ?, CX ?, DS ✓ | Toda chamada de tool com exit code, truncada, timeout e saída completa | **issue #296.** O `ToolCard` completo só existe para chamadas do broker; o `ToolRow` genérico perde `exitCode`, `truncated`, `timedOut` e `redactions`. | `agent-run/Transcript.tsx`, `ToolCard.tsx` |
| A2 | DS ✓, CL ?, CU ?, CX ? | Ação atual ao vivo (nó, fase, tool corrente) | **issue #297.** `ThinkingStatus` recebe um detalhe fixo. | `agent/AgentStage.tsx` |
| A3 | CL ✓ (modos de transcrição com raciocínio e verbose), DS ✓, CU ?, CX ? | Raciocínio do modelo visível | **main** no frontend (bloco `Reasoning`); falta alimentá-lo: **issue #301** (provedores HTTP) e **#302** (CLI). | `Transcript.tsx`, `adapters/openai_compatible.py` |
| A4 | DS ✓ (tempo, TTFT, tok/s), CL ◐ (uso da sessão), CU ?, CX ? | Tempo, tokens e custo por passo | **main** para latência por nó, tokens e rollup com proveniência. **issue #300** para custo, tokens de entrada/saída e TTFT por passo. | `agent-run/rollup.ts`, `routers/usage.py` |
| A5 | — (interno) | Avisos e retries que o backend já emite (`gate_retry`, `node_token_warning`, `budget_warning`, `runtime_selected`, `node_skipped.reason`) | **issue #298.** O reducer os descarta. | `agent-run/runReducer.ts`, `engine.py` |
| A7 | DS ✓ (nativo), CX ? (schema da CLI, não do app) | Eventos estruturados das CLIs (comando, arquivo, raciocínio, plano) como eventos do contrato | **issue #302.** `cli_codex` guarda só `agent_message`. | `adapters/cli_codex.py` |
| A8 | CU ◐ (planejamento), DS ✓, CL ?, CX ? | To-do do agente com progresso | **issue #303** (depende de #302). `RunLadder` é o plano do grafo, não do modelo. | `agent-run/RunLadder.tsx` |
| A9 | CL ✓ (verificar e liberar contexto), DS ✓, CU ?, CX ? | Medidor de contexto e compactação | **main** para o evento de compactação (ADR 0025). **issue #304** para o medidor. | `routers/execution.py`, `runReducer.ts` |
| A10 | DS ✓, CL ?, CU ?, CX ? | Resposta em markdown | **issue #299.** Hoje é texto puro. | `agent/AgentStage.tsx` |
| A11 | CL ✓ (lista de tarefas e subagentes em segundo plano), CU ✓ (Subagents em Customize), DS ✓, CX ? | Atividade de subagentes | **main** (ADR 0027, árvore ao vivo com cancelar por filho). | `agent-run/SubagentTree.tsx` |
| A12 | CL ✓ (modos de transcrição recolhem chamadas em resumo), DS ◐ | Resumo de atividade ("Ran N commands") | **main.** | `agent-run/activity.ts`, `rollup.ts` |

## B. Composer e interação

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| B1 | CU ✓ (fila com reordenar), DS ✓, CX ◐ | Fila de mensagens durante o run | **main** (ADR 0023). | `agent/QueuedMessages.tsx` |
| B2 | CU ✓ (entregar na próxima chamada de tool), CX ✓ (conduzir trabalho em andamento), CL ? | Enviar agora (steer) | **issue #305.** O backend e o hook têm `steer`; nenhuma tela o chama. | `agent-run/useRunStream.ts` |
| B3 | CL ✓, CU ✓, CX ?, DS ? | Interromper | **main** (Stop). | `agent/AgentStage.tsx` |
| B4 | CL ✓, CU ✓, CX ✓, DS ✓ | Paleta de slash no composer | **main** (indisponível enquanto uma run está ativa). | `agent/ChatComposer.tsx` |
| B5 | CL ✓, CU ◐ (@ de side chat verificado; de arquivos ?), CX ?, DS ✓ | @-menção de arquivos | **issue #307.** | — |
| B6 | CL ✓ (arquivos e contexto no prompt), CU ✓ (lê imagens), CX ✓ | Anexar arquivos e imagens | **issue #308.** | — |
| B7 | CL ✓, CX ✓ (fim de turno, permissão e pergunta), CU ?, DS ? | Notificações nativas | **issue #309.** Sem API de notificação no frontend nem no Tauri. | `src-tauri/` |
| B8 | CU ✓ (busca em transcritos, índice local), CL ?, CX ? | Buscar no conteúdo das conversas | **issue #310.** A busca filtra só o título. | `agent/ThreadsSidebar.tsx` |
| B9 | CL ✓ (pergunta lateral), CU ✓ (`/side`) | Pergunta lateral sem interromper | **issue #311.** | — |
| B10 | CX ✓ (`/goal`, pausar e retomar), CU ✓ (`/goal`) | Meta de longa duração | **issue #312.** | — |
| B11 | DS ✓ (copiar e ramificar), CL ?, CU ?, CX ? | Copiar, tentar de novo e ramificar por mensagem | **main** para copiar, reusar e mover para novo chat (ADR 0047). **issue #313** para tentar de novo e ramificar. | `agent/MessageActions.tsx` |
| B12 | CL ✓, CX ✓ (trocar de chat), DS ? | Retomar sessão e histórico | **main** (ADR 0018 e 0044; barra de chats; Activity). | `agent-run/RunsPanel.tsx` |

## C. Controle, permissão e revisão

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| C1 | CL ✓ (modos de permissão), CU ?, DS ✓, CX ? | Modos de permissão por conversa | **main** (ADR 0021; sem modo que ignore tudo). | `lib/permissionModes.json` |
| C2 | CL ✓ (Plan), CU ◐ (existe a página Planning; não a li), DS ✓ | Modo plano com aprovação | **main** (ADR 0022). | `agent/PlanArtifactCard.tsx` |
| C3 | CL ✓, CU ✓ (Hooks) | Hooks que bloqueiam antes da ferramenta | **main** (ADR 0026 e 0041). | `agent/ToolHooksSheet.tsx` |
| C4 | CL ✓ (diff view), CX ✓ (escopo "último turno", reverter), CU ✓ | Diff por turno com reverter por arquivo | **main** (ADR 0024). Sem "reverter tudo", por decisão. | `agent-run/TurnDiffPanel.tsx` |
| C5 | CX ✓ (comentários inline, escopos, stage e revert), CL ✓ (revisão com diff), CU ✓ (Agent Review) | Revisão com comentários por linha e escopos | **issue #314.** | — |
| C6 | CU ✓ (checkpoints, locais e separados do git), CL ◐ (documentado para a CLI; não achei na página do desktop), CX ◐ (revert por arquivo) | Restaurar o workspace a um turno anterior | **issue #315.** Hoje só por arquivo. | `routers/turn_diff.py` |
| C7 | — (recurso próprio) | Teto de tokens por run e eventos de compactação | **main** (ADR 0025 e 0040). | `agent-run/RunBudgetField.tsx` |

## D. Execução, paralelismo e superfícies

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| D1 | CL ✓ (sessão em worktree próprio), CU ✓, CX ? | Worktree por run | **main** no backend (ADR 0019 e 0046); **PR #294** e **issue #275** para a UI. | `backend/workspaces/` |
| D2 | CU ✓ (CLI headless), WF ✓ (CLI e API), CL ? | Execução headless e CLI | **main** (`oharness run`, ADR 0017 e 0045). CLI da fábrica: **issue #268.** | `backend/oharness/cli.py` |
| D3 | CL ✓ (tarefas em segundo plano), CU ✓ (agentes em paralelo), CX ✓ (projetos em paralelo) | Gerenciar várias runs ao mesmo tempo | **main** para a lista de runs (Activity). Várias runs vivas no chat: ?. Sala de controle: **issue #261.** | `agent-run/RunsPanel.tsx` |
| D4 | CL ✓ (nuvem, SSH, Dispatch), CU ✓ (agentes na nuvem, máquinas próprias, celular), WF ✓ (execução hospedada) | Agentes e execução em nuvem; sessões remotas | **fora de escopo** (decisão da #244: tudo local ou em infraestrutura própria). | — |

## E. Extensibilidade e contexto

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| E1 | CL ✓, CU ✓ (página MCP na navegação), CX ?, WF ✓ (MCP compartilhado pela fábrica) | Cliente MCP para ferramentas externas | **issue #316.** Só existe o modelo (`McpServer`/Connector no OHM); não há cliente. | `backend/` |
| E2 | CL ✓, CU ✓ (página Skills na navegação), CX ?, WF ✓ (skills da fábrica) | Skills reutilizáveis | **main** em parte (comandos `/` e skill de workspace no composer). Biblioteca e skills por agente: **issue #258.** | `agent/chatCommands.ts` |
| E3 | CL ✓, CU ✓, CX ✓ | Plugins e marketplace | **fora de escopo\*** (Skills e MCP cobrem o caso; sem marketplace). | — |
| E4 | CU ✓ (Rules), CL ✓ (instruções e memórias), CX ? | Instruções persistentes do workspace | **issue #317.** O Cowork guarda instruções num campo; o chat não lê arquivo do workspace. | `cowork/CoworkPanel.tsx` |
| E5 | WF ✓ (memória na lista de capacidades), CU ◐ (herdado de `bar-cursor.md`, não reverificado), CL ✓ (instruções e memórias) | Memória por agente | **issue #259.** | — |
| E6 | CU ✓ (subagentes e agentes custom), WF ✓ | Agentes custom | **issue #258.** | — |
| E7 | — (consistência interna) | Nó Delegate citado pela UI mas inexistente no schema | **issue #318.** Item ainda aberto do audit de 2026-09-10. | `providers/catalog.ts` |

## F. Ferramentas de IDE e navegador

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| F1 | CL ✓ (computer use, prévia), CU ✓ (ferramenta de navegador), CX ✓ (computer use), WF ✓ (verificação por computer use) | Computer use e navegador | **issue #273** (verificação na fábrica). Uso geral no chat: **fora de escopo\***. | — |
| F2 | CL ✓ (prévia do app), CU ✓ (Design Mode) | Prévia do app e edição visual | **fora de escopo\*** (o OHarness não é um IDE). | — |
| F3 | CL ✓ (terminal na sessão), CX ✓ (terminal integrado e ações reutilizáveis) | Terminal integrado | **fora de escopo\*** (o chat tem `/exec` e `/read` com permissão). | — |
| F4 | CX ✓ (visualizador de arquivos e artefatos) | Visualizador de artefatos | **fora de escopo\*.** | — |

## G. Fábrica (Warp Factories e automações do Cursor)

Escopo e pacotes na #244. Aqui só o mapa conceito → issue; o desenho é do OHarness.

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| G1 | WF ✓ | Work item que leva o contexto de origem | **issue #255** (em andamento). | — |
| G2 | WF ✓ (foreman, triagem, spec, implementação), CU ◐ (Projects: agente coordenador) | Foreman e estágios com checkpoints humanos | **issue #257.** | — |
| G3 | WF ✓ (definição em arquivos versionados) | Definição como código | **issue #256.** | — |
| G4 | WF ✓ (agentes, skills, MCP por agente) | Agentes padrão e custom | **issue #258.** | — |
| G5 | WF ✓ (runners e segredos) | Runner local e segredos | **issue #260.** | — |
| G6 | WF ✓ (qualquer superfície), CU ✓ (lista de agentes) | Sala de controle e inbox | **issue #261** e **#263.** | — |
| G7 | WF ✓ (métricas), CU ? | Métricas da fábrica | **issue #262.** | — |
| G8 | WF ✓ (integrações), CU ✓ (GitHub, GitLab, Slack, Linear, Jira) | Conectores de fonte de trabalho | **issue #264** (contrato e GitHub; **PR #247**), **#269** (os demais). | — |
| G9 | CU ◐ (herdado de `bar-cursor.md`), WF ✓ (webhooks) | Receptor de webhook | **issue #265.** | — |
| G10 | CU ✓ (automações por agenda e evento), CL ✓ (tarefas agendadas), CX ✓ (agendar no chat), WF ✓ | Automações agendadas e por evento | **issue #266.** A tela antiga de Automations foi removida da UI. | — |
| G11 | WF ✓ (API, CLI, SDK e MCP) | Factory MCP | **issue #267** (contrato: **PR #246**). | — |
| G12 | WF ✓ (scorers, benchmarks, auto-melhoria) | Scorers, benchmarks e observers | **issues #270, #271 e #272.** | — |
| G13 | WF ✓ (casos de uso), CU ✓ (revisão de PR e segurança como agentes gerenciados) | Modelos de fábrica por caso de uso | **issue #274.** Os agentes gerenciados hospedados: **fora de escopo.** | — |
| G14 | WF ✓ (hospedagem, Kubernetes) | Infraestrutura hospedada | **fora de escopo.** | — |

## O que mudou desde as pesquisas antigas

Do gap audit de 2026-09-10, estes itens já estão na `main`: histórico de runs (Activity), indicador de pensamento com tempo, adaptadores de Cursor e OpenRouter, modos de permissão, diff por turno, gasto e orçamento (Providers), workspace do chat, comandos `/`, hooks, subagentes, fila. A tela de Pull requests e a de Automations deixaram de existir na UI. O botão sem ação de Providers saiu com a tela refeita. Continua aberto o nó Delegate (#318).

Da pesquisa de chat de 2026-10-10, as linhas 9, 12, 14, 15, 21 e 23 estão entregues; as demais viraram as issues acima.

## Limites

- Nenhuma célula de **DS** foi reverificada (repositório inacessível ao sandbox).
- As páginas de **CX** descrevem o app de desktop do ChatGPT e do Codex em conjunto; quando o recurso é da CLI ou do IDE, a célula diz **?** em vez de assumir.
- Da **CU** li o corpo de duas páginas e a navegação do site; da **WF**, a página de visão geral (até o fluxo de issues) e a navegação da documentação; da **CL**, os títulos da página inteira e trechos de seções (transcrição, modos de permissão, contexto, pergunta lateral). Onde só vi um título, a célula diz o que o título sustenta e nada além.
- "Várias runs vivas no chat" (D3) não foi exercitado: **?**.
- Prioridade e tamanho das issues são estimativa desta matriz, sem medição com pessoas.
