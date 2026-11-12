# Matriz de paridade: referências → OHarness → backlog

Consolidada em 2026-10-29 sobre a `origin/main` @ `72045e6`. Junta o que cinco referências fazem, o que o OHarness já tem, o que está em voo e o que falta, e liga cada lacuna a uma issue. Substitui como visão atual as três pesquisas anteriores, que continuam como histórico: `docs/research/chat-parity.md` (2026-10-10), `docs/product/competitive-gaps-2026-09-10.md` e `docs/product/gauntlet-automate/bar-cursor.md`. Os conceitos da Forja vêm da issue #244; o nome que a pessoa vê é Forja (ADR 0067). Os módulos Python continuam `factory`.

Reconciliada em 2026-11-12 com a `main` @ `f19ea647da87f4c772158a07f26151e1acd9f6bc` nas linhas que a seção 2 de `docs/product/requirements-gap-2026-11-04.md` marca como desatualizadas (R-DOC-01, issue #422): worktree (D1), Forja (D2, D3, E2, E5, E6, G), células DS, Flow (H) e i18n (I), e o termo modos de permissão (C1, F3). As linhas A, B, o restante de C, E1, E3, E4, E7 e F não foram reauditadas nesta data.

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
| **DS** | DeepSeek Harness desktop (código aberto) | Em 2026-10-29 o repositório respondeu 403 ao sandbox; as células foram herdadas de `docs/research/chat-parity.md` (checkout de 2026-08-21). Em 2026-11-04 o repositório público respondeu e a documentação do master confirmou as células herdadas; nenhuma foi refutada (DS1..DS21 na seção 7 de `docs/product/requirements-gap-2026-11-04.md`). Continuam sem reverificação contra o desktop instalado. |
| **WF** | Warp Factories: https://www.warp.dev/factories e https://docs.warp.dev/factories | Lidas em 2026-10-29. As subpáginas de formato e de scorers não foram abertas: ? onde o detalhe depende delas. |

Cada célula resume em palavras próprias o que a página descreve; nenhum trecho foi copiado. O estado do OHarness vem do código da `main` (`git grep` em 2026-10-29), não da pesquisa antiga: vários itens daquela pesquisa já foram entregues. Exceção: o formato dos itens de `codex exec --json` (linha A7) vem do SDK da CLI e não foi relido aqui.

## A. O que o chat e o transcrito mostram

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| A1 | CU ✓ (comando de terminal com saída acompanhada), CL ?, CX ?, DS ✓ | Toda chamada de tool com exit code, truncada, timeout e saída completa | **issue #296.** O `ToolCard` completo só existe para chamadas do broker; o `ToolRow` genérico perde `exitCode`, `truncated`, `timedOut` e `redactions`. | `agent-run/Transcript.tsx`, `ToolCard.tsx` |
| A2 | DS ✓, CL ?, CU ?, CX ? | Ação atual ao vivo (nó, fase, tool corrente) | **issue #297.** `ThinkingStatus` recebe um detalhe fixo. | `agent/AgentStage.tsx` |
| A3 | CL ✓ (modos de transcrição com raciocínio e verbose), DS ✓, CU ?, CX ? | Raciocínio do modelo visível | **main** no frontend (bloco `Reasoning`); falta alimentá-lo: **issue #301** (provedores HTTP) e **#302** (CLI). | `Transcript.tsx`, `adapters/openai_compatible.py` |
| A4 | DS ✓ (tempo, TTFT, tok/s), CL ◐ (uso da sessão), CU ?, CX ? | Tempo, tokens e custo por passo | **main** para latência por nó, tokens e rollup com proveniência. **issue #300** para custo, tokens de entrada/saída e TTFT por passo. | `agent-run/rollup.ts`, `routers/usage.py` |
| A5 | — (interno) | Avisos e retries que o backend já emite (`gate_retry`, `node_token_warning`, `budget_warning`, `runtime_selected`, o `reason` de `node_skipped`) | **issue #298.** O reducer ignora os quatro primeiros e descarta o `reason` de `node_skipped` (o evento em si já marca o passo como pulado). | `agent-run/runReducer.ts`, `engine.py` |
| A6 | DS ✓, CL ✓ (modo Thinking mostra o raciocínio) | Provedores HTTP emitindo o raciocínio do modelo | **issue #301.** Só o adapter mock alimenta o bloco. | `adapters/openai_compatible.py` |
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
| B11 | DS ✓ (copiar e ramificar), CL ?, CU ?, CX ? | Copiar, tentar de novo e ramificar por mensagem | **main** para copiar, reusar e mover para novo chat (ADR 0047, ainda "proposta, reversível"). **issue #313** para tentar de novo e ramificar. | `agent/MessageActions.tsx` |
| B12 | CL ✓, CX ✓ (trocar de chat), DS ? | Retomar sessão e histórico | **main** (ADR 0018 e 0044; barra de chats; Activity). | `agent-run/RunsPanel.tsx` |

## C. Controle, permissão e revisão

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| C1 | CL ✓ (modos de permissão), CU ?, DS ✓, CX ? | Modos de permissão por conversa | **main** (ADR 0021). Seis modos numa tabela só, sem modo que ignore tudo. O nome do recurso é modos de permissão; a recusa visível do modo somente leitura diz "Read-only mode" (#345). | `backend/sandbox/permission_modes.json` |
| C2 | CL ✓ (Plan), CU ◐ (existe a página Planning; não a li), DS ✓ | Modo plano com aprovação | **main** (ADR 0022). | `agent/PlanArtifactCard.tsx` |
| C3 | CL ✓, CU ✓ (Hooks) | Hooks que bloqueiam antes da ferramenta | **main** (ADR 0026 e 0041). | `agent/ToolHooksSheet.tsx` |
| C4 | CL ✓ (diff view), CX ✓ (escopo "último turno", reverter), CU ✓ | Diff por turno com reverter por arquivo | **main** (ADR 0024). Sem "reverter tudo", por decisão. | `agent-run/TurnDiffPanel.tsx` |
| C5 | CX ✓ (comentários inline, escopos, stage e revert), CL ✓ (revisão com diff), CU ✓ (Agent Review) | Revisão com comentários por linha e escopos | **issue #314.** | — |
| C6 | CU ✓ (checkpoints, locais e separados do git), CL ◐ (documentado para a CLI; não achei na página do desktop), CX ◐ (revert por arquivo) | Restaurar o workspace a um turno anterior | **issue #315.** Hoje só por arquivo. | `routers/turn_diff.py` |
| C7 | — (recurso próprio) | Teto de tokens por run e eventos de compactação | **main** (ADR 0025 e 0040). | `agent-run/RunBudgetField.tsx` |

## D. Execução, paralelismo e superfícies

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| D1 | CL ✓ (sessão em worktree próprio), CU ✓, CX ? | Worktree por run | **main** no backend (ADR 0019) e na UI (ADR 0046, PR #294, #275 fechada). Com harness e pasta, a barra da run mostra o interruptor, desligado por padrão e desabilitado durante a run. Os rótulos estão no catálogo (`chat.worktree.*`). | `frontend/src/components/agent/WorktreeToggle.tsx`, `backend/workspaces/` |
| D2 | CU ✓ (CLI headless), WF ✓ (CLI e API), CL ? | Execução headless e CLI | **main** (`oharness run`, ADR 0017 e 0045). CLI da Forja: **main** (`oharness forja`, ADR 0064 e 0067; #268 fechada). O comando antigo `oharness factory` não existe. | `backend/oharness/cli.py` |
| D3 | CL ✓ (tarefas em segundo plano), CU ✓ (agentes em paralelo), CX ✓ (projetos em paralelo) | Gerenciar várias runs ao mesmo tempo | **main** para a lista de runs (Activity) e para a sala de controle da Forja (`Alt+4`, #261 fechada). A sala não lista runs ao vivo; isso continua no painel do chat. Várias runs vivas no chat ao mesmo tempo: ? (não exercitado em 2026-11-12). | `agent-run/RunsPanel.tsx`, `frontend/src/factory/ForjaScreen.tsx` |
| D4 | CL ✓ (nuvem, SSH, Dispatch), CU ✓ (agentes na nuvem, máquinas próprias, celular), WF ✓ (execução hospedada) | Agentes e execução em nuvem; sessões remotas | **fora de escopo** (decisão da #244: tudo local ou em infraestrutura própria). | — |

## E. Extensibilidade e contexto

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| E1 | CL ✓, CU ✓ (página MCP na navegação), CX ?, WF ✓ (MCP compartilhado pela fábrica) | Cliente MCP para ferramentas externas | **issue #316.** Só existe o modelo (`McpServer`/Connector no OHM); não há cliente. | `backend/` |
| E2 | CL ✓, CU ✓ (página Skills na navegação), CX ?, WF ✓ (skills da fábrica) | Skills reutilizáveis | **main** em parte: comandos `/` e skill de workspace no composer, e skills da Forja por arquivo (#258 fechada; quatro origens em `docs/forja/agents.md`). Não há uma biblioteca de skills à parte. | `agent/chatCommands.ts`, `docs/forja/agents.md` |
| E3 | CL ✓, CU ✓, CX ✓ | Plugins e marketplace | **fora de escopo\*** (Skills e MCP cobrem o caso; sem marketplace). | — |
| E4 | CU ✓ (Rules), CL ✓ (instruções e memórias), CX ? | Instruções persistentes do workspace | **issue #317.** O Cowork guarda instruções num campo; o chat não lê arquivo do workspace. | `cowork/CoworkPanel.tsx` |
| E5 | WF ✓ (memória na lista de capacidades), CU ◐ (herdado de `bar-cursor.md`, não reverificado), CL ✓ (instruções e memórias) | Memória por agente | **main** (#259 fechada). A configuração da Forja mostra a memória de cada agente. | `docs/forja/control-room.md` |
| E6 | CU ✓ (subagentes e agentes custom), WF ✓ | Agentes custom | **main** (#258 fechada). Um agente com `role: custom` vive em `.oharness/forja`. O nó Delegate da UI continua na **issue #318.** | `docs/forja/agents.md` |
| E7 | — (consistência interna) | Nó Delegate citado pela UI mas inexistente no schema | **issue #318.** Item ainda aberto do audit de 2026-09-10. | `providers/catalog.ts` |

## F. Ferramentas de IDE e navegador

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| F1 | CL ✓ (computer use, prévia), CU ✓ (ferramenta de navegador), CX ✓ (computer use), WF ✓ (verificação por computer use) | Computer use e navegador | **issue #273** (verificação na Forja). Uso geral no chat: **fora de escopo\***. | — |
| F2 | CL ✓ (prévia do app), CU ✓ (Design Mode) | Prévia do app e edição visual | **fora de escopo\*** (o OHarness não é um IDE). | — |
| F3 | CL ✓ (terminal na sessão), CX ✓ (terminal integrado e ações reutilizáveis) | Terminal integrado | **fora de escopo\*** (o chat tem `/exec` e `/read` sob os modos de permissão). | — |
| F4 | CX ✓ (visualizador de arquivos e artefatos) | Visualizador de artefatos | **fora de escopo\*.** | — |

## G. Forja (Warp Factories e automações do Cursor)

Escopo e pacotes na #244. O nome que a pessoa vê é **Forja** (ADR 0067): CLI `oharness forja`, pasta `.oharness/forja/`, destino `Alt+4`. Os módulos Python continuam `factory`. O desenho é do OHarness. Estado conferido na `main` @ `f19ea647` em 2026-11-12.

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| G1 | WF ✓ | Work item que leva o contexto de origem | **main** (#255 fechada). O texto de origem fica guardado como dado, não como instrução. | `backend/factory/` |
| G2 | WF ✓ (foreman, triagem, spec, implementação), CU ◐ (Projects: agente coordenador) | Foreman e estágios com checkpoints humanos | **main** (#257 fechada, ADR 0054 e 0055). O foreman propõe; um checkpoint humano segura o estágio seguinte; a Forja não faz merge. | `backend/factory/foreman.py` |
| G3 | WF ✓ (definição em arquivos versionados) | Definição como código | **main** (#256 fechada, ADR 0056 e 0067). YAML no modelo OHM, com validação, diff, canary e volta à versão anterior. | `docs/forja/definition.md` |
| G4 | WF ✓ (agentes, skills, MCP por agente) | Agentes padrão e custom | **main** (#258 e #438 fechadas). Agentes por arquivo, skills por origem e modo de permissão por agente. A lista de MCP é configuração; o cliente que executa ferramentas externas continua na **issue #316.** | `docs/forja/agents.md` |
| G5 | WF ✓ (runners e segredos) | Runner local e segredos | **main** o módulo (#260 fechada, ADR 0057): worktree `forja/<item>-<run>`, pool e segredo por referência, com redação. O laço que dispara a run de estágio ainda não chama esse módulo: **issue #440.** | `backend/factory/runner.py` |
| G6 | WF ✓ (qualquer superfície), CU ✓ (lista de agentes) | Sala de controle e inbox | **main** (#261 e #263 fechadas, ADR 0058). Destino Forja: quadro, caixa de entrada, configuração e métricas. Runs ao vivo e a lista de automações não estão nesta tela. Achados baixos: **issue #442.** | `docs/forja/control-room.md` |
| G7 | WF ✓ (métricas), CU ? | Métricas da Forja | **main** (#262 fechada). Vazão, custo, qualidade, autonomia e tempo de ciclo em 7, 30 ou 90 dias; o que os dados não dizem aparece como indisponível. Achados baixos: **issue #442.** | `backend/factory/metrics.py` |
| G8 | WF ✓ (integrações), CU ✓ (GitHub, GitLab, Slack, Linear, Jira) | Conectores de fonte de trabalho | **main** o contrato e o GitHub (#264 fechada, ADR 0059 e 0060), não exercido contra a API real. GitLab, Azure DevOps, Linear, Jira, Slack e Teams (#269 fechada, ADR 0064) são esqueletos `experimental`: autenticam um payload de exemplo, não respondem e não estão ligados ao servidor. Não estão prometidos contra o serviço real. | `backend/factory_intake/connectors/` |
| G9 | CU ◐ (herdado de `bar-cursor.md`), WF ✓ (webhooks) | Receptor de webhook | **main** (#265 fechada, ADR 0061). `oharness forja serve` sobe o receptor separado do sidecar. Não verificado com túnel real nem com entrega de um provedor real. | `backend/factory_intake/server.py` |
| G10 | CU ✓ (automações por agenda e evento), CL ✓ (tarefas agendadas), CX ✓ (agendar no chat), WF ✓ | Automações agendadas e por evento | **main** no backend e na CLI (#266 fechada, ADR 0062): agenda e evento criam work item (`oharness forja automation`). Sem tela. A tela antiga de Automations continua fora da UI, e a sala de controle não lista automações. | `backend/factory_intake/automations.py` |
| G11 | WF ✓ (API, CLI, SDK e MCP) | MCP da Forja | **main** (#267 fechada, ADR 0063 e 0067). Servidor local por stdio, `oharness forja mcp`, ferramentas `forja_*`. Não verificado com um cliente MCP real. | `backend/factory_intake/mcp.py` |
| G12 | WF ✓ (scorers, benchmarks, auto-melhoria) | Scorers, benchmarks e observers | **issues #270, #271 e #272** (abertas em 2026-11-12). | — |
| G13 | WF ✓ (casos de uso), CU ✓ (revisão de PR e segurança como agentes gerenciados) | Modelos de Forja por caso de uso | **issue #274** (aberta em 2026-11-12). Os agentes gerenciados hospedados: **fora de escopo.** | — |
| G14 | WF ✓ (hospedagem, Kubernetes) | Infraestrutura hospedada | **fora de escopo.** | — |

## H. Flow

Não havia linha na matriz de 2026-10-29. O que está na `main` é o conselho por regras. O Flow global (estado compartilhado) está decidido e não está no código.

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| H1 | — (recurso próprio) | Flow de regras: conselho como evidência, com liga/desliga | **main** (ADR 0065, PR #336). Desligado por padrão. Com um harness, a barra da run tem o interruptor; ligado, cada passo grava `flow_advice`. O conselho não é gate e não muda o que roda. A transcrição ainda não mostra o conselho (fora da fatia do ADR). | `backend/flow/advice.py`, `frontend/src/components/agent-run/FlowToggle.tsx` |
| H2 | — (recurso próprio) | Flow global: estado compartilhado entre a pessoa e os modelos | **issue #357** (épico aberto). O ADR 0066, a spec de UX e o plano de medição estão na `main` (PR #367, só documentação). O S1 (`FlowGovernor`, **issue #358**) não está na `main`: não há `backend/flow/governor.py`. O interruptor que existe é o de H1, não esse estado. As tarefas #358 a #366 e #369 estavam abertas em 2026-11-12. | `docs/adr/0066-flow-global.md` |

## I. Idioma da interface

| # | Fontes | Recurso | Estado no OHarness | Onde |
| --- | --- | --- | --- | --- |
| I1 | — (interno) | Catálogos `en` e `pt-BR` | **main** em parte (ADR 0034). O catálogo cobre o shell, Chats, Studio, o inspetor, Cowork, Providers, a Forja e os interruptores de Flow e de worktree (PRs #331, #338, #349, #350, #353, e a Forja). A troca é o comando Language da paleta. **issue #279** continua aberta: a boas-vindas do chat ("What are we working on?") e avisos como o do worktree na transcrição (`runReducer.ts`) ainda são inglês literal fora do catálogo, e a revisão por falante nativo está pendente. O limite original do ADR 0034 ("só Providers") não descreve mais a `main`; o ADR não foi reescrito. | `frontend/src/i18n/` |

## O que mudou desde as pesquisas antigas

Do gap audit de 2026-09-10, estes itens já estão na `main`: histórico de runs (Activity), indicador de pensamento com tempo, adaptadores de Cursor e OpenRouter, modos de permissão, diff por turno, gasto e orçamento (Providers), workspace do chat, comandos `/`, hooks, subagentes, fila. A tela de Pull requests e a de Automations deixaram de existir na UI. O botão sem ação de Providers saiu com a tela refeita. Continua aberto o nó Delegate (#318).

Em 2026-11-12 (main @ `f19ea647`), a reconciliação da R-DOC-01: a UI de worktree está na main (PR #294, #275 fechada). O pacote B da Forja está na main (#255 e #264 a #269): work item, conector GitHub, receptor de webhook, automações no backend e na CLI, MCP local e `oharness forja`. Os conectores que não são GitHub são esqueletos. A sala de controle, a caixa de entrada, as métricas, a definição, o foreman, os agentes e o módulo do runner também estão na main (#256 a #263 e #332); o laço que dispara o estágio no runner não (#440). As células DS foram confirmadas pela documentação pública em 2026-11-04, não pelo desktop instalado. O Flow de regras está na main (ADR 0065); o Flow global não (épico #357, S1 #358). O catálogo de idioma cobre shell, chat, Studio e a Forja; a #279 segue aberta. O nome do controle de chat é modos de permissão.

Da pesquisa de chat de 2026-10-10, as linhas 9 (subagentes), 12 (resumo de atividade), 15 (interromper), 21 (retomar) e 23 (modos de permissão) estão entregues; a 14 está em parte (a fila sim; o steer é a issue #305). As demais viraram as issues acima.

## Limites

- As células de **DS** foram confirmadas em 2026-11-04 pela documentação pública do master (DS1..DS21); nenhuma herdada foi refutada. Não houve reverificação contra o desktop instalado.
- Providers em profundidade (adapters, orçamento, catálogo) não é uma linha desta matriz. O detalhe está na seção 3 de `docs/product/requirements-gap-2026-11-04.md`. A #82, fechada, cobre a camada de tela e o combo. Essa frente não foi reauditada em 2026-11-12.
- As páginas de **CX** descrevem o app de desktop do ChatGPT e do Codex em conjunto; quando o recurso é da CLI ou do IDE, a célula diz **?** em vez de assumir.
- Da **CU** li o corpo de duas páginas e a navegação do site; da **WF**, a página de visão geral (até o fluxo de issues) e a navegação da documentação; da **CL**, os títulos da página inteira e trechos de seções (transcrição, modos de permissão, contexto, pergunta lateral). Onde só vi um título, a célula diz o que o título sustenta e nada além.
- "Várias runs vivas no chat" (D3) não foi exercitado: **?**.
- Prioridade e tamanho das issues são estimativa desta matriz, sem medição com pessoas.
