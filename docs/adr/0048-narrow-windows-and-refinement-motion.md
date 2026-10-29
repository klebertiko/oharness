# ADR 0048 — Janelas estreitas e movimento do refino de Nilo

Status: **Proposta, reversível** · 2026-10-29 · Complementa os ADRs 0009 e 0010 (wayfinder #70, itens "responsivo" e "motion e progresso") · Código: `CopilotPanel.tsx`, `useProposalGhosts.ts`, `globals.css`, `scripts/e2e-studio-narrow.mjs`

## Janelas estreitas
O painel lateral do Studio (Inspector/Nilo) já vira uma folha (sheet) quando a janela não comporta a coluna (`AppShell`). Decisão: **não há layout próprio para estreito**; o cartão de revisão da proposta (ADR 0010) vive na folha, com os mesmos controles, e a lista do seletor de harness (`Combobox`) fica dentro da viewport. Isso passou a ser verificado: o e2e abre 390 e 768 px, nos dois temas, confere que o cartão e a lista cabem na largura, que a página não rola de lado e que o axe fica limpo antes e depois do Apply.

## Movimento e linguagem de progresso
- Enquanto Nilo trabalha, o texto diz **"Drafting · Ns"** (pedido novo) ou **"Refining the proposal · Ns"** (quando ainda há uma proposta aguardando revisão), com Cancelar/Esc. A pessoa vê que o pedido refina o que está na tela e não que começou do zero.
- A chegada da proposta é um **fade de 220 ms só em opacidade** nos nós fantasmas (`.oh-ghost-in`); o React Flow posiciona por `transform`, então nada é animado por ali. A câmera já enquadra os fantasmas (ADR 0010).
- Com `prefers-reduced-motion: reduce` não há animação (a classe só anima em `no-preference`; a regra global de movimento reduzido continua valendo). O e2e verifica os dois casos.
