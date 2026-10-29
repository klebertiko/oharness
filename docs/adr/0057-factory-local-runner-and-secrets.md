# ADR 0057 — Fábrica local: runner local e segredos da fábrica

Status: proposta (issue #244, pacote A). Depende de 0019, 0021 e 0056.

## Decisão

### Runner
- Único runner deste corte: **`local`**. Cada run de estágio roda com `worktree: true` (ADR 0019): worktree destacado e gerenciado do repositório registrado, uma pasta por run, limpeza com resgate do ADR 0008. Duas runs do mesmo repositório não se enxergam nem tocam o checkout principal.
- `runners.<id>.kind` aceita apenas `local` no schema da v1. **Docker é reservado**: entra por ADR próprio quando houver isolamento comprovado (rede, montagens, usuário sem privilégio) e teste de escape; um runner mal isolado seria pior que nenhum. Monorepo: `repositories[].subdir` seleciona o subdiretório de trabalho dentro do worktree.
- Concorrência: `runners.<id>.maxConcurrentRuns` (padrão 2). Excedente espera em `queued`.
- Toda run herda o preset de permissão do agente (ADR 0021), o teto de tokens (0025/0040) e os hooks (0026/0041). Os branches protegidos da definição são conferidos antes de qualquer push (ADR 0055).

### Segredos da fábrica
- Armazenados no `secret_store` já existente (keychain ou arquivo), no namespace `factory/<factory_id>/<nome>`; a definição só traz `secretRef` (ADR 0056).
- Um agente só recebe um segredo se o listar em `secrets: [secretRef…]`; o valor entra no ambiente **só daquela run**, nunca no prompt, no jornal, no work item, em log ou na UI. Toda saída passa por `redact_value`.
- A UI cria/substitui/apaga segredos; **não há endpoint que devolva o valor**. A listagem mostra nome e data.

## Fora de escopo
Runners remotos/hospedados; Docker (ADR futuro); execução em nuvem.
