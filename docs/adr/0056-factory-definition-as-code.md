# ADR 0056 — Fábrica local: definição como código (schema, versões, canary, rollback)

Status: proposta (issue #244, pacote A). Depende de 0054 e 0055. O desenho do formato é **próprio do OHarness** (as fontes públicas consultadas não detalham o formato).

## Decisão

### Layout versionado no repositório do projeto
```
.oharness/factory/
  factory.yaml                       # raiz: nome, alias (handle do foreman), defaults, repositórios, tiers, política, estágios
  agents/<id>/agent.md               # frontmatter (configuração) + corpo (instruções)
  agents/<id>/skills/<id>/SKILL.md   # skills de um agente
  skills/<id>/SKILL.md               # skills globais
  mcp/<id>.yaml                      # servidores MCP permitidos (comando/URL; credenciais só por secretRef)
  runners/<id>.yaml                  # runners (ADR 0057)
  automations/<id>/automation.md     # reservado ao pacote B
  webhooks/<id>.yaml                 # reservado ao pacote B
  scorers/<id>/scorer.md             # reservado ao pacote C
  benchmarks/<suite>/{suite.yaml,tasks/}  # reservado ao pacote C
```
O caminho identifica o recurso (`agents/reviewer/agent.md` define o agente `reviewer`). **Work items, runs, conversas, memórias e métricas ficam fora da definição** (são dados, ADR 0053). A definição mora **no repositório do projeto** (não há fonte hospedada); `alias` é o handle do foreman e `defaults` traz harness e modelo padrão dos agentes.
`factory.yaml` (resumo): `apiVersion: oharness.factory/v1`, `name`, `alias`, `repositories[]` (`{id, path, subdir?, protectedBranches[]}`), `tiers{}`, `ceilings{tokensPerWorkItem, tokensPerRun}`, `policy{requireSpec, maxReviewReturns}` (padrão 3), `stages{}` (`enabled`/`required`), `runners{}` (ADR 0057), `automations[]` (esquema reservado; preenchido pelo pacote B).

### Schema e validação
JSON Schema em `backend/oharness/schema/factory.schema.json`, validado por `python -m oharness factory validate <dir>` (saída `0` válido, `1` inválido, a convenção do `oharness validate` existente; `2` fica para argumento ou pasta ausente) e pelo sidecar antes de qualquer ativação. Esta validação é a **verificação de configuração** ("configuration check"): o mesmo comando roda em CI no PR que muda a definição (workflow de exemplo em `docs/`), e o sidecar **mantém a última definição ativada válida** se uma nova falhar. A validação também checa referências cruzadas (agente→skill, agente→mcp, tier→modelo) e que nenhuma `path` escape do repositório.

### Nunca segredo no arquivo
Valores sensíveis são **referência opaca ao cofre**: `secretRef: "factory/<nome>"`, resolvida só em runtime pelo `secret_store` (ADR 0057). O schema usa `additionalProperties: false` em todo objeto, então um campo inventado como `apiToken` ou `client_secret` é rejeitado por **não existir**, não por heurística de nome. Os únicos campos do schema que aceitam referência a segredo são `secretRef` e itens de `secrets[]`, e ambos exigem o formato `factory/<nome>`. Nomes legítimos que contêm "token" (`tokenCeiling`, `tokensPerWorkItem`, `tokensPerRun`, `maxTokens`) são de orçamento e existem no schema com tipo inteiro. Além disso o validador rejeita qualquer **valor** de texto que case com os padrões de `studio_copilot/redaction.py`. Erros citam o caminho do campo, nunca o valor. Um teste de contrato percorre o **schema real** e garante que todo campo de texto livre passa pela checagem de valor e que nenhum campo de segredo aceita outra coisa além de `secretRef`.

### Versões, diff, canary e rollback
- **Versão** = hash SHA-256 da forma canônica da definição validada, mais `label` opcional. Ativar grava um **snapshot imutável** em `factory_versions {hash, definition_json, activated_at, activated_by, previous_hash, mode}`; runs em andamento e work items ficam fixados na versão em que nasceram (ADR 0053).
- **Diff**: `GET /factory/definition/diff?from=&to=` compara snapshots (campo a campo, com segredos já ausentes por construção).
- **Ativação é ação humana** (`POST /factory/definition/activate`), depois de validar. O sidecar lê a definição do checkout do projeto; nunca grava nele. Detectar que a branch default do projeto avançou e a definição mudou gera um aviso na sala de controle ("nova versão disponível"); aplicar continua um clique humano.
- **Canary local**: `mode: canary` com `percent` (1–50) roteia novos work items para a versão candidata de forma determinística (hash do id do item), o restante segue na estável. As métricas (ADR 0058) são separadas por versão para comparar. `promote` torna a candidata estável; `abort` volta tudo para a estável.
- **Rollback**: `POST /factory/definition/rollback` reativa o `previous_hash` (ou um hash escolhido). Só afeta itens novos; itens em curso continuam fixados.
- **Teste da própria definição**: `factory validate --check` roda a definição contra work items de exemplo no modo mock (sem rede/provider), como o `oharness run` mock (ADR 0017).

### Mudanças por PR
Mudar a fábrica = mudar arquivos num branch e abrir PR. Agentes (inclusive o foreman) podem **propor** edição na definição, mas só pelo mesmo caminho de qualquer mudança de código: branch `factory/`, PR, revisão e merge por pessoa. A ativação continua uma ação humana separada do merge.

## Escolhas conservadoras
YAML restrito (sem tags, âncoras limitadas), tamanho máximo por arquivo 256 KB. Docker e outros runners entram no schema só quando existirem no runtime (ADR 0057).

## Implementação (#256)
Escolhas que o texto acima deixava abertas ou que o código já ocupava:
- **Nome do schema.** `factory.schema.json` já descreve a saída `--json` do `oharness factory` (ADR 0064). O schema da definição é `backend/oharness/schema/factory-definition.schema.json`, **gerado** de uma tabela única de regras (`backend/factory/definition_rules.py`) e comparado por teste com o arquivo versionado; o validador e o espelho da UI saem da mesma tabela.
- **Modo de permissão.** O campo é `permissions.mode` (os modos do ADR 0021), não `preset`; o teto da fábrica é `policy.maxPermissionMode` (padrão `workspace_write`), e `harness:` só vale com `plan` ou `read_only`.
- **Runners** só por arquivo (`runners/<id>.yaml`); `factory.yaml` não repete `runners`, `agents`, `skills` ou `mcp` (vêm do layout). `automations/` e `webhooks/` são validados pelos parsers do pacote B e o texto entra na versão; `scorers/` e `benchmarks/` ficam reservados.
- **Tabela `factory_versions`** é o log de ativações (`kind`: activate, canary, promote, abort, rollback) com o snapshot canônico em cada linha; a versão estável e o canary em curso são calculados do log. Com canary aberto, nem nova ativação nem rollback: promote ou abort primeiro.
- **YAML:** âncoras e aliases são recusados (em vez de "âncoras limitadas"); chaves duplicadas e tags também. Links simbólicos e junções não são seguidos; ids que o Windows não cria (`con`, `nul`…) são recusados para o checkout valer em qualquer sistema; CRLF e LF dão o mesmo hash.
- **Rotas** em `/factory/definition` (`validate`, `activate`, `promote`, `abort`, `rollback`, `diff`, `versions`). Quem escolhe a pasta é o projeto registrado no app, nunca um caminho enviado pelo cliente. Mudar a versão ativa exige a credencial humana (ADR 0055).
- **`factory validate --check`** percorre três work items de exemplo (correção pequena, precisa de spec, ambíguo) pelos estágios que a definição liga e falha se um estágio obrigatório não roda ou se a revisão não pode ser independente.
- Guia de uso e workflow de exemplo para o PR: `docs/factory/definition.md`.
