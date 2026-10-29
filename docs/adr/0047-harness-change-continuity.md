# ADR 0047 — Continuidade ao trocar de harness: aviso na conversa e "Move to a new chat"

Status: **Proposta, reversível** · 2026-10-29 · Complementa o ADR 0011 (#73) · Código: `threadStore.forkThreadForHarness`, `AgentStage.tsx`

## Contexto
O ADR 0011 permite trocar de harness depois de haver mensagens e deixa uma linha de aviso. O wayfinder (#70) ainda pedia "aviso de continuidade ou fork". Cada turno envia só a instrução, então a troca não corrompe contexto; mas quem quer manter a conversa original intacta com o harness antigo não tinha saída.

## Decisão
1. **Aviso** (já existia): linha "Harness changed to X. It applies from your next message; earlier replies stay as they were."
2. **Fork opcional:** enquanto essa linha for a **última** coisa da conversa e nada estiver rodando, ela oferece **"Move to a new chat"**. A ação copia a conversa (mensagens com ids novos, carimbos de harness preservados) para um chat novo "<título> · <harness>" com o harness escolhido e a escolha de modelo da conversa, **devolve o original ao harness anterior** e remove a linha dele. Depois do próximo envio a oferta some (a conversa já seguiu).
3. Não há diálogo de confirmação: nada se perde (o original fica como estava antes da troca) e o chat novo é aberto na hora.

## Consequências
- Reversível: remover o botão não afeta o modelo de dados (`ThreadMessage.from` já existia para colapsar marcadores).
- A cópia **não** leva o modo de permissão, a aprovação de plano nem a confiança de workspace (o chat novo pergunta, como qualquer chat novo: o lado seguro), nem rascunho, fila de mensagens ou execuções em andamento (a oferta some enquanto algo roda). Os `runId` das respostas copiadas são os mesmos; só leitura.
- Conversas muito longas duplicam no `localStorage`; aceito por ser uma ação explícita.
