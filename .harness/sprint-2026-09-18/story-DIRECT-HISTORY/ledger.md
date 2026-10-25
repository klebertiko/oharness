# DIRECT-HISTORY — ledger (Codex)

## 2026-09-18 — START

Implementação interativa conforme brief; sem subagentes até o reset combinado. Checkout compartilhado preservado. Aprovação global do Sprint Goal não é presumida; esta correção já foi autorizada pelo usuário e é independente do contrato.

### Seams acordados na story
- AC#1/2: POST /execute/direct → GET /execute/logs/{run_id}; teste existente em tests/test_execution_provider_resolution.py, preservado.
- AC#3: GET /execute/logs após execução direta e harness; teste de integração no mesmo arquivo.
- AC#4: POST direto com adapter externo fake que falha → GET do histórico; classificação segura de providers/outcomes.py.
- DB e secrets isolados por tests/conftest.py antes de importar a aplicação. Nenhum teste usa o banco vivo.

Próximo: reproduzir o RED existente antes de editar produto.

## RED AC#1/2
Comando: backend/.venv/Scripts/python.exe -m pytest -q tests/test_execution_provider_resolution.py::test_direct_history_survives_a_fresh_detail_request (cwd backend).
Saída: assert 404 == 200; 1 failed, 3 warnings in 1.68s. Warnings: cache pytest sem permissão; próximas execuções usarão -p no:cacheprovider.
BDD: Dado provider válido e execução direta concluída, Quando consulto o run_id por uma nova requisição, Então recebo os eventos e a resposta persistidos.
Requisito adicional do usuário: BDD, mutation, regression e E2E. Mutation/E2E somente em cópia isolada; integração frontend será coordenada via STATUS, sem editar frontend.

## GREEN AC#1/2
Mesmo teste original, sem edição: 1 passed in 1.19s (-p no:cacheprovider).
execution.py cria o registro running antes do stream, captura os eventos emitidos e finaliza com sessão independente. Commit do log ocorre mesmo sem tokens/simulação.
STATUS relido: HITL confirmou goal e Claude iniciou CONTRACT. Registro de START acima anterior à leitura dessa confirmação fica preservado.

## AC#3 — listagem e replay BDD
Dado execução direta e harness, Quando listo o histórico, Então source distingue direct/harness; Quando reabro, Então eventos correspondem exatamente ao SSE, incluindo provider_verified.
RED: test_history_lists_direct_and_harness_with_explicit_source → KeyError source; 1 failed in 1.86s.
GREEN: mesmo teste + RED original + tests/test_execution_logs_api.py → 4 passed in 1.44s.
Campo aditivo source em list/detail, armazenado no JSON do direct (também durante running); históricos legados seguem harness. Sem migração de DB. Pedido de compatibilidade FE registrado no STATUS.
AC#4 próximo: falha transporte/autenticação mantém diagnóstico seguro e tokens parciais no histórico failed, SSE permanece error conforme consumidor existente.

## AC#4 — falhas BDD
RED: test_direct_failed_history_preserves_safe_classification[transport/authentication] → error != failed; 2 failed in 1.87s.
GREEN: tests/test_execution_provider_resolution.py + tests/test_execution_logs_api.py → 23 passed in 3.45s.
Status persistido failed; status SSE error preservado. Diagnósticos seguros, connection_id, tokens parciais e timestamps conferidos pelo endpoint.

## Regressão e E2E BDD adicional
Regressão antes de E2E: pytest -q -p no:cacheprovider → 397 passed in 49.74s.
Worktree isolado: D:/Development/.worktrees/oharness-sprint-20260918-7fd22a38 (HEAD 3689da0 + snapshot backend atual; banco/secrets vivos excluídos).
BDD executável tests/e2e/test_direct_history_e2e.py: Given completed run / When server restarts / Then history survives; Given running stream / When stop or disconnect / Then stopped history.
E2E usa uvicorn :8001, banco temporário e fixture HTTP somente na fronteira do modelo. Não é E2E visual do frontend.
RED: 1 failed, 2 passed in 20.29s. Desconexão deixava registro running por cancelamento da sessão de gravação.
Correção: CancelScope shield na finalização, status stopped e eventos terminais de replay ao desconectar, erros externos sanitizados. Teste original de histórico permanece intacto.

E2E permaneceu RED após apenas proteger a gravação: 1 failed, 2 passed in 16.75s. Diagnóstico minimizado em RunControl.stream_until_stopped: cancelar consumidor causava aclose(): asynchronous generator is already running (1 failed in 0.72s). Cancelar/aguardar tarefas antes do aclose, em shield, preserva CancelledError.
GREEN seam RunControl: 2 passed in 0.45s.
GREEN E2E: 3 passed in 11.90s (mesmo worktree, uvicorn 8001). Instrumentação DEBUG-DH só na cópia isolada, removida ao recopiar execution.py.
Estratégia do sprint foi ampliada durante este trabalho: exige pytest-bdd e mutmut; mutações semânticas manuais são complemento, não substituem o score exigido.

## BDD e mutation medidos
pytest-bdd: tests/test_direct_history_bdd.py — 3 passed in 1.35s.
Regressão antes do broker: 404 passed, 3 skipped in 36.38s; skips E2E deliberados no checkout compartilhado (E2E separado em :8001 passou).
Mutações semânticas isoladas: 7/7 mortas (mutation-direct-history.json).
mutmut 2.4.5, escopo patch DIRECT-HISTORY + finalização RunControl: 53 mutantes; 26 killed, 27 survived (49.06%). Cache inspecionado somente após processo terminar. NÃO atingiu o alvo de 70%; falta fortalecer assertions/revisar sobreviventes. Gate mutation pendente; nenhum score substituído pelas 7 mutações semânticas.

## Mutation R2 / pronto para QA
Reforçados testes observáveis: identificação do histórico, snapshot running sem eventos, terminal stopped com nó/tokens/latência, uso por source/provider após desconexão e múltiplos chunks. Teste RED original segue sem edição.
Mutmut 2.4.5 R2: 45 killed / 8 survived / 53 total = 84,91%, acima de 70%. Escopo patch documentado em direct-history-scope.patch, routers/execution.py (criação, coletor, cancelamento/finalização, source nos endpoints). Não é score do arquivo todo/projeto. Cancelamento RunControl segue coberto por regressão/E2E, não incluído no score R2.
Evidência: worktree D:/Development/.worktrees/oharness-sprint-20260918-7fd22a38/backend/mutation-direct-r2.log e cache mutmut (consultado após fim); SQL status counts 45/8. Sobreviventes IDs 24,27,28,39,40,43,45,50: arredondamento/guardas/fallbacks e exceção externa residual; não declarados mortos/equivalentes sem revisão.
E2E histórico após reforço: 3 dentro de 9 passed in 30.98s (suite inclui broker). Regressão backend 494 passed, 15 skipped in 38.76s. BDD pytest-bdd da story 3 passou anteriormente. Board QA; QA/ARCH frescos e aceite PO continuam pendentes.
