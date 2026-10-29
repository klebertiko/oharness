# ADR 0055 — Fábrica local: estágios, checkpoints e a regra do merge

Status: proposta (issue #244, pacote A). Depende de 0053 e 0054.

## Decisão

### Estágios (padrão)
`triage → spec → implement → review`, com `verify` e `monitor` opcionais.
- **Triage**: decide uma de três saídas: `implement` (pequeno e claro, vai direto), `spec` (precisa de especificação) ou `wait` (falta informação; fica `parked`/`awaiting_human` com a pergunta registrada).
- **Spec**: conversa com a pessoa e produz/edita a spec. **A aprovação é humana, editável e por revisão**: `approve_spec {revision}` só vale para a `spec_revision` que a pessoa viu; editar depois invalida a aprovação (`approved_revision` volta a nulo).
- **Implement**: runs de estágio em worktree próprio, só depois de spec aprovada quando o estágio `spec` rodou. Resultado: diff/branch como artefato.
- **Review**: agente revisor lê diff e spec; resultado `approved`, `changes_requested` (devolve para Implement com notas) ou `needs_human`.
- **Verify** (opcional): executa a verificação definida (testes/reprodução); a verificação com computer use é do pacote C.
- **Monitor** (opcional): acompanha o item depois de entregue; só observa e abre novo work item, nunca age.

### O foreman pode
Pular estágio permitido (evento `stage_skipped` com motivo) e devolver de Review para Implement (`returned_to_review`, no máximo 3 voltas por item; a quarta vira `awaiting_human`). Não pode pular estágio marcado `required` na definição (por padrão: `review`; e `spec` quando a política `requireSpec` está ligada), nem aprovar spec.

### Checkpoints humanos
Um checkpoint pausa o item em `awaiting_human` com um `checkpoint_requested` e só segue com `checkpoint_resolved` de um humano (ação autenticada da sala de controle ou CLI; **nunca** de um agente, foreman ou entrada de texto externo). Padrões ligados: aprovação de spec e "pronto para revisão humana" (antes de abrir PR). A definição pode **acrescentar** checkpoints; nenhuma definição remove os dois padrões.

### Regra do merge (invariante)
A fábrica **nunca faz merge** e **nunca faz push em branch protegida**. Isso é estrutural, não só política:
1. Não existe ação, ferramenta nem endpoint de merge no sidecar.
2. O runner trabalha em worktree destacado (ADR 0019); só pode publicar em branch de fábrica com prefixo `factory/` (não protegido), e a lista de branches protegidas (padrão: a branch default e `release/*`) vem da definição e é conferida **antes** do push por um hook pré-ferramenta embutido que não pode ser desligado pela definição (ADR 0026/0041).
3. Abrir PR é permitido ao agente Implement/Review só após o checkpoint "pronto para revisão"; o PR fica para a pessoa revisar e mergear fora da fábrica.
4. Teste de contrato: percorre as ações/rotas do sidecar e as ferramentas do runner e falha se aparecer qualquer caminho de merge.

### Máquina de estados
Transições permitidas ficam em uma tabela única em `backend/factory/stages.py` (espelhada na UI), validada em testes; qualquer transição fora da tabela é erro, não ajuste silencioso. Cada transição grava evento (ADR 0053).

## Escolhas conservadoras
Padrão é parar e perguntar: dúvida do foreman → `awaiting_human`, nunca seguir por conta própria. Limite de voltas e de tokens por item protege custo (teto da fábrica, ADR 0056, soma as runs vinculadas).
