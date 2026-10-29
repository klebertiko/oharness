# ADR 0045: `oharness run` com Providers reais

Status: aceita. Completa o #158 depois do ADR 0017 (que só rodava em modo mock).

## Decisão
- `python -m oharness run <bundle> --mode live|local [--workspace <projeto>] [--worktree] [--json]` executa o harness pelo **mesmo caminho do sidecar** (`routers.execution._execute_run`), não por uma cópia: a trava de orçamento global antes de qualquer gasto, a resolução de Provider por nó (só chega a um Provider que a pessoa conectou), a redação de todo evento antes de gravá-lo no jornal e de imprimi-lo, o jornal durável (a run aparece no histórico do app) e o worktree por run (ADR 0019).
- **Segredos:** as conexões vêm do banco do sidecar e as credenciais do cofre escolhido por `OH_SECRETS` (`file` ou `keychain`; com `memory`, o padrão, o cofre está vazio e o nó falha com a mensagem de credencial ausente). A chave nunca vai para argv, ambiente do filho, stdout ou stderr: o texto que os adapters devolvem é redigido antes de sair, e os erros de Provider usam as mensagens genéricas de `providers/outcomes`.
- **Permissão:** um terminal não responde perguntas. Um nó HITL (autoridade humana) **para a run** (`stopped`, saída 1); nada é aprovado automaticamente. O motor de harness não oferece ferramentas ao modelo; o modo de permissão do chat (ADR 0021) continua valendo só no chat.
- **Workspace:** `--workspace` só vale para um projeto registrado no OHarness, como no app; um caminho desconhecido é recusado (saída 2), em vez de ignorado em silêncio. `--worktree` exige `--workspace`.
- **Saídas:** `0` complete; `1` run `stopped`/`error`/orçamento recusado/queda; `2` harness inválido ou pedido recusado antes de começar (nada em stdout).
- **Esquema:** `run-event.schema.json` passou a cobrir também `error`, `worktree_ready`, `worktree_closed`, `route_decision`, `budget_warning` (e `node_restored`, ADR 0044), os eventos que uma run real pode emitir.

## O que não foi verificado aqui (ambiente de nuvem, sem chaves nem rede)
- Chamada real a um Provider (Anthropic, OpenAI, Ollama, CLIs `claude`/`codex`): os testes usam um adapter de teste no lugar de `providers.resolution.get_adapter`. A verificar no ambiente local: `OH_SECRETS=keychain python -m oharness run <bundle> --mode live --json` com uma conexão real, conferindo que a chave não aparece na saída.
- Cofre `keychain` do SO.
