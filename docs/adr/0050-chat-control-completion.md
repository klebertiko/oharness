# ADR 0050 — Controle do chat: fila que sobrevive, modo conferido no sidecar, Full e plano sem provedor

Status: Aceito (conservador; reversível) · 2026-11 · Issue #276 · Complementa 0021 (modos de permissão), 0022 (modo Plan) e 0023 (fila) · Código: `frontend/src/store/messageQueueStore.ts`, `components/agent/usePermissionMode.ts`, `ChatComposer.tsx`, `AgentStage.tsx` · e2e: `frontend/scripts/e2e-chat-control.mjs`

## Contexto
Os ADRs 0021–0023 deixaram quatro pontas soltas no chat: a fila (0023) morria no reload; o modo mostrado vinha de um cache que só era conferido quando não era o padrão; a confirmação do modo Full só fechava com o mouse; e aprovar um plano sem provedor conectado não fazia nada, sem dizer por quê.

## Decisão
1. **Fila persistida.** `oh.messageQueue.v1` (localStorage, versão 1). Tudo que volta do disco é dado não confiável: formato inválido, texto vazio, texto acima de 4000 caracteres e itens além de 20 por conversa são descartados na leitura. Escrita que falha (cota, armazenamento bloqueado) deixa a fila só em memória, sem quebrar a digitação. Uma fila restaurada volta **pausada** (`pausedThreads`, que não é persistido): nada roda sozinho depois de um reload; "Send next" retoma, "Clear queue" descarta. Apagar a conversa limpa a fila dela. A fila de uma conversa ainda sem id (`new`) não é gravada.
2. **Avisos.** Fila cheia (20) e mensagem acima de 4000 caracteres não enfileiram, **mantêm o texto no compositor** e dizem por quê, em vez de falhar em silêncio.
3. **Modo conferido em toda conversa.** `usePermissionMode` pergunta ao sidecar (`GET /chat/tools/permission`) ao abrir qualquer conversa, não só as que o cache já mostrava fora de `ask`; assim um cache perdido não exibe "Ask" com Plan aplicado. Uma conversa recém-criada (adoção do modo escolhido antes de existir) não é conferida enquanto o modo é entregue, para uma resposta antiga não vencer a escolha. Resposta tardia nunca sobrescreve uma mudança feita nesse meio-tempo (já era regra). Sem rede, o cache fica e o sidecar continua aplicando o dele.
4. **Full.** A confirmação fecha com Escape de qualquer ponto da página e devolve o foco à opção Full (Cancelar, Escape e confirmar), para a navegação por teclado continuar de onde estava.
5. **Plano sem provedor.** Aprovar sem provedor conectado diz o motivo no próprio cartão ("conecte um provedor antes de aprovar") e **não consome** o plano: nada é enviado ao sidecar e o plano continua esperando.
6. **Seletor dos seis modos** quebra linha em telas estreitas (390px) em vez de sair da tela.

## Por que assim
A fila é trabalho que a pessoa pediu: perder no reload é pior que reter. Mas retomar sozinho, sem a pessoa ver o contexto, repete o risco que o 0023 já evitava para turno parado — por isso pausa. O limite de caracteres existe porque a cota do localStorage é pequena e compartilhada com threads e preferências.

## Consequências
- Toda conversa aberta faz uma requisição a mais (`GET /chat/tools/permission`); os e2e que abrem conversa stubam a rota.
- Dívidas conhecidas (não tratadas aqui): sem sincronização entre abas; fila de conversa apagada em outra aba fica órfã no armazenamento até a próxima limpeza; se o sidecar ainda não subiu e não há cache, o modo exibido é Ask até a próxima conferência (o sidecar aplica o dele).
- A fila persistida é só neste dispositivo e neste armazenamento local; não sincroniza.

## Verificação
Unitários: `messageQueueStore.test.ts`, `AgentStage.queue.test.tsx`, `usePermissionMode.test.tsx`, `ChatComposer.permission.test.tsx`, `AgentStage.planNoProvider.test.tsx`, `threadStore.test.ts`. e2e: `e2e-chat-control.mjs` (modos por teclado, Full, plano aprovado e descartado, fila restaurada, axe nos dois temas, desktop e 390px). Não verificado aqui: Safari/WebKit e o app Tauri (WebView2) com armazenamento local bloqueado; fica na lista R3 (#284).
