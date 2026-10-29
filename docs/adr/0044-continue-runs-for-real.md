# ADR 0044: continuar uma run de fato (reexecução a partir do ponto)

Status: aceita. Completa o #157 depois do ADR 0018 (que só criava e vinculava a run).

## Decisão
- **O que a run guarda:** `run_inputs` (tabela nova, criada por `create_all`) guarda o grafo, o modo, o `cwd` e a flag de worktree com que a run começou. A continuação copia esse registro para a run nova.
- **Retomada:** `execute_harness(..., resume_outputs={nó: saída})` restaura cada nó concluído na primeira vez que a caminhada chega a ele e emite `node_restored {node_id, output}` em vez de executá-lo; o resto roda de verdade. Um retry de Gate que volta a um nó restaurado o executa (restaura-se uma vez só). Sem `resume_outputs` o motor se comporta como antes.
- **Linhagem:** a semente soma os jornais da cadeia de continuações (até 50 níveis), então uma continuação que parou cedo ainda repassa o que as anteriores terminaram.
- **Gate:** um Gate que mandou a run de volta (`gate_retry`) não é restaurado e nada depois dele é lido: o Gate roda de novo sobre as saídas restauradas, então uma checagem reprovada nunca é pulada por um reinício. O contador de tentativas do Gate recomeça (o teto vale por execução).
- **Worktree:** uma run em worktree guarda as edições na ref de resgate (ADR 0019); a continuação cria o novo worktree **a partir dessa ref** (`run_inputs.base_ref`), então os nós restaurados não perdem os arquivos que escreveram.
- **Só runs de harness:** um turno direto de chat não tem grafo para executar de novo; `resumable` é falso e `/continue` responde `409`.
- **Ponto de retomada:** as saídas vêm do jornal da run original (último `node_done`/`node_restored` por nó). O jornal é redigido na escrita, então uma saída restaurada nunca traz uma credencial que o jornal já escondia. Nó com `node_start` sem `node_done`, ou HITL pendente, roda de novo.
- **API:** `POST /execute/logs/{id}/continue` (cria a run `pending`, ADR 0018) e `POST /execute/logs/{id}/start` (SSE; executa a continuação). `start` é **idempotente por reivindicação atômica**: `UPDATE ... WHERE status='pending'`; uma segunda chamada (duplo clique, retry) responde `409 not_startable` e não executa nada. Se a run não puder começar (orçamento recusado, entradas ausentes) ela volta a `pending`. Run salva antes de existir `run_inputs` responde `409 inputs_unavailable`.
- **Jornal:** a continuação tem jornal próprio (sequência recomeça depois do `run_continued`); o da run original só é lido.
- **UI:** em "Detalhe da run" o botão "Continue as a new run" cria, inicia e mostra a execução ao vivo; nós restaurados aparecem como "Restored from the earlier run".

## Limites (registrados)
- Efeitos fora do worktree (um comando que mexeu fora dele, uma chamada externa) não são desfeitos nem refeitos: um nó restaurado não os repete.
- `start` reivindica a run antes de a resposta ser lida; se o cliente sumir antes do primeiro byte a run pode ficar `running` até a próxima partida do sidecar (que a marca `interrupted`).
- O grafo fica em `run_inputs` como o da tabela de harnesses (sem redação); o jornal continua redigido.
- Um nó que o motor tinha em andamento quando a run caiu roda do início; não há retomada no meio de um nó.
- Uma run salva antes deste ADR não tem `run_inputs` e não pode ser continuada.
- A interface está só em inglês: o frontend não tem camada de idiomas (ver ADR 0046).
