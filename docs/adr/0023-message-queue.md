# ADR 0023 — Fila de mensagens durante a execução

Status: Aceito (conservador, sem decisão do usuário pendente) · 2026-10-28 · Issue #160 · Código: `frontend/src/store/messageQueueStore.ts`, `frontend/src/components/agent/QueuedMessages.tsx`, `AgentStage.tsx`

## Contexto
Com uma run ativa o compositor ficava desabilitado: a pessoa esperava ou parava a run para mandar a próxima mensagem.

## Decisão
1. A fila é do frontend e vive em memória, por conversa (limite de 20, recusa a 21ª). Nada muda no sidecar: cada mensagem da fila é uma run comum, com as mesmas verificações de provider, orçamento e permissão.
2. Enviar com run ativa enfileira (visível, com a ordem e o aviso "runs after the current turn"); só uma mensagem simples entra: `/exec` e `/read` esperam a run terminar.
3. A fila só avança quando o turno termina **completo** e a resposta já está no chat. Parar ou falhar **pausa** a fila: nada roda sozinho depois de um erro; "Send next" e "Clear queue" são a decisão da pessoa.
4. O rascunho que a pessoa digita durante a drenagem não é tocado.
5. Cada mensagem pode ser removida antes de rodar. Mensagens enfileiradas valem para a conversa onde foram digitadas.

## Consequências
Uma mensagem enfileirada em Plan segue o modo vigente quando sair da fila. Recarregar a página descarta a fila, como descarta a run em andamento.
