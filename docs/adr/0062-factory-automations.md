# ADR 0062: Automações agendadas e gatilhos por evento

Status: aceita (implementação no PR de automações).

## Decisão
- Uma automação = {id, nome, cron local ou gatilho de evento, `WorkItemDraft` modelo, teto de custo por execução e por período, estado `active|paused`}. Definida em arquivo versionado (alinhado ao "definição como código" do Pacote A), sem segredos.
- Cada disparo cria um work item com `source.kind = "schedule"` e `idempotency_key = <automação>:<instante>` (reinício não duplica). Pausar/retomar é explícito; o histórico (disparo, item criado, custo, resultado) é gravado localmente.
- **Limites:** disparo é recusado se o teto de custo do período foi atingido ou se há um item da mesma automação ainda em aberto (sem empilhamento). Nunca merge; o resultado entra em revisão humana.
- Cron avaliado em processo local (sem serviço externo); o texto do modelo é do dono e não recebe conteúdo externo sem passar pelo ADR 0059.
