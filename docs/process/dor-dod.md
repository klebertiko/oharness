# Definição de Pronto (DoR) e Definição de Feito (DoD)

**Fonte única** para issues, stories `.harness/`, PRs e sessões de agente. Produto **Forja**; assistente **Nilo**. Antes de **começar** implementação: DoR. Antes de pedir revisão do **Maestro** / fila de merge: DoD.

Texto visível ao usuário segue o [Copy standard](../../CONTEXT.md#copy-standard) (evitar *framework*, *sample*, *template*, *preset* em cópia de produto).

## DoR — pronto para começar

Tudo abaixo precisa estar **sim** na issue/story (ou no comentário de handoff aprovado). Se não estiver, não codifique; peça ao PO/dono ou spike.

1. **Objetivo em uma frase** e **critérios de aceite (AC)** numerados, cada um **observável** (teste, endpoint, tela, log, artefato).
2. **Dependências** nomeadas (`Depende de: #n`, PR, ADR) ou explícito **“nenhuma”**.
3. **Fora de escopo** listado (o que esta entrega **não** faz).
4. **Seams / testes** indicados (arquivo de teste, contrato, comando de repro) ou issue marcada para **spike** com saída esperada.
5. Label e fila corretas: `agent-ready` (agente pode pegar) ou `needs-human` (só humano — **não simule** aprovação, tag, release, dispositivo, segredo).
6. **Um dono:** label `status:in-progress` e comentário `WIP: <sessão>, branch <nome>`. **Sem** outro WIP ativo na mesma issue.
7. **Leitura mínima carregada:** este arquivo, [`agent-bus.md`](agent-bus.md), e ADR/issue citados no AC.

## DoD — pronto para Maestro revisar / fila de merge

Tudo abaixo precisa estar **sim** antes de `[bus] tipo=pronto` ou pedido de merge. Sessão filha **não** mescla nem publica “QA/SEC limpos” por conta própria.

1. **Cada AC** cumprido com **evidência** (teste que passa, captura, trecho de log, link para arquivo) citando o AC#.
2. **TDD onde houve código novo:** no ledger ou na issue, bloco **RED** (comando + falha esperada) e **GREEN** (mesmo teste passando) por fatia relevante.
3. [`pre-pr-checklist.md`](pre-pr-checklist.md) seguido e `scripts/pre-pr-check.sh` **verde** no commit que vai ao remoto **antes** do push.
4. **PR aberto** com base em `main`, `Closes #n` ou `Part of #n` correto; um PR por issue; `status:in-review`.
5. **CI:** jobs **Quality/required** e **Security scan/required** verdes no **head do PR**, ou comentário honesto do bloqueio (com link do run).
6. **QA e SEC** feitos em **contexto limpo** (subagente/sessão separada) quando o escopo exige; achados abertos impedem “pronto”. **Cursor** não comenta `QA/SEC limpos` nem faz merge — só o **Maestro** após revisão.
7. **Docs:** `README`, `USAGE`, `docs/GLOSSARY.md` ou [`CONTEXT.md`](../../CONTEXT.md) atualizados se comportamento ou vocabulário **visível** mudou.
8. **Segurança e contratos:** sem segredos no diff; assinatura `credential.kind=cli` **intocada**; `backend/tests/test_subscription_contract.py` continua válido quando Providers/assinatura no escopo.
9. **Sem merge** pela sessão implementadora, salvo regra explícita do Maestro (ex.: hotfix P0 registrado).
10. **SHA do head** do PR comentado na issue de rastreio (`head=<40-char-sha>`) + link do PR.
11. **Barramento:** `[bus]` conforme [`agent-bus.md`](agent-bus.md); corpo da entrega sem caminhos pessoais nem segredos.

## Onde isso se encaixa

| Artefato | DoR | DoD |
| --- | --- | --- |
| Issue `type:task` | Seção “Pronto quando” + AC | Checklist na issue + PR |
| Story `.harness/.../story.md` | AC + seams + DoD da story | Ledger RED/GREEN + gates harness |
| Spike / só doc | AC de documento | PR de docs + checklist enxuto |

Detalhes do fluxo de backlog: [`backlog.md`](backlog.md). Exemplos por tipo de tarefa: [`dor-dod-examples.md`](dor-dod-examples.md).
