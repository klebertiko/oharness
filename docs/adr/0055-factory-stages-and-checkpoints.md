# ADR 0055 — Fábrica local: estágios, checkpoints e a regra do merge

Status: proposta (issue #244, pacote A). Depende de 0053 e 0054.

## Decisão

### Estágios (padrão)
`intake → triage → [spec] → implement → review → handoff → complete`, com `verify` e `monitor` opcionais. O `spec` é o *planning* do ciclo: pulado para mudanças pequenas e bem entendidas.
- **Triage**: decide uma de três saídas: `implement` (pequeno e claro, vai direto), `spec` (precisa de especificação) ou `wait` (falta informação: `awaiting_human` com a pergunta registrada; `parked` só por ação da pessoa). Triage é sujeito às mesmas regras de `required`: com `policy.requireSpec` ligada a saída `implement` é recusada pelo código e vira `spec`.
- **Spec**: conversa com a pessoa e produz/edita a spec. **A aprovação é humana, editável e por revisão**: `approve_spec {revision}` só vale para a `spec_revision` que a pessoa viu; editar depois invalida a aprovação (`approved_revision` volta a nulo).
- **Implement**: runs de estágio em worktree próprio, só depois de spec aprovada quando o estágio `spec` rodou. Resultado: diff/branch como artefato.
- **Review**: agente revisor (modelo/harness diferente do Implement, ADR 0054) lê diff e spec; resultado `approved`, `changes_requested` (devolve para Implement com notas) ou `needs_human`. **O veredito é consultivo**: não aprova nem libera merge; é evidência para a pessoa.
- **Handoff**: a fábrica apresenta o resultado, as evidências e os achados e atualiza a origem; o item fica `waiting_merge`. **Handoff sozinho não completa o item.** `complete` (`done`) só ocorre com (a) **merge observado** — leitura somente de git: a ponta da branch do item é ancestral da branch default do repositório — ou (b) `confirm_merged` por uma pessoa. `cancelled` encerra cedo.
- **Verify** (opcional): executa a verificação definida (testes/reprodução); a verificação com computer use é do pacote C.
- **Monitor** (opcional): acompanha o item depois de entregue; só observa e abre novo work item, nunca age.

### O foreman pode
Pular estágio permitido (evento `stage_skipped` com motivo) e devolver de Review para Implement (`returned_to_implement`, no máximo `policy.maxReviewReturns` voltas, padrão 3; além disso o item vira `awaiting_human`). Não pode pular estágio marcado `required` na definição (por padrão: `review`; e `spec` quando a política `requireSpec` está ligada), nem aprovar spec.

### Checkpoints humanos
Um checkpoint pausa o item em `awaiting_human` com um `checkpoint_requested` e só segue com `checkpoint_resolved` de um humano. **Como o servidor distingue humano de agente:** o sidecar tem duas classes de credencial. A **classe agente/integração** é o token atual do sidecar (`security/sidecar_token.py`), que também o pacote B e o Factory MCP usam; ela **não** pode `approve_spec`, resolver checkpoint, `activate`/`rollback` de definição nem gravar segredos. A **classe humana** é um segredo de sessão gerado pelo shell do app, entregue ao webview só em memória, fora do arquivo do token e fora do ambiente que `scrub_env` repassa a comandos; o servidor define `actor.kind` pela classe da credencial e ignora o que o cliente disser. **Risco residual declarado:** um processo do mesmo usuário do SO não é isolado pelo sandbox (ADR 0021: política, não isolamento de SO); até o shell empacotado entregar a credencial humana (ver nota em `sidecar_token.py`), a ponte de desenvolvimento é mais fraca, e o ADR de aceite desse corte deve dizer isso na tela de configuração. Três pontos humanos por padrão: **aprovar a spec**, **responder perguntas** (o foreman pergunta em vez de adivinhar quando o requisito ou um achado de revisão é ambíguo; a pergunta aparece na caixa de entrada e a resposta é a ação `answer`) e **o merge**. Aprovação de spec e perguntas são *política da fábrica*: `policy.specApproval` (`required` por padrão) e as instruções do foreman, ambas editáveis na definição — e o **código** aplica `specApproval`, em vez de depender de o modelo obedecer ao prompt. Relaxar `specApproval` é uma mudança explícita, visível no diff da versão e testável em canary. O handoff ("pronto para revisão humana", antes de abrir PR) sempre existe. **O merge é imposto pelo repositório** (proteção de branch e permissões), nunca por prompt nem pelo agente (ver regra do merge).

### Regra do merge (invariante)
A fábrica **nunca faz merge** e **nunca faz push em branch protegida**. Isso é estrutural, não só política:
1. Não existe ação, ferramenta nem endpoint de merge no sidecar.
2. O worktree de uma run de fábrica **cria uma branch** `factory/<work_item>-<run>` (o ADR 0019 usa `HEAD` destacado para runs comuns; a run de fábrica é a exceção explícita, para ter o que publicar). O sandbox é política, não isolamento de SO, e um hook que olha texto de comando pode ser contornado (script, alias, `sh -c`, `gh api`). Por isso a garantia é em **camadas**, e só a primeira é forte: (a) **credencial**: a fábrica só tem uma credencial de push (um `secretRef`) com escopo a `factory/*`; sem ela não há push remoto e as branches ficam locais para a pessoa publicar; (b) **proteção de branch no servidor** (exigida na documentação de adoção; a tela de configuração avisa se não conseguir verificar); (c) um hook pré-ferramenta embutido, que a definição não desliga (ADR 0026/0041), nega `push` para qualquer ref protegida da definição e `gh pr merge`/`gh api …/merge`, como defesa extra, não como a garantia.
3. Abrir PR é permitido ao agente Implement/Review só após o checkpoint "pronto para revisão"; o PR fica para a pessoa revisar e mergear fora da fábrica.
4. Teste de contrato: percorre as ações/rotas do sidecar e as ferramentas do runner e falha se aparecer qualquer caminho de merge.

### Máquina de estados
Transições permitidas ficam em uma tabela única em `backend/factory/stages.py` (espelhada na UI), validada em testes; qualquer transição fora da tabela é erro, não ajuste silencioso. Cada transição grava evento (ADR 0053). Inclui: **Verify falhou** → volta para Implement com `verify_failed` (conta no mesmo limite de voltas) ou `failed` quando o limite acaba; **reinício do sidecar**: ao subir, itens `running`/`queued` cujas runs não têm mais processo viram `awaiting_human` com evento `recovered` e a run vinculada fica `interrupted` (continuável, ADR 0044), liberando as vagas de `maxConcurrentRuns`.

## Escolhas conservadoras
Padrão é parar e perguntar: dúvida do foreman → `awaiting_human`, nunca seguir por conta própria. Limite de voltas e de tokens por item protege custo (teto da fábrica, ADR 0056, soma as runs vinculadas).
