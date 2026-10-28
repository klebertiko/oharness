# ADR 0010 — Modo plano: a run termina num plano que precisa de aprovação

Status: Aceito (conservador, sem decisão do usuário pendente) · 2026-10-28 · Issue #162 · Código: `backend/sandbox/plan_store.py`, `backend/routers/chat_tools.py`, `backend/routers/execution.py`

## Contexto
O modo Plan (#102) já recusava todo `exec`. Faltava o fim da run: um artefato de plano, e uma barreira que impeça executar sem aprová-lo.

## Decisão
1. **Artefato**: uma run direta em Plan (o pedido nomeia `thread_id` e o modo efetivo é `plan`) guarda a resposta final como `ChatPlan` (`proposed`) e emite `plan_proposed` depois de `node_done`. O evento entra no histórico da run.
2. **Barreira no sidecar**: com um plano `proposed`, `PUT /chat/tools/permission` para qualquer modo diferente de `plan` devolve 409 `plan_not_approved`. Sair do modo é o que aprovar faz: `POST /chat/tools/plan/approve` marca o plano e troca o modo num passo só. Só a API autenticada alcança essas rotas; uma chamada de ferramenta do modelo não.
3. **Aprovar leva a Ask** (ou a `auto_workspace`, `read_only`, `workspace_write` se nomeados); nunca a `plan` nem a `full`, que continua sendo escolha confirmada no compositor. Comandos seguem pedindo aprovação.
4. **Um plano por conversa**: um plano novo substitui o que esperava; aprovar o antigo dá 409 `plan_not_proposed`. Descartar mantém Plan e libera o seletor.
5. **Harness ligado**: em Plan a mensagem vai pelo caminho direto e o grafo do harness só roda depois da aprovação (o plano aprovado vira o turno seguinte). O grafo pode ter nós de ferramenta e não passa pelo broker.

## Consequências
O plano é texto do modelo: aprovar não o torna verificado, só impede execução sem decisão. O frontend restaura o cartão após recarregar via `GET /chat/tools/plan`.
