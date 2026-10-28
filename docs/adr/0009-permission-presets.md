# ADR 0009 — Presets de permissão por sessão

Status: Aceito (conservador, sem decisão do usuário pendente) · 2026-10-28 · Issue #161 · Código: `backend/sandbox/permission.py`, `backend/sandbox/permission_modes.json`

## Contexto
O chat já tinha três modos (Ask, Auto, Plan; #102). A issue pede presets somente leitura, escrita no workspace e completo, com recusa visível,
aprovação fora do workspace e sem atalho de bypass. As ferramentas do broker são `read`, `discover` e `exec`: não existe ferramenta de escrita, então
"escrever" é um `exec`.

## Decisão
1. **Uma tabela**: `permission_modes.json` define ids (do mais estrito ao mais frouxo), rótulo, dica, resumo, nota de recusa e, por classe de `exec`, a regra
   `allow | ask | deny | allow_if_trusted`. O backend a carrega; o frontend guarda cópia idêntica (`frontend/src/lib/permissionModes.json`) e um teste de paridade falha se diferirem.
2. **Classes de `exec`** (`exec_class`): `exec_read` (allowlist read-only existente), `exec_project` (scripts do projeto), `exec_write_inside` (`mkdir|touch|cp|mv` com todos os operandos relativos, dentro do workspace e fora de `.git`), `exec_write_outside` (mesmos comandos com operando que escapa) e `exec_other` (o que não dá para provar). O que não se prova é `exec_other`.
3. **Conservador por padrão**: Read-only recusa tudo que não seja `exec_read` (inclusive `exec_other`, porque não dá para provar que é somente leitura); Workspace write só roda sozinho o que se verifica dentro do workspace e pergunta o resto; `rm` e interpretadores nunca são classificados como escrita segura.
4. **Full** existe porque a issue o pede, mas: exige confirmação na UI com Cancel como foco padrão, nunca é alcançado por `Shift+Tab`, e o broker pergunta mesmo assim para comando de alto risco (`risk_hints`, em qualquer modo) e para arquivo com segredo.
5. **Sem bypass**: nenhum id com `bypass`/`danger`; a API devolve 400; um pedido de run só pode apertar o modo (`effective_mode`).

## Consequências
Adicionar um modo é editar um arquivo; sem regra para toda classe, o import do backend falha. O sandbox continua sendo política, não isolamento de SO: por isso Workspace write só automatiza o que a política consegue verificar.
