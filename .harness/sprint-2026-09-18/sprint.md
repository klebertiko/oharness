# Sprint 2026-09-18 — OHarness

**Sprint Goal:** No chat, o usuário digita `/` e o assistente (Ollama/HTTP ou CLI) lê arquivos e
executa comandos de verdade no workspace autorizado, com contenção e aprovação explícitas — e a
execução direta passa a guardar histórico.

**Fonte:** `D:\Development\handoffs\2026-09-18-oharness-consolidated-continuation.md` §"Próximos passos".
**Restrição de capacidade:** as duas contas (Claude e Codex) bateram limite semanal; reset
2026-09-20 05:00 America/Sao_Paulo. Até lá: trabalho interativo, sem subagentes em background.
Gates QA/SEC (fresh-context) só depois do reset.

## Divisão

Critério: quem já tem o contexto do código + skills disponíveis em cada lado. Claude fica com o
contrato/ameaças, FE e design (skills `threat-model`, `hallmark`, `gauntlet-loop`). Codex fica com o
backend de execução que ele mesmo escreveu (direct/Automate) e com o BE das tools de chat, sobre o
contrato que o Claude fecha primeiro.

| Ordem | Story | Dono | Pts | Prio | Depende de |
|---|---|---|---|---|---|
| 1 | CHAT-TOOLS-CONTRACT (threat-model + contrato API + ADR) | **Claude** (ARCH+SEC) | 3 | P0 | — |
| 2 | CHAT-TOOLS-BE (endpoint de tools, discovery, read, exec, contenção) | **Codex** (BE) | 8 | P0 | 1 |
| 3 | CHAT-TOOLS-FE (`/` → endpoint real, Command/Skill/Tool, aprovação) | **Claude** (FE) | 5 | P0 | 1 |
| 4 | DIRECT-HISTORY (persistir ExecutionLog no modo direto; fecha o RED) | **Codex** (BE) | 3 | P1 | — |
| 5 | AUTOMATE-CHECKPOINT (ler diffs, confirmar peças 1/2/4/6, crítico) | **Codex** (BE+QA) | 3 | P1 | — |
| 6 | CONTEXT-GAUNTLET-R2 (provenance measured/estimated no rollup) | **Claude** (FE) | 2 | P2 | — |
| 7 | STUDIO-REDESIGN (continua a story de sprint-2026-09-15) | **Claude** (FE) | 8 | P2 | — |
| 8 | DOSSIER-CRED-LENGTH (teste de credential-length em Dossier) | **Claude** (FE) | 1 | P2 | — |

Total: Claude 19 pts · Codex 14 pts. A STUDIO-REDESIGN (8) é a válvula: se o sprint estourar, ela
volta ao backlog — nunca as P0.

## Regras que valem para os dois lados

- Ledger primeiro: `story-<ID>/ledger.md` lido antes de começar, anexado antes de sair.
- TDD: RED registrado antes do GREEN, por fatia de AC (`tdd` skill).
- Checkout compartilhado: `git status` antes de tocar; não reiniciar backend/frontend sem checar run
  em andamento; backend roda sem `--reload` (fix "ao vivo" exige reinício explícito e verificado).
- E2E/mutation só em cópia isolada.
- QA → ARCH → SEC sempre em contexto novo; merge só humano (HITL).
- Sem inventar números: contagens de testes só com a saída do comando.

## Sequência entre os lados

1. Claude fecha CONTRACT (story 1) e publica `contract.md` na pasta da story.
2. Codex começa DIRECT-HISTORY e AUTOMATE-CHECKPOINT (independentes) enquanto o contrato não sai.
3. Contrato publicado → Codex faz CHAT-TOOLS-BE; Claude faz CHAT-TOOLS-FE contra o mesmo contrato,
   com mocks HTTP do contrato até o BE existir.
4. Integração: FE contra BE real, em dev server isolado. Depois QA/ARCH/SEC frescos.

## Board

Uma linha por story; só o dono move a própria linha. Colunas: Sprint Backlog → In Progress → QA → ARCH → SEC → HITL → Done (ou BLOCKED).

| Story | Dono | Coluna | Última mudança |
|---|---|---|---|
| CHAT-TOOLS-CONTRACT | claude | HITL | 2026-09-24 SEC-PASS (gates/sec-2026-09-24.md); sem P0/P1. Carrega P2-1/P2-2 (denylist estreitada vs threat model; regex de redação falha em chave entre aspas) a fechar nesta sprint |
| CHAT-TOOLS-BE | codex | HITL | 2026-09-24 SEC-PASS (gates/sec-2026-09-24.md); implementação fiel ao contrato, contenção de raiz/401/gate de exec verificados ao vivo. Herda P2-1/P2-2 (fix em backend/sandbox/secrets.py) |
| CHAT-TOOLS-FE | claude | HITL | 2026-09-24 SEC-PASS; P2-FE-1 e P2-FE-2 fechados (commit 3a41508) — runId propagado até ToolCard, token comparado por origem. Regressão limpa. Pronta para merge |
| DIRECT-HISTORY | codex | HITL | 2026-09-24 SEC-PASS (gates/sec-2026-09-24.md); logs atrás do token, eventos persistidos redigidos, erros de provider sanitizados. P3-4 no backlog (redigir também sem broker) |
| AUTOMATE-CHECKPOINT | codex | HITL | 2026-09-24 SEC-PASS (gates/sec-2026-09-24.md); auditoria, só teste novo. Scheduler reusa _validated_project_cwd e automação agendada não constrói ToolBroker — não dispara exec |
| CONTEXT-GAUNTLET-R2 | claude | HITL | 2026-09-24 SEC-PASS (gates/sec-fe-2026-09-24.md); nenhum achado de nenhuma severidade — aritmética pura sobre estado do cliente, rótulo de proveniência de união fechada renderizado como texto, sem entrada/rede/persistência |
| STUDIO-REDESIGN | claude | Sprint Backlog | 2026-09-18 planning |
| DOSSIER-CRED-LENGTH | claude | HITL | 2026-09-24 SEC-PASS (gates/sec-2026-09-24.md); length:null melhora honestidade sem piorar disclosure — só prefix+4 últimos, input type=password, valor limpo do DOM, nunca entra em state |

## Propriedade de arquivos — mudanças não sobrepostas

Regra única: **cada caminho tem um dono; o outro lado não edita**. Precisa de algo no território
alheio → escreve o pedido em `STATUS.md` (linha `PEDIDO`) e segue com outra fatia.

| Território | Dono | Inclui |
|---|---|---|
| `backend/**` | **Codex** | routers, adapters, automations, models, sandbox (novo), `triage.py`, `backend/tests/**` |
| `frontend/**` | **Claude** | componentes, stores, `chatCommands.ts`, `Transcript.tsx`, `Dossier*`, testes Vitest |
| `docs/adr/**`, `SOUL.md` | **Claude** | ADR do broker; capacidades por provider |
| `story-CHAT-TOOLS-CONTRACT/**` | **Claude** | `contract.md`, `threat-model.md`. Codex propõe mudanças em `contract-proposals.md` (append) e Claude responde na mesma pasta |
| `story-<ID>/ledger.md` | dono da story | o outro lado só lê |
| `sprint.md` §Board | quem move a story | edita só a própria linha |
| `STATUS.md` | os dois | **append-only**, nunca reescrever linha alheia |
| `.harness/sprint-2026-09-15/story-AUTOMATE-*/ledger.md` | **Codex** | via AUTOMATE-CHECKPOINT |
| `.harness/sprint-2026-09-15/story-CONNECTION-CONTEXT-GAUNTLET/`, `story-STUDIO-REDESIGN/` | **Claude** | |

Git no checkout compartilhado:
- `git add <caminhos explícitos>` só do próprio território. **Nunca** `git add -A`, `git add .`,
  stash, reset, checkout de arquivo alheio.
- Mensagem de commit começa com `[<STORY-ID>][claude|codex]`.
- Commit não é merge: HITL faz o merge. Commits servem para o outro lado ver o diff estável.

Servidores:
- Codex é dono do backend na 8000; Claude é dono do frontend na 3000. Ninguém reinicia o servidor
  do outro. Integração FE↔BE: cópia isolada (`git worktree add` em outra pasta, portas 8001/3001),
  nunca o checkout vivo.

## Protocolo de status — os dois ficam sabendo

Arquivo: `STATUS.md` nesta pasta. Feed cronológico, append-only, uma linha por evento.

```
YYYY-MM-DD HH:MM | claude|codex | STORY-ID | <evento> | <nota curta, opcional>
```

Eventos válidos:
- `START` — story saiu de Sprint Backlog para In Progress (também move a linha em §Board)
- `RED <AC#>` / `GREEN <AC#>` — fatia TDD (detalhe fica no ledger; aqui só o marco)
- `READY-FOR-QA` · `QA-PASS` · `QA-BOUNCE <motivo>` · `ARCH-PASS` · `SEC-PASS` · `SEC-BOUNCE <motivo>`
- `BLOCKED <motivo>` / `UNBLOCKED`
- `PEDIDO <o que precisa do outro lado>` / `ATENDIDO <ref>`
- `CONTRACT-PUBLISHED` / `CONTRACT-CHANGED <o quê>` — só Claude; Codex usa `PEDIDO` para propor
- `CHECKPOINT` — fim de sessão: última linha do turno, com o próximo passo em uma frase

Obrigações:
1. **Início de todo turno**: ler `STATUS.md` inteiro antes de qualquer edição. Se há `PEDIDO`
   dirigido a você, responder (`ATENDIDO` ou `BLOCKED`) antes de nova fatia.
2. **Toda mudança de coluna**: uma linha aqui + mover a linha em §Board.
3. **Fim de todo turno**: linha `CHECKPOINT`. Sem ela, o outro lado assume que a sessão morreu
   sem registrar (aconteceu duas vezes neste projeto) e pode retomar a story.
4. Nunca editar ou apagar linha alheia. Erro próprio → nova linha corrigindo.
5. Contagens de testes só com a saída real do comando.

## Estratégia de testes — obrigatória nos dois lados (pedido HITL 2026-09-18)

Além de unit/TDD, toda story de código entrega, e o QA verifica:

| Camada | Backend (Codex) | Frontend (Claude) | Onde roda |
|---|---|---|---|
| **BDD** | `pytest-bdd` (nova dep) sobre `story-CHAT-TOOLS-CONTRACT/features/*.feature`, copiadas para `backend/tests/features/` | Vitest: um `it("<Scenario>")` por cenário, nome literal igual ao `.feature` | checkout vivo |
| **Regressão** | suíte pytest inteira + testes-trava SEC-1/3/4/5 (argv CLI, CORS, token 401, `_kill`) | `vitest run` inteiro + `tsc --noEmit` + `npm run test:ohm:e2e` | checkout vivo |
| **Mutation** | `mutmut` com `paths_to_mutate` ampliado para os arquivos da story; alvo ≥ 90% em `sandbox/paths.py`/`secrets.py`, ≥ 70% no resto | `@stryker-mutator/vitest-runner` nos arquivos da story; alvo ≥ 70% | **só worktree isolado** (incidente anterior mutou `triage.py` no checkout vivo) |
| **E2E** | uvicorn real na 8001 + provedor fake OpenAI-compatível + Cowork project temporário; cenários das features via SSE | Playwright (`@playwright/test`) contra 3001+8001: menu `/`, card de aprovação, estados, stop | **só worktree isolado** |

Regras:
- Score de mutation e contagem de E2E são o número impresso pela ferramenta; sem número, sem claim.
- Cenário BDD sem step implementado fica marcado `pending` no relatório, não apagado.
- Story sem as quatro camadas não sai de QA: `QA-BOUNCE missing:<camada>`.
- Stories de auditoria (AUTOMATE-CHECKPOINT) e de documento (CHAT-TOOLS-CONTRACT) entregam as
  camadas que fizerem sentido e dizem quais não se aplicam.
