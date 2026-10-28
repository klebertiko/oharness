# ADR 0009 — Modelo primário de interação agentic do Studio: descrever primeiro, conversa em painel lateral

Status: **Proposta, reversível** (decisão de design delegada; o usuário revisa depois) · 2026-10-28 · Issue #71 (wayfinder #70) · Protótipo: `docs/design/studio-agentic/index.html`

## Contexto
O Studio já tem a caixa "descrever" no overview (`startCopilotFromOverview`), o painel lateral com abas Inspector/Nilo (`StudioSidePanel`) e Nilo propondo operações de grafo validadas (`lib/copilot/ops.ts`). A pergunta é qual modelo é o **primário**: (A) overview "descrever primeiro" que abre uma conversa em painel lateral, (B) overlay de Nilo sobre o canvas, ou (C) construtor em etapas em tela cheia.

## Alternativas (protótipo descartável com Agent, Skill, Gate, HITL reais)
| | A. Descrever primeiro + painel lateral | B. Overlay no canvas | C. Construtor em etapas |
|---|---|---|---|
| Contexto do canvas | Canvas e conversa visíveis juntos; a proposta aparece como fantasma no canvas | O overlay cobre justamente os nós a revisar | Sai do canvas; só volta no fim |
| Descobribilidade | Overview já é o ponto de entrada; aba "Nilo" fixa no editor | Só quem acha o gatilho | Funil previsível, mas rígido para quem já tem grafo |
| Controle reversível | Histórico de turnos, Keep/Undo/Reject e refino parcial num único lugar | Sem lugar natural para histórico e refinos em vários turnos | Etapas são reversíveis, mas atrasam quem sabe o que quer |
| Custo | 320 px de canvas (painel recolhível) | Nenhum de layout | Fluxo novo inteiro |

## Decisão
**A é o modelo primário.** O overview abre o editor com o texto já enviado a Nilo (contrato de `copilotEntry`), a aba Nilo fica aberta e a **proposta é pré-visualizada no canvas antes de qualquer commit** (ciclo definido no ADR 0010). B não é adotado como superfície própria: o canvas só recebe fantasmas e marcas, nunca um segundo campo de texto. C é descartado como primário; a ideia de "etapas" vive como sugestões de próximo passo dentro da conversa.

## Consequências
- O painel lateral é a casa única da conversa; em janelas estreitas o mesmo painel abre como folha (sheet), comportamento já existente do `AppShell`.
- Mantém "Nilo" (nunca "Copilot") e a regra de que Nilo só propõe operações validadas e reversíveis, sem acesso a credenciais, provider, campos executáveis ou cwd.
- Reversível: trocar de modelo muda só a superfície (`StudioSidePanel`/`CopilotPanel`); a store e o ciclo de proposta independem dela.
