# ADR 0067 — Forja: o nome e o formato da definição

Status: aceita por decisão do usuário (2026-11-04). Altera os ADRs 0056 e 0064 no que o usuário vê.

## Contexto
O nome "Factory" concorre com um produto existente. O formato da definição (ADR 0056) foi desenhado antes de o modelo OHM em YAML (ADR 0003) virar o padrão do app.

## Decisão
**Nome.** A fábrica local se chama **Forja**: nome próprio, igual em pt-BR e en (como Nilo). Muda só o que a pessoa vê:
- CLI: `oharness forja ...` (era `oharness factory ...`); servidor MCP `oharness-forja` e ferramentas `forja_*`.
- Pasta `.oharness/forja/` e arquivo raiz `forja.yaml`.
- Referência a segredo `forja/<nome>` (também no cofre) e branches de trabalho `forja/<item>`.
- Textos, mensagens de erro, docs (`docs/forja/`) e nomes de skills embutidas (`forja-definition`, `forja-intake`).

Ficam como estão, por serem internos: os módulos Python `factory` e `factory_intake`, as tabelas `factory_*`, as rotas `/factory/...` do sidecar, `factory_id` e os campos de API. Quem usava o nome antigo não tem compatibilidade a manter: o app é pré-lançamento (0.0.1-alpha), então o prefixo `factory/` de segredos e de branches não é aceito em paralelo.

**Formato.** A definição segue o modelo `.ohm` (ADR 0003): YAML 1.2 restrito lido pelo codec do app (`oharness.codec`), com um documento por arquivo, raiz objeto, sem âncoras, aliases, merge keys, chaves duplicadas nem tags, e com os mesmos limites de recursos. O layout em vários arquivos continua; cada arquivo declara um campo `kind`: `forja` (raiz, com `schemaVersion: 1.0.0` no lugar de `apiVersion`), `agent` (no front matter de `agent.md`), `mcp` e `runner`. O `kind` fora da raiz é cabeçalho e não entra na definição mesclada; por isso o campo que dizia o tipo do runner passa a se chamar `type`. O schema continua gerado da tabela única de regras (`definition_rules.py`) e agora se chama `forja-definition.schema.json`.

## Consequências
Os ADRs 0053–0064 mantêm o texto histórico; onde citam `factory`, vale esta decisão. Webhooks e automações (pacote B) continuam com os seus formatos próprios, validados pelos parsers do intake, só que sob `.oharness/forja/`.
