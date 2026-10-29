# ADR 0049 — Quanto de orientação fica no canvas e quanto vai ao Inspector

Status: **Proposta, reversível** · 2026-10-29 · Wayfinder #70 ("how much agent/skill/gate guidance belongs inline versus in the Inspector") · Sem mudança de código: registra a regra que o Studio já cumpre.

## Decisão
- **No canvas (placa do nó):** identidade e estado em até três linhas — nome + tipo, uma linha de propósito/especificação e, só quando existe, uma linha de estado ("proposed", "edited", "needs"). Nenhum texto de ajuda, exemplo ou lista de campos.
- **No Inspector:** tudo que se edita ou explica — campos, checklists, sinais, portas, "Advanced". Uma mudança proposta por Nilo é lida na **lista do cartão de revisão** (texto) e vista no canvas (fantasma/marca); o botão **Show** de cada linha seleciona o nó e abre o detalhe no Inspector, sem sair da revisão.
- **Orientação de Nilo** (por que propôs) fica no turno da conversa, não na placa.

## Por que
O canvas é para ler o grafo de relance (zoom, vizinhança); texto de ajuda na placa quebra a densidade e a legibilidade em zoom baixo. O Inspector é onde há espaço e foco para explicar.

## Verificação
Cobertura existente: `ProposalCard.test.tsx` ("Show" seleciona sem sair da revisão), `useProposalGhosts.test.tsx` (ghost com `aria-label` e sem toolbar de edição) e o e2e `e2e-studio-proposal.mjs`.
