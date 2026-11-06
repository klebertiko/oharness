# ADR 0057 — Fábrica local: runner local e segredos da fábrica

Status: aceita; implementada em partes (as peças do #260 estão na main; a ligação ao loop de run é a issue #440). Depende de 0019, 0021 e 0056.

## Decisão

### Runner
- Único runner deste corte: **`local`**. Cada run de estágio roda com `worktree: true` (ADR 0019): worktree destacado e gerenciado do repositório registrado, uma pasta por run, limpeza com resgate do ADR 0008. Duas runs do mesmo repositório não se enxergam nem tocam o checkout principal.
- `runners.<id>.type` aceita apenas `local` no schema da v1. **Docker é reservado**: entra por ADR próprio quando houver isolamento comprovado (rede, montagens, usuário sem privilégio) e teste de escape; um runner mal isolado seria pior que nenhum. Monorepo: `repositories[].subdir` seleciona o subdiretório de trabalho dentro do worktree.
- Concorrência: `runners.<id>.maxConcurrentRuns` (padrão 2). Excedente espera em `queued`.
- Runs de estágio com ferramentas usam o loop direto com broker (ADR 0054): herdam o preset do agente (ADR 0021), o teto de tokens (0025/0040) e os hooks (0026/0041). Runs de harness (sem ferramentas, ADR 0045) só servem a papéis sem escrita. Os branches protegidos da definição são conferidos antes de qualquer push (ADR 0055).

### Quatro fronteiras de credencial
1. **Credenciais de inferência** (conexões de Provider): ficam no cofre do sidecar e são usadas na fronteira do sidecar com o provedor; nunca entram no ambiente do worktree/comando (ADR 0045). Harness por CLI (Claude Code, Codex) usa a autenticação do próprio CLI no ambiente da run, configurada à parte da lista de segredos.
2. **Segredos de execução** (APIs, registries): lista de permissão **por agente**; sem lista, nenhum segredo (padrão).
3. **Identidade de repositório**: `credentialStrategy: user` (usa o git do usuário local; só para trabalho que a pessoa inicia) ou `forja` (padrão: sem credencial de push; as branches ficam locais, ou usa um `secretRef` com escopo `forja/*`, ADR 0055).
4. **Redação** é retaguarda, não substituto de permissões estreitas e rotação externa.

### Segredos da fábrica
- Armazenados no `secret_store` já existente (keychain ou arquivo), sob o nome exato do `secretRef` da definição, `forja/<nome>` (um cofre por instalação; fábricas diferentes usam nomes diferentes); a definição só traz `secretRef` (ADR 0056).
- Um agente só recebe um segredo se o listar em `secrets: [secretRef…]`; o valor é entregue **só àquela run**, por um canal que a sanitização de ambiente respeita: o runner o injeta na lista de variáveis permitidas daquele comando (extensão do `scrub_env` por chamada, nunca global) e só para ferramentas que o agente declarou. Nunca no prompt, no jornal, no work item, em log ou na UI. Como `redact_value` é por padrão de formato e não conhece um segredo arbitrário, o runner registra o **valor exato** de cada segredo entregue num redator por run e o remove de toda saída (jornal, resultado de ferramenta, eventos, artefatos de texto) além de `redact_value`. Limite honesto: um comando pode transformar o valor (base64, partes) e escapar da correspondência exata; por isso segredos só vão a agentes que os pedem na definição, e a revisão humana do diff é a última barreira.
- A UI cria/substitui/apaga segredos; **não há endpoint que devolva o valor**. A listagem mostra nome e data.

## Fora de escopo
Runners remotos/hospedados; Docker (ADR futuro); execução em nuvem.

## Implementação (#260)
`backend/factory/runner.py`: worktree por run via o gerenciador de workspaces, na branch `forja/<item>-<run>` (nomes validados); `RunnerPool` (limite de runs simultâneas); `runner_config` (padrões `local`, 2, `forja`); `secrets_for` entrega só os segredos que o agente lista, como `FORJA_SECRET_<NOME>`, ao comando daquela chamada (`sandbox.exec.run` com `env`), e `RunRedactor` remove o valor exato e suas formas em base64 e URL da saída; `deny_command` recusa push para ramo protegido e merge (camada extra, a garantia é a credencial e a proteção no servidor). `/factory/secrets` (humano) cria, substitui e apaga; a lista mostra nome e data (tabela `factory_secret_index`) e nenhum caminho devolve valor. Docker segue reservado. Guia: `docs/forja/runner.md`. O disparo dos estágios usa estas peças quando o loop de run da Forja for ligado. Rodada de revisão: o guarda lê as palavras do comando (aspas desfeitas, `sh -c` aberto, opções globais com valor como `git -C d` e `gh -R o/r` puladas) e recusa também `gh alias`; ficam fora do guarda, e por isso só a credencial e a proteção no servidor garantem, scripts, aliases do git e indireção por variável; dois segredos que viram a mesma variável recusam a run; a saída truncada perde também um prefixo de segredo no fim; o corpo recusado de `PUT /factory/secrets` não devolve o valor. Segunda rodada: `secrets_for` só lê referências `forja/<nome>` (o cofre também guarda chaves de provedor); a saída do comando chega crua do sandbox (`redact_output=False`), o valor exato sai primeiro e só depois os padrões, para que um segredo que contém um trecho conhecido saia inteiro; `PUT /factory/secrets` exige ao menos 4 caracteres (o que não dá para remover da saída não entra); `run_as_agent` só roda dentro da raiz dos worktrees do gerenciador (nunca o checkout principal).

## O que o #260 entrega e o que falta
**Entregue (as peças, com testes):** worktree por run na branch `forja/<item>-<run>` (`create_run_workspace`, `remove_run_workspace`), fila por `maxConcurrentRuns` (`RunnerPool`), segredos por referência `forja/<nome>` entregues só ao comando do agente que os lista e removidos do resultado (`secrets_for`, `run_as_agent`), o guarda de push e merge (`deny_command`) e `/factory/secrets`. **Ainda sem chamador em produção:** `run_as_agent`, `RunnerPool` e `create_run_workspace` só são chamados por testes (o router de segredos usa apenas o cofre). A ligação ao loop de run é a **issue #440**. **Redação:** hoje vale para o resultado de `run_as_agent`; jornal, eventos e artefatos da run entram com a ligação (#440). **Limite de melhor esforço:** um segredo dividido entre stdout e stderr, ou cortado no meio de um caractere multibyte, pode escapar da correspondência exata.

