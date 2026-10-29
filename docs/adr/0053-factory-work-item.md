# ADR 0053 — Fábrica local: work item (modelo, armazenamento e contrato da API)

Status: proposta (issue #244, pacote A). Contrato compartilhado com o pacote B (entrada e Factory MCP): mudanças aqui são combinadas com a sessão do B.

**Fontes dos conceitos.** O desenho parte de conceitos públicos de "software factory" (documentação e posts de Warp Factories: ciclo do work item, foreman, checkpoints, definição como código, métricas). Só os **conceitos** foram aproveitados; nomes, formatos, schemas e textos são do OHarness. Fontes: docs.warp.dev/factories (visão geral, "How Warp Factories work", "Factory definition syntax", "Factory dashboard", "Measure and improve") e os posts "software-factory-as-code", "the-factory-stack" e "using-llm-as-a-judge-scoring…" em warp.dev/blog. Ficam fora de escopo: agentes em nuvem, execução hospedada, runners hospedados, app web hospedado, créditos.

Série da fábrica (pacote A): 0053 work item · 0054 foreman e agentes · 0055 estágios e checkpoints · 0056 definição como código · 0057 runner local e segredos · 0058 sala de controle e métricas.

## Contexto
O OHarness já tem runs duráveis (`RunRecord`/`RunEvent`, ADR 0017/0018/0044), worktree por run (0019), presets de permissão (0021), teto de tokens (0025/0040), hooks pré-ferramenta (0026/0041) e subagentes (0027). Falta a unidade de **trabalho** acima da run: uma tarefa que atravessa vários estágios e várias runs mantendo o contexto de origem. A fábrica é **local**: nenhum agente em nuvem, nenhuma execução hospedada.

## Decisão
Um **work item** é a linha persistente de uma tarefa. Mora no mesmo SQLite do sidecar (`database.py`, mesmo `Base`), em tabelas com prefixo `factory_`.

### Campos
| Campo | Regra |
| --- | --- |
| `id` | uuid gerado pelo sidecar. |
| `factory_id` | fábrica dona (ADR 0056). |
| `factory_version` | hash da versão da definição fixada **na criação**; o item termina na versão em que começou (rollback/canary não o alteram). |
| `title` | até 200 caracteres, redigido. |
| `source` | `{kind, subtype?, ref, url?, thread_ref?}`. `kind` é o conector: `github`, `gitlab`, `azdo`, `linear`, `jira`, `slack`, `teams`, `webhook`, `mcp`, `cli`, `schedule`, `conversation`, `manual`, `monitor` (aberto pelo estágio Monitor). `subtype` (`issue`, `pr`, `thread`…) é livre e curto. `ref` (o id externo) e `thread_ref` (onde devolver a resposta) são opacos para o sidecar (ex.: `owner/repo#12`). Também guardados: `labels[]` e `requested_by` (texto opaco, não confiável). A chave `(factory_id, source.kind, source.ref)` tem restrição **UNIQUE no banco** entre itens **abertos** (índice parcial: `status` fora de `done`, `cancelled`, `failed`); repetir a entrada (ou duas tentativas simultâneas de webhook) devolve o item aberto existente (`200`) e perde a corrida no banco, não no código. Se o item existente já fechou, uma nova entrada com a mesma chave cria um **novo** item ligado ao anterior (`reopens: <id>`); assim uma issue reaberta é refeita. `schedule` e `monitor` usam um `ref` com carimbo da ocorrência (ex.: `daily-cleanup@2026-10-29`), nunca um `ref` fixo. |
| `origin_context` | texto de origem + anexos por referência. **Imutável** e preservado do começo ao fim: estágios leem, nunca reescrevem; novas informações entram como eventos. Sempre `trust: "untrusted"`. Redigido na entrada (`redact_value`). Limite: 64 KB; excedente é truncado com marcador, nunca descartado em silêncio. |
| `stage` | `intake`, `triage`, `spec`, `implement`, `review`, `verify`, `handoff`, `monitor` (ADR 0055). |
| `status` | `queued`, `running`, `awaiting_human`, `waiting_merge`, `claimed`, `parked`, `done`, `cancelled`, `failed`. `done` só é alcançado por merge observado ou confirmação humana (ADR 0055), nunca pelo handoff. |
| `claim` | `{holder, worktree_ref}` quando `status = claimed`: uma pessoa ou agente local assumiu o item (Factory MCP, pacote B); a run da fábrica fica suspensa (interrompida e continuável, ADR 0044). |
| `column` | derivada (nunca gravada) de `stage`+`status` pela **tabela única** abaixo. |
| `spec` | texto da spec vigente + `spec_revision` (inteiro) + `approved_revision` (nulo até um humano aprovar). |
| `cost` | tokens agregados das runs vinculadas (prompt/completion) e estimativa quando houver preço em `usage_tracking`. |
| `created_at`, `updated_at`, `closed_at` | UTC. |

### Tabela `stage`+`status` → `column`
A tabela mora em `backend/factory/stages.py` e é espelhada em `frontend/src/factory/types.ts`; um teste de paridade compara os dois e exige que **todo** par possível tenha coluna.
| Condição | Coluna |
| --- | --- |
| `status` = `done` | `done` |
| `status` = `cancelled` ou `failed` | `closed` (mostra o motivo; filtro, não coluna principal do quadro) |
| `status` = `parked` (qualquer estágio) | `parked` |
| `awaiting_human` (qualquer estágio) | `needs_you` (a caixa de entrada; o cartão mostra o estágio) |
| `stage` = `intake` ou `triage` (`queued`/`running`) | `new` |
| `stage` = `spec` | `triaged` |
| `stage` = `implement`, spec aprovada ou não exigida e ainda não iniciou | `planned` |
| `stage` = `implement` em execução | `implementing` |
| `stage` = `review` | `in_review` |
| `stage` = `verify` | `verifying` |
| `stage` = `monitor` | `monitoring` |
| `status` = `waiting_merge` (estágio `handoff`) | `handoff` |
| `status` = `claimed` | `claimed` |
O quadro mostra as colunas principais; `closed` fica atrás de um filtro. `GET ?column=` aceita todas.

### Tabelas auxiliares (todas append-only, exceto onde dito)
- `factory_work_item_events`: histórico. `{work_item_id, sequence, type, actor, data_json, at}`. `actor.kind`: `human`, `foreman`, `agent`, `system`, `source`. Tipos: `created`, `stage_entered`, `stage_skipped`, `returned_to_implement`, `verify_failed`, `recovered`, `advanced`, `changes_requested`, `failed`, `spec_proposed`, `spec_edited`, `spec_approved`, `checkpoint_requested`, `checkpoint_resolved`, `run_linked`, `artifact_added`, `parked`, `resumed`, `cancelled`, `claimed`, `released`, `merge_observed`, `completed`, `note`. `data_json` passa por `redact_value`.
- `factory_work_item_runs`: vínculo `{work_item_id, run_id, stage, agent_id, role}`. A run em si continua no jornal existente; o work item **referencia**, não copia, eventos.
- `factory_artifacts`: `{id, work_item_id, kind, ref, label, created_at}`; `kind`: `pr` (URL), `diff` (ref de resgate/intervalo git), `video` (arquivo local sob a pasta de dados da fábrica), `spec`, `report`. O sidecar guarda **referências**, não segredos nem binários grandes.

### API do sidecar (rota `/factory`, mesmo token de sidecar de `security/sidecar_token.py`)
```
POST /factory/work-items                      cria (ou devolve o existente pela chave de dedup)
GET  /factory/work-items?column=&stage=&status=&limit=&cursor=
GET  /factory/work-items/{id}                 item + artefatos + runs vinculadas
GET  /factory/work-items/{id}/events?after=   histórico paginado
POST /factory/work-items/{id}/actions         {action, ...}
GET  /factory/metrics?window=                 ADR 0058
```
`action`: `approve_spec {revision}`, `edit_spec {text, base_revision}`, `answer {question_id, text}`, `request_changes {note}`, `confirm_merged`, `advance`, `park`, `resume`, `cancel`, `note`, `claim {holder}`, `release {summary, branch?, status}`. `claim`/`release` pertencem à classe agente/integração (ADR 0055): assumir o item suspende a run; `release` anexa a branch como artefato e devolve o item ao estágio `review` — **nunca** o completa. As demais ações de decisão (aprovar spec, responder pergunta, confirmar merge) são da classe humana. Toda ação é um evento com `actor`. `actor` é sempre definido **pelo servidor** a partir da credencial da chamada (ADR 0055); um `actor` enviado pelo cliente é ignorado. Ação sem evento equivalente não existe: `request_changes`→`changes_requested`, `advance`→`advanced`. `edit_spec` com `base_revision` velha responde `409` (sem sobrescrever o que outra pessoa editou). Não existe ação `merge`, em nenhuma camada (ADR 0055).

Corpo de criação (o que o pacote B envia; `idempotency_key` opcional, único por fábrica, e tem a mesma semântica de dedup):
```json
{"factory_id": "string", "title": "string",
 "source": {"kind": "github_issue", "ref": "owner/repo#12", "url": "https://..."},
 "origin_context": {"text": "string", "attachments": [{"label": "string", "ref": "string"}]},
 "labels": ["string"], "requested_by": "string", "idempotency_key": "string"}
```
Os tipos acompanham o código: modelos Pydantic em `backend/factory/models.py` e espelho TypeScript em `frontend/src/factory/types.ts`, com teste de paridade (mesmo padrão de `RUN_BUDGET_RULES`).

## Segurança
- **Texto externo é dado, não instrução.** `origin_context`, títulos de issue e mensagens chegam como dado não confiável. Nunca entram no prompt de sistema; vão em bloco delimitado e escapado, rotulado "dado não confiável", como os resultados de ferramenta do ADR 0027. Nada nele concede ferramenta, permissão ou pula checkpoint.
- Segredos: toda gravação passa por `redact_value` (`run_store.py`); nenhum campo guarda credencial.
- O token de entrada de um conector (pacote B) mora no cofre (`secret_store`), nunca no work item.

## Escolhas conservadoras
- Sem exclusão física de itens neste corte: `cancelled` e `closed_at`. Exportar/apagar dados da fábrica é decisão do dono (soberania), tratada na sala de controle.
- `column` derivada evita estado duplicado que diverge.
- Sem tabela de fila separada: o estado `queued` + índice por `(factory_id, status)` basta para um sidecar local.

## Fora de escopo
Fontes de trabalho, webhooks, automações e Factory MCP (pacote B, ADRs 0059–0064); scorers (pacote C).
