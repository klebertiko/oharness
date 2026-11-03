# CI no Windows (decisão de #344)

O produto é um app Windows, mas o `ci.yml` só rodava em `ubuntu-latest`: defeitos de link, junção, ACL e PATH (#339, #342, #344) nunca apareciam.

## Decisão
- Novo job `backend-windows` em `windows-latest`, **consultivo** (fora de `required.needs`, sem mexer no ruleset): roda só os testes sensíveis à plataforma (`test_turn_diff`, `test_sandbox_p3_followups`, `test_permission_policy`, `test_sandbox_paths`, `workspace_manager` sem o teste de corrida).
- Não roda a suíte inteira: medida local no Windows, ~12 min só sem os testes de corrida; o subconjunto custa uma fração disso.
- Ordem de promoção: observar o job estável por uma semana de PRs; só então incluí-lo em `required` (muda o ruleset e o `required-checks.test.mjs`) e ampliar o subconjunto (`factory_intake` depois de #341/#342, vitest depois de #343).
- Teste que precisa de privilégio de symlink usa `tests/link_support.py`: junção no Windows (sem privilégio) ou `pytest.skip` explícito quando o link não pode ser criado.
