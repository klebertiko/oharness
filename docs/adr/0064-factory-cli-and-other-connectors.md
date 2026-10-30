# ADR 0064: CLI `oharness factory` e demais conectores

Status: aceita (implementação nos PRs de CLI e esqueletos). Conceitos de: docs.warp.dev/factories (integrações Slack, Teams, Linear, Jira, GitLab, Azure DevOps e "other code forges"); desenho próprio.

## CLI
`oharness factory submit|list|status|comment|cancel|claim|release|metrics|inbox|serve|mcp`, todos com `--json`: um objeto por comando (um por linha em `list`), validado contra `backend/oharness/schema/factory.schema.json` antes de imprimir (mesmo princípio do `run-event.schema.json`; um teste confere que a saída cabe no schema). Saídas: `0` ok; `1` falha do pedido ou da fábrica; `2` uso inválido ou recusa antes de agir. Erros vão para stderr com `code` estável. A CLI usa a `FactoryPort` em processo (como `oharness run`, ADR 0045); sem a fundação instalada ela diz isso em vez de falhar obscuramente. `claim --worktree <repo>` prepara o worktree local (por `run_worktree`) e `release` o devolve; nenhum subcomando faz merge ou push.

## Demais conectores: GitLab, Azure DevOps, Linear, Jira, Slack, Teams
Entregues como **esqueleto + fixture**: `Connector.parse` sobre um payload de exemplo da documentação pública, com teste; `reply` levanta `NotImplementedError` e o conector é marcado `experimental` até ser verificado contra o serviço real. **Nada disso é prometido como funcionando.** Todos usam a mesma autenticação (HMAC/token do cofre), replay, taxa e tamanho do ADR 0059, o mesmo `deliver` e os mesmos filtros (ADR 0062). Notas por serviço, só como mapa de eventos a verificar:
- **GitLab:** eventos de merge request e comentário (webhook de grupo/projeto, `X-Gitlab-Token`); menção ao usuário-bot da fábrica.
- **Azure DevOps:** service hooks (work item e PR); autenticação por cabeçalho básico configurado no hook.
- **Linear / Jira:** sessão de agente ou atribuição/menção; resposta como comentário no issue.
- **Slack / Teams:** menção ao app, mensagem direta; assinatura de requisição própria de cada plataforma; resposta no mesmo thread. Exigem app instalado no workspace pelo dono — fora do que se prova no sandbox.
- **Outros forges (Bitbucket, GitLab auto-hospedado):** sem eventos próprios; o trabalho entra por webhook genérico (ADR 0061), polling ou CLI.
