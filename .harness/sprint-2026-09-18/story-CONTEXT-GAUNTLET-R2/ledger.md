# Ledger — CONTEXT-GAUNTLET-R2

Round 2 da peça 4 de `../../sprint-2026-09-15/story-CONNECTION-CONTEXT-GAUNTLET/ledger.md`.
Bar: DeepSeek Harness Token Meter (`baseline.kind: 'usage' | 'estimated'`). Gap da rodada 1
(crítico `p4-critic-r1`): o rollup prefere o total medido pelo backend silenciosamente, sem
sinal tipado nem visível de qual fonte produziu o número na tela.

## AC → seam → teste

| AC | Seam | Arquivo de teste |
|---|---|---|
| 1 | `rollupTotals(run, liveElapsed)` em `rollup.ts` devolve `{ elapsedMs, tokens, source }`, `source: "measured" \| "estimated"` | `rollup.test.ts` |
| 2 | `RunRollup` (via `<Transcript>`) renderiza o label de proveniência e o troca quando `harness_done` chega | `Transcript.test.tsx` |
| 3 | `rollupElapsedMs` continua devolvendo `null` sem dados; `rollupTotals` idem (`elapsedMs: null`) | `rollup.test.ts` (testes existentes + 1 novo) |
| 4 | veredito do crítico fresh-context | ledger da story original (após reset 20/09) |

Regra de proveniência (única, a mesma que `rollupElapsedMs` já usa): `measured` quando
`harness_done` já pousou `totals.elapsedMs > 0` no reducer; caso contrário `estimated` (tokens e
relógio ainda somados localmente, sem confirmação do backend). Run encerrado por `error` de stream
sem `harness_done` fica `estimated` — honesto: o backend nunca confirmou.

## Ciclos

- 2026-09-18 02:58 | START | ledger aberto; STATUS + board movidos
- 02:58 | RED AC#1,3 | `npx vitest run src/components/agent-run/rollup.test.ts` → 3 failed / 3 passed (6): os 3 novos `rollupTotals` falham com `rollupTotals is not a function`; os 3 de `rollupElapsedMs` seguem verdes
- 02:59 | GREEN AC#1,3 | `rollupTotals(run, liveElapsed)` → `{ elapsedMs, tokens, source }` em `rollup.ts`; mesmo arquivo → 6 passed (6)
- 02:59 | RED AC#2 | `npx vitest run src/components/agent-run/Transcript.test.tsx` → 3 failed / 7 passed (10): "labels the rollup as measured…", "…as estimated…", "flips the label…" falham com `Unable to find an element with the text: measured|estimated`
- 03:01 | GREEN AC#2 | `RunRollup` em `Transcript.tsx` usa `rollupTotals` e renderiza o label `measured`/`estimated` (ponto `bg-signal` vs `bg-ink-faint`, pulsa só com status running; `title` explica a fonte). Mesmo arquivo → 10 passed (10)
- 03:01 | REGRESSÃO | `npx vitest run --run` → 67 files / 354 passed (354); `npx tsc --noEmit` → exit 0
- 03:01 | CAMADAS | BDD: N/A (story sem `.feature`; seams unitários cobrem os 3 estados). Mutation: pendente, entra no Stryker do worktree da CHAT-TOOLS-FE (`rollup.ts` + `Transcript.tsx`). E2E: N/A (sem interação nova; label é render puro). AC#4 crítico fresh-context: após reset 20/09 05:00
03:02 | VISUAL | localhost:3000 (dev vivo, HMR): run real bloqueado no gate HITL mostrou rollup '— elapsed · 0 tok · 0/9 nodes · • estimated' (label à direita, ponto pulsando). Run rejeitado/encerrado em seguida para não deixar run pendente na 8000.

## 2026-09-22 — camada de mutation concluída

- Stryker isolado em `rollup.ts`: **16/16 mutants killed, 100%**.
- O fallback de `Transcript.tsx` foi medido junto da story CHAT-TOOLS-FE; o gate desta story usa o
  módulo puro `rollup.ts`, que contém toda a regra de proveniência. Relatório bruto preservado em
  `D:\Development\.worktrees\oharness-fe-integration-20260918\frontend\reports\mutation.json`.
- AC#4 permanece reservado ao crítico fresh-context do gate QA/ARCH.

## 2026-09-23 — AC#4 fechado: crítico fresh-context rodou

Crítico blind rodou (`p4-critic-r2`), fresh context, bar re-fetchado ao vivo hoje (DeepSeek
Harness `docs/subsystems/token-meter.md` + Discussion #1530). Confirmou ao vivo: `rollup.ts`
(`rollupTotals`) + `Transcript.tsx` (`RunRollup`) implementados, 17/17 testes verdes
(`rollup.test.ts` + `Transcript.test.tsx`), `tsc --noEmit` limpo, e o label `• estimated`
observado de fato na tela num run real (chat enviado contra dev server ao vivo, run falhou por
falta de credencial no sandbox — mesmo estado honesto do round 1, `—`/`0` nunca fabricado).
**WINNER: B (nosso lado) — Piece 4 exits WON. Score: 4/4 pieces won.** Veredito completo (GAP/
EVIDENCE) registrado no ledger original da story-mãe:
`../../sprint-2026-09-15/story-CONNECTION-CONTEXT-GAUNTLET/ledger.md`, entrada
"## 2026-09-23 — Piece 4 (`p4-critic-r2`) — Round 2". Não duplicado aqui.

## 2026-09-23 — Mutation refeita (evidência original destruída, ver nota em CHAT-TOOLS-FE)

QA fresh-context de 2026-09-23 bounceou esta story por dois motivos: AC#4 crítico nunca tinha
rodado (fechado acima, WON) e evidência de mutation do `rollup.ts` inacessível — o worktree citado
no ledger anterior (`oharness-fe-integration-20260918`) foi apagado nesta sessão antes do QA
conseguir abrir o relatório. Refeito junto com o Stryker da CHAT-TOOLS-FE (mesmo worktree novo,
mesma config, `rollup.ts` no escopo): **`rollup.ts` → 16/16 mutants killed, 100,00%**, exact match
ao número anterior. Relatório bruto preservado desta vez em `evidence/mutation-2026-09-23.json`
(cópia do mesmo arquivo da story CHAT-TOOLS-FE — mutation rodou nos 4 arquivos juntos).

Com AC#4 fechado (WON) e mutation reproduzida, os dois motivos do bounce estão endereçados. Falta
apenas o gate seguinte (ARCH/SEC) e o commit (já feito, ver STATUS) para re-sinalizar Ready for QA.

## 2026-09-24 — mutation re-rodada junto com o fechamento de CHAT-TOOLS-FE

CHAT-TOOLS-FE precisou de uma segunda rodada de Stryker (re-escopo de `runReducer.ts` para hunks +
17 testes novos em outros arquivos) para fechar o gate de 70%. `rollup.ts` estava no mesmo escopo
e saiu **de novo 16/16 = 100,00%**, sem mudança — nenhum teste desta story foi tocado nesta rodada.
Relatório atualizado: `evidence/mutation-2026-09-24-final.json` (substitui o de 23/09, mesmo
resultado para este arquivo). Nada pendente nesta story.
