# Runner local e segredos da Forja

O desenho está no [ADR 0057](../adr/0057-factory-local-runner-and-secrets.md). A Forja roda tudo na sua máquina: não há runner hospedado.

## Runner `local`

- Cada run de estágio ganha um **worktree próprio**, numa branch nova `forja/<item>-<run>` (é o que a pessoa revisa). Duas runs do mesmo repositório não se enxergam e o checkout principal não é tocado. O worktree é gerenciado pelo app e removido com o resgate de trabalho não salvo (ADR 0008).
- `maxConcurrentRuns` (padrão 2, de 1 a 8) limita as runs ao mesmo tempo; o excedente espera e o work item continua `queued`.
- Os ajustes ficam em `runners/<id>.yaml` na definição (`type: local`, `maxConcurrentRuns`, `credentialStrategy`).
- **Docker é opcional e ainda não existe.** O schema só aceita `type: local`; um runner em contêiner entra por ADR próprio quando houver isolamento comprovado (rede, montagens, usuário sem privilégio) e teste de escape. Um runner mal isolado seria pior que nenhum.

## Segredos

Um valor sensível nunca vai num arquivo da definição: a definição só traz a referência `forja/<nome>`. O valor mora no cofre do app.

- Na sala de controle, uma pessoa cria, substitui e apaga segredos (`PUT/DELETE /factory/secrets/<nome>`, só com a credencial humana). A lista (`GET /factory/secrets`) mostra nome, referência e data. **Nenhuma rota devolve um valor.**
- Um agente só recebe os segredos que lista em `secrets`; sem lista, nenhum. O valor chega como variável de ambiente `FORJA_SECRET_<NOME>` **só naquele comando**, nunca no ambiente global, no prompt, no jornal, no work item nem na tela. Se um segredo listado não estiver guardado, a run não começa e a mensagem cita a referência, não o valor.
- O valor exato (e suas formas em base64 e URL) é removido de tudo que o comando imprime. Limite honesto: um comando pode transformar o valor de outras formas e escapar da correspondência; por isso segredos só vão a agentes que os pedem e a revisão humana do diff é a última barreira. Valores com menos de 4 caracteres não são removidos (só estragariam a saída).

## Quem pode fazer push

A Forja nunca faz merge nem push em branch protegida. A garantia forte é a credencial com escopo a `forja/*` e a proteção de branch no servidor; um guarda de comando (`git push` para ramo protegido, `gh pr merge`, `gh api ... merge`) é defesa extra, não a garantia.

## Despacho de um estágio (`factory.dispatch`)

`run_stage` liga o foreman ao runner para o estágio **implement**: cria o run (jornal `RunEvent`, `source='forja'`), o worktree da branch `forja/<item>-<run>`, registra o vínculo run↔item e roda o agente dentro do worktree. Todo comando do agente passa por `run_as_agent` (guarda de push/merge embutido; a definição não o desliga).

- O agente é uma função injetável (`driver`) que age pelo `StageRun` (`tool`, `note`, `spend`). Os testes usam um agente falso: sem rede e sem provedor. **O laço real de modelo ainda não existe** (fatia posterior); nada aqui foi verificado contra um provedor.
- Segredos só por referência `forja/<nome>`; os valores exatos saem do jornal, dos eventos, dos artefatos e das mensagens de erro.
- Teto de tokens por run: o menor entre `maxTokens` do plano e `ceilings.tokensPerRun`. Ao estourar, a run para, o item fica `awaiting_human` com uma pergunta e nenhum artefato de diff é criado.
- Sucesso: o foreman recebe branch, sha e base (`implement_done`) e o item segue; falha: `harness_done` com erro, item aguardando uma pessoa. O worktree fica (a branch é o que se revisa); a limpeza vem depois.
- `maxConcurrentRuns` vem da definição (`pool_for`); a run espera o seu lugar.
- Só um workspace registrado pelo gerenciador numa branch `forja/` é aceito pelo runner; um caminho com NUL falha fechado.

Este passo ainda não está ligado a uma rota nem à sala de controle (próximas fatias de #440).
