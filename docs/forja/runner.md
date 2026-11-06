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
