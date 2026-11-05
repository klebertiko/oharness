# Definição da Forja como código

A Forja do OHarness é descrita por arquivos versionados no repositório do projeto, em `.oharness/forja/`. Mudar a Forja é mudar esses arquivos num branch e abrir um PR. O desenho está no [ADR 0056](../adr/0056-factory-definition-as-code.md).

Nunca há segredo nesses arquivos. Um valor sensível é sempre uma **referência opaca** `forja/<nome>` (`secretRef`), resolvida só em execução pelo cofre do sidecar.

## Estrutura

```
.oharness/forja/
  forja.yaml                       # nome, alias do foreman, repositórios, tiers, tetos, política, estágios
  agents/<id>/agent.md               # front matter (configuração) + corpo (instruções)
  agents/<id>/skills/<id>/SKILL.md   # skills de um agente
  skills/<id>/SKILL.md               # skills globais
  mcp/<id>.yaml                      # servidores MCP permitidos
  runners/<id>.yaml                  # runners (hoje só `local`)
  automations/<id>/automation.md     # automações (validadas pelo parser do intake)
  webhooks/<id>.yaml                 # webhooks (validados pelo parser do intake)
```

O caminho identifica o recurso: `agents/reviewer/agent.md` define o agente `reviewer`. Arquivo fora desta estrutura é **erro**, nunca ignorado em silêncio (`README.md` é a exceção). `scorers/` e `benchmarks/` são reservados e ainda não são lidos. Links simbólicos não são seguidos. Cada arquivo tem até 256 KB, em UTF-8; final de linha CRLF ou LF dá a mesma versão. Os ids usam letras minúsculas, dígitos e `-`, e não podem ser nomes reservados do Windows (`con`, `nul`, `com1`…).

## Formato

Os arquivos seguem o modelo `.ohm` (ADR 0003): YAML 1.2 restrito, um documento por arquivo, raiz objeto, sem âncoras, aliases, chaves duplicadas nem tags, com os mesmos limites do codec do app. Todo arquivo declara o seu `kind` (`forja` na raiz, junto de `schemaVersion`; `agent` no front matter de `agent.md`; `mcp`; `runner`). Fora da raiz, o `kind` é só cabeçalho e não entra na definição mesclada. Um runner diz o tipo em `type: local`.

## `forja.yaml`

```yaml
kind: forja
schemaVersion: 1.0.0
name: payments            # id da Forja (o mesmo `factory_id` dos work items)
alias: payments           # handle do foreman: @payments
defaults: { model: openai/gpt-4o }
repositories:
  - id: app
    path: .               # relativo ao repositório; só `/`, sem `..`, sem letra de unidade
    protectedBranches: [main]
tiers:
  fast: { models: [openai/gpt-4o-mini] }
  deep: { models: [openai/gpt-4o, anthropic/claude-opus] }
ceilings: { tokensPerWorkItem: 500000, tokensPerRun: 100000 }
policy:
  requireSpec: false          # true: o estágio spec passa a ser obrigatório
  specApproval: required      # required | optional (relaxar aparece no diff da versão)
  maxReviewReturns: 3
  reviewIndependence: require # require | warn | off
  maxPermissionMode: workspace_write
stages:
  review: { required: true }
```

## `agents/<id>/agent.md`

```markdown
---
kind: agent
role: review                  # foreman | triage | spec | implement | review | verify | monitor | custom
model: anthropic/claude-opus  # precisa estar em algum tier
permissions: { mode: read_only }  # plan | read_only | ask | auto_workspace | workspace_write | full
tokenCeiling: 50000
skills: [lint]
mcp: [docs]
secrets: [forja/npm-registry]
enabled: true
---
Instruções do agente (o corpo do arquivo).
```

Regras que o validador impõe:

- Exatamente um `foreman`, sempre ligado. Os demais papéis são opcionais (adoção parcial: só os agentes ligados participam).
- O modo de permissão de um agente não passa de `policy.maxPermissionMode`; subir esse teto é uma mudança explícita, visível no diff.
- `harness:` só em agente que não escreve (`plan` ou `read_only`): a execução por harness não dá ferramentas ao modelo.
- Estágio obrigatório precisa de um agente ligado com o papel correspondente.
- Com `reviewIndependence: require`, o agente de review precisa diferir do implement em modelo ou harness.
- Agentes `custom` não recebem as skills embutidas (`forja-definition`, `forja-intake`).
- Instruções e skills dão orientação, não acesso: o que um agente alcança vem só dos campos de configuração.

## Validar

```bash
python -m oharness forja validate .oharness/forja
python -m oharness forja validate .oharness/forja --check
```

Saída: um objeto JSON com `ok`, `hash`, `errors` e `warnings`. Código de saída `0` válido, `1` inválido, `2` pasta ausente. `--check` roda exemplos de work items pela definição no modo mock (sem provedor, sem rede) e confere que cada estágio obrigatório pode rodar.

Os erros citam o arquivo e o campo, nunca o valor. Qualquer valor com cara de credencial é recusado.

## Versões, canary e rollback

A versão é o SHA-256 da forma canônica da definição validada. Ativar é uma **ação humana** (credencial da pessoa, não a do token de integração) e grava um snapshot imutável. Work items ficam fixos na versão em que nasceram.

| Rota (`/factory/definition`) | O que faz |
| --- | --- |
| `POST /validate {workspace}` | Valida a pasta do projeto, mostra `update_available` e as mudanças em relação à versão ativa. |
| `POST /activate {workspace, mode, percent?, label?}` | Ativa como estável, ou como canary (`percent` de 1 a 50). Definição inválida é recusada (`422`) e a ativa continua valendo. |
| `POST /promote` · `POST /abort` | Torna o canary estável, ou descarta o canary. |
| `POST /rollback {factory_id, to?}` | Volta à versão anterior (ou à escolhida). Só afeta itens novos. |
| `GET /` · `GET /versions` · `GET /versions/{hash}` · `GET /diff?from=&to=` | Estado atual, histórico, snapshot e diferença campo a campo. |

O canary encaminha novos work items de forma determinística (hash do id do item). Enquanto houver um canary, não se ativa outra versão nem se faz rollback: promova ou aborte antes.

## Checagem no PR

Um workflow de exemplo que roda a verificação em todo PR que muda a definição:

```yaml
name: forja-definition
on:
  pull_request:
    paths: [".oharness/forja/**"]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r backend/requirements.txt
      - run: python -m oharness forja validate "$GITHUB_WORKSPACE/.oharness/forja" --check
        working-directory: backend
```

Ajuste `working-directory` e o caminho do `requirements.txt` ao lugar onde o backend do OHarness está no seu repositório.
