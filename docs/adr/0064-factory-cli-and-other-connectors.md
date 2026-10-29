# ADR 0064: CLI `oharness factory` e demais conectores

Status: aceita (implementação nos PRs de CLI e esqueletos).

## CLI
`oharness factory submit|list|status|comment|cancel|claim|release|metrics|mcp`, todos com `--json`: um objeto por comando (ou um por linha em `list`), validado contra `backend/oharness/schema/factory.schema.json` antes de imprimir (mesmo princípio do `run-event.schema.json`). Saídas: `0` ok; `1` falha do pedido/da fábrica; `2` uso inválido ou recusa antes de agir. Erros vão para stderr com `code` estável.

## GitLab, Azure DevOps, Linear, Jira, Slack, Teams
Entregues como **esqueleto + fixture**: implementam `Connector.parse` sobre um payload de exemplo da documentação pública do serviço, com teste; `reply` fica `NotImplementedError` e o conector é marcado `experimental` até ser verificado contra o serviço real. Nada disso é prometido como funcionando. Cada um usa o mesmo caminho de autenticação (HMAC/token do cofre), replay, taxa e tamanho do ADR 0059.
