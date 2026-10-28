# ADR 0018: retomar e bifurcar uma run a partir do jornal durável

Status: aceita (issue #157).

## Decisão
- Uma run com jornal (`RunRecord`) `partial` que não está mais rodando (`interrupted`, `stopped`, `failed`, `error`) é **continuável**. A regra está numa tabela só, `run_store.RESUMABLE_STATUSES` + `is_resumable`; a API devolve `resumable` e a UI apenas lê o campo.
- `POST /execute/logs/{id}/continue` cria uma run **nova** (status `pending`, mesma origem e mesmo harness), grava o vínculo em `run_links` (tabela nova: `create_all` a cria sem migração) e abre o jornal dela com o evento `run_continued {from_run_id, from_sequence}`. Os eventos da run original só são lidos: nada é reescrito nem acrescentado. Pode-se bifurcar a mesma run várias vezes (`continuations`).
- `GET /execute/logs/{id}` ganha `resumable`, `continued_from`, `parent_sequence`, `continuations`. Run legada (sem jornal) e run completa ou ainda rodando respondem `409 not_resumable`.
- UI: o detalhe de uma run salva mostra "Continue as a new run" e a origem ("Continues run … from event N").

Uma run cujo jornal fechou com `harness_done` (`coverage: complete`), mesmo `stopped` ou `error`, **não** é continuável neste corte: o critério do #157 é a run `partial`. O vínculo, o primeiro evento `run_continued` e a run nova são gravados na mesma transação.

## Escolha conservadora (registrada)
Este corte **cria e vincula** a run nova; ele não reexecuta os nós restantes. Retomar a execução no meio do grafo exige que o motor aceite as saídas já produzidas, e `engine.py` não foi alterado. A run `pending` fica visível e ligada à original; iniciar a execução dela é o próximo passo, a decidir com o dono do motor.
