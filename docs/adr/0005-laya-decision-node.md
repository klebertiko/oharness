# ADR 0005 — Nó experimental de decisão tipada (Laya): consultivo, nunca gate

Status: Proposto (2026-10-02) · spike, não story — ver "Futuro" antes de expandir escopo
Origem: pedido do usuário (klebertiko), relayed pela sessão `skills-framework`
Prior art: `src/laya-playground/research-pack/03-oharness-harness-skills-comparison.md` §4.2/§6/§7

## Contexto

Laya hoje só existe na CI deste repo: `.github/workflows/laya-shadow.yml` +
`scripts/laya_issue_shadow.py`, disparado em `issues: opened/edited` ou
`workflow_dispatch`, permissão só `issues:read` (sem write — fisicamente não
pode comentar/rotular/fechar issue), `authority: "advisory-shadow"`. Já
validado ao vivo nas issues #3–#6.

O app (Tauri + sidecar FastAPI + Studio) não tem Laya. O catálogo de nós do
Studio é fixo — `NodeType` em `frontend/src/lib/types.ts:1-7`
(`agent | gate | hitl | skill | mcp | tool`) — e o grafo padrão Agile vem
hardcoded de `backend/oharness/compile_skills_harness.py` (`AGENT_ROLES`,
`_GRAPH_EDGES`), não de um doc. Adicionar Laya como nó de verdade é trabalho
de código do OHarness, não uma mudança de conteúdo.

O research pack já desenhou o encaixe mecânico (§4.2): processo Laya
separado, HTTP loopback em `127.0.0.1:<porta>` com lock, sidecar chama esse
loopback só quando um nó do grafo `.ohm` pede uma decisão tipada — nunca
misturado com `OH_SECRETS`/providers (pesos Laya são cache local HF, não
segredo de provider).

**Restrição inegociável** (repetida pelo usuário em múltiplos handoffs,
inclusive ao autorizar este ADR): Laya nunca tem autoridade sobre merge,
labels, roteamento de edge ou qualquer gate determinístico. Sempre
shadow/advisory. Qualquer ambiguidade sobre esse limite para o trabalho e
volta para o usuário — não se assume.

## Decisão

1. **Novo tipo de nó `"decision"`**, adicionado a `NodeType`
   (`frontend/src/lib/types.ts`). Autoridade fixa `"advisory-shadow"` —
   constante no código, não um campo editável no inspector, exatamente como
   `laya_issue_shadow.py` já trata `authority`.
2. **Campos novos em `NodeData`, só evidência:** `decisionQuestions` (mesmo
   shape já testado em `laya_issue_shadow.py`: `type: "choice" | "noul"` +
   `instructions` + `criteria`) e `decisionResult` (resposta do modelo +
   `latency_ms` + `schema_version`, igual ao `evidence` dict que o script de
   CI já grava). Nenhum campo deste nó participa de resolução de edge, retry
   ou decisão de HITL — isso é o contrato central deste ADR.
3. **Processo Laya separado do sidecar.** Loopback HTTP em
   `127.0.0.1:<porta>` com lock de arquivo (um processo por vez — GPU local
   compartilhada, sem fila concorrente com o sidecar OH). Pesos HF em cache
   local, fora de `OH_SECRETS`.
4. **Sidecar chama o loopback só quando a execução do grafo alcança um nó
   `type: "decision"`.** Fora disso, o processo Laya nem precisa estar de
   pé — nenhum outro nó depende dele.
5. **Resultado é sempre evidência anexada**, nunca uma branch do engine: o
   `node_done` desse nó carrega `decisionResult`, e nada no `execute_harness`
   lê esse campo para decidir o que fazer a seguir. O teste mais importante
   de qualquer story que use este nó é: remover o nó do grafo não muda
   nenhum resultado de gate dos outros nós.
6. **Falha honesta.** Processo Laya fora do ar, porta ocupada, timeout → o
   nó termina em erro claro (mesmo padrão de `ProviderResolutionError`
   honesto já usado em providers). Nunca um fallback silencioso para
   heurística ou resposta inventada.

## Alternativas rejeitadas

- **Reaproveitar o tipo `"skill"` existente.** Rejeitado: Skill hoje é
  conteúdo estático injetado no prompt de um agente, não uma chamada de
  inferência separada com processo e evidência próprios.
- **Laya com qualquer autoridade de gate** (aprovar, bloquear, rotear
  edge). Rejeitado explicitamente pelo usuário, repetidamente. Precisaria de
  uma decisão de produto nova e separada para sair desta restrição — não é
  algo que este ADR, ou qualquer implementação dele, pode relaxar por conta
  própria.
- **Pesos/cache Laya dentro de `OH_SECRETS`.** Rejeitado — mistura duas
  superfícies de segredo sem necessidade; cache de modelo HF não é
  credencial.

## Consequências

- O nó `"decision"` nunca entra em `_GRAPH_EDGES` do grafo Agile padrão
  compilado pelo `compile_skills_harness.py` — é opt-in, autorado manualmente
  no Studio por quem monta o grafo.
- QA e SEC de qualquer story que use este nó devem verificar a garantia do
  item 5 (remover o nó não muda nenhum gate) como parte do Definition of
  Done — não é opcional.
- Este ADR cobre o *spike*: processo loopback + um nó experimental mínimo
  provando o mecanismo ponta a ponta. Não cobre UI de produção no inspector,
  não cobre DoD completo (BDD, mutation, E2E) — isso é trabalho de uma story
  formal, com Sprint Planning, se o spike validar a direção.

## Futuro (fora deste spike)

Story formal (PO) se o spike aprovar: UI completa no `PropertiesPanel`,
biblioteca de perguntas reutilizáveis por domínio, medição de taxa de
escalonamento do cascade Laya (custo residual de LLM quando Laya não
resolve), calibração de threshold por domínio antes de qualquer uso em
produção. Nenhum desses itens relaxa a restrição de autoridade do item 2
da Decisão.
