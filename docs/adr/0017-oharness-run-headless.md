# ADR 0017: `oharness run <bundle> --json` (execução headless)

Status: aceita (issue #158).

## Decisão
- `python -m oharness run <bundle> [--json]` valida o harness (mesmo validador do `validate`) e o executa com `engine.execute_harness` em **modo mock**: sem Provider, sem rede, sem segredos. Não há flag para execução real neste corte.
- `--json` imprime **uma linha por evento**: `{"sequence": n, "event": "...", "data": {...}}`. Cada linha é validada contra `backend/oharness/schema/run-event.schema.json` **antes** de ser impressa; se o motor e o schema divergirem, a run falha em vez de emitir evento inválido. A tabela de eventos do schema é a regra única (o motor documenta o mesmo conjunto em `execute_harness`).
- Códigos de saída: `0` run `complete`; `1` run `stopped` ou `error` (nó com falha, grafo com ciclo, divergência de schema); `2` harness inválido ou arquivo ausente (nada em stdout).
- **HITL (escolha conservadora):** um nó HITL é autoridade humana. Sem pessoa, o CLI não aprova: ao ver `hitl_pause` ele para a run (`stopped`, saída `1`). Uma flag de aprovação automática fica para decisão do usuário.

## Fora de escopo
Execução com Providers reais, retomada e bifurcação (#157), worktree por run (#159). O motor não foi alterado.
