# ADR 0057 — Fábrica local: runner local e segredos da fábrica

Status: proposta (issue #244, pacote A). Depende de 0019, 0021 e 0056.

## Decisão

### Runner
- Único runner deste corte: **`local`**. Cada run de estágio roda com `worktree: true` (ADR 0019): worktree destacado e gerenciado do repositório registrado, uma pasta por run, limpeza com resgate do ADR 0008. Duas runs do mesmo repositório não se enxergam nem tocam o checkout principal.
- `runners.<id>.kind` aceita apenas `local` no schema da v1. **Docker é reservado**: entra por ADR próprio quando houver isolamento comprovado (rede, montagens, usuário sem privilégio) e teste de escape; um runner mal isolado seria pior que nenhum. Monorepo: `repositories[].subdir` seleciona o subdiretório de trabalho dentro do worktree.
- Concorrência: `runners.<id>.maxConcurrentRuns` (padrão 2). Excedente espera em `queued`.
- Runs de estágio com ferramentas usam o loop direto com broker (ADR 0054): herdam o preset do agente (ADR 0021), o teto de tokens (0025/0040) e os hooks (0026/0041). Runs de harness (sem ferramentas, ADR 0045) só servem a papéis sem escrita. Os branches protegidos da definição são conferidos antes de qualquer push (ADR 0055).

### Quatro fronteiras de credencial
1. **Credenciais de inferência** (conexões de Provider): ficam no cofre do sidecar e são usadas na fronteira do sidecar com o provedor; nunca entram no ambiente do worktree/comando (ADR 0045). Harness por CLI (Claude Code, Codex) usa a autenticação do próprio CLI no ambiente da run, configurada à parte da lista de segredos.
2. **Segredos de execução** (APIs, registries): lista de permissão **por agente**; sem lista, nenhum segredo (padrão).
3. **Identidade de repositório**: `credentialStrategy: user` (usa o git do usuário local; só para trabalho que a pessoa inicia) ou `factory` (padrão: sem credencial de push; as branches ficam locais, ou usa um `secretRef` com escopo `factory/*`, ADR 0055).
4. **Redação** é retaguarda, não substituto de permissões estreitas e rotação externa.

### Segredos da fábrica
- Armazenados no `secret_store` já existente (keychain ou arquivo), sob o nome exato do `secretRef` da definição, `factory/<nome>` (um cofre por instalação; fábricas diferentes usam nomes diferentes); a definição só traz `secretRef` (ADR 0056).
- Um agente só recebe um segredo se o listar em `secrets: [secretRef…]`; o valor é entregue **só àquela run**, por um canal que a sanitização de ambiente respeita: o runner o injeta na lista de variáveis permitidas daquele comando (extensão do `scrub_env` por chamada, nunca global) e só para ferramentas que o agente declarou. Nunca no prompt, no jornal, no work item, em log ou na UI. Como `redact_value` é por padrão de formato e não conhece um segredo arbitrário, o runner registra o **valor exato** de cada segredo entregue num redator por run e o remove de toda saída (jornal, resultado de ferramenta, eventos, artefatos de texto) além de `redact_value`. Limite honesto: um comando pode transformar o valor (base64, partes) e escapar da correspondência exata; por isso segredos só vão a agentes que os pedem na definição, e a revisão humana do diff é a última barreira.
- A UI cria/substitui/apaga segredos; **não há endpoint que devolva o valor**. A listagem mostra nome e data.

## Fora de escopo
Runners remotos/hospedados; Docker (ADR futuro); execução em nuvem.
