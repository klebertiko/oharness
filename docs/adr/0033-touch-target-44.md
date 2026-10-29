# ADR 0033 — Alvo de toque de 44px: um token `control-touch`, ativado por `pointer: coarse`

Status: Aceito (reversível) · 2026-10-29 · Redesenho da tela Providers (auditoria D1) · Código: `--control-touch` em `frontend/src/app/globals.css`, `tokens.json`, `ui/Button`, `ui/Input`, `ui/ListRow`, `ui/Segmented`

## Contexto
`experience.md` pedia 24px no desktop e 36px (`control-lg`) em layouts estreitos. A auditoria da tela Providers mediu 28px no desktop e 36px a 375px: nenhum controle chega a 44px, o mínimo que Apple (HIG), Material e o critério AAA 2.5.5 do WCAG usam para toque. O 36px era uma escolha de densidade, não uma medida de dedo.

## Decisão
- Novo token `control-touch` = 44px (`--control-touch`, `status: code`).
- Ele vale **quando o ponteiro principal é toque** (`@media (pointer: coarse)`, a variante `pointer-coarse:` do Tailwind), não por largura de janela. Botão, campo, linha de lista e `Segmented` sobem para ele; com mouse as alturas seguem 24, 28 e 36, e `max-sm:` continua 36px.
- A regra é do sistema, não da tela: vale para todo `ui/*` que já tinha `max-sm:h-control-lg`.

## Por quê
Largura não diz como a pessoa aponta: um tablet largo é toque, uma janela estreita no desktop é mouse. `pointer: coarse` pergunta ao navegador. Manter 36px para janela estreita com mouse preserva a densidade que o desenho pede onde ninguém precisa de 44.

## O que não foi feito
Não há dispositivo de toque real no sandbox. O teste verifica as classes e o e2e emula `hasTouch` (Chromium aplica `pointer: coarse`); a medição em aparelho físico fica por fazer.

## Consequências
- Telas que usam esses componentes ficam mais altas em toque. Quem tem altura fixa em volta (barras, toolbar do Studio) pode precisar de ajuste; as telas fora de Providers não foram revisadas em toque neste trabalho.
- Reverter é remover as classes `pointer-coarse:` e o token; nenhum dado migra.
