# Exemplos — DoR e DoD

Complemento de [`dor-dod.md`](dor-dod.md). Não substitui o checklist canônico.

## Issue estilo Flow (#358)

**DoR (trecho da issue):**
- Objetivo: governor com `FlowState{enabled, epoch}`.
- AC numerados com teste de contrato nomeado.
- `Depende de: #336`.
- Fora: preâmbulo, UI.
- Regras citam `pre-pr-checklist`, TDD, QA/SEC contexto limpo, sem merge pela sessão.

**DoD (comentário na issue ao pedir revisão):**
```
[bus] id=20261112-CURSOR-pronto de=cursor para=maestro tipo=pronto ref=#358 ack=nao
PR: https://github.com/klebertiko/oharness/pull/NNN
head=abc123... mergeable_state=clean
CI: Quality ✓ Security scan ✓
RED/GREEN: backend/tests/test_flow_governor.py — ver ledger
```

## Story harness (`.harness/.../story.md`)

**DoR:** AC 1–6, Testing seams, Story Points, Priority — Stop-the-Line PASS no `story.md`.

**DoD:** Itens do DoD da story + `ledger.md` com slices AC# → RED → GREEN + pasta `evidence/` se aplicável.

## Só documentação / ADR

**DoR:** Pergunta de decisão, opções consideradas, link ADRs existentes.

**DoD:** ADR numerado, `CONTEXT`/`GLOSSARY` se vocabulário mudou, `pre-pr-check.sh` (lint de paths), PR com `Part of #épico` quando couber.
