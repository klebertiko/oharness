# Story CHAT-TOOLS-CONTRACT — Threat-model e contrato das ferramentas de chat

Dono: **Claude** (ARCH + SEC inline, com `threat-model` skill). Spike: o produto é um documento, não código.

As a usuário do chat do OHarness,
I want que "o assistente pode ler e executar no meu workspace" seja definido com fronteiras claras antes de existir,
So that BE (Codex) e FE (Claude) implementem contra o mesmo contrato e o SEC gate tenha algo falsificável para auditar.

## Acceptance Criteria
1. `contract.md` na pasta desta story define os endpoints que o chat usa, com request/response JSON
   para: descobrir comandos/skills do workspace autorizado; ler arquivo; executar comando; cancelar.
2. Cada operação declara: raiz autorizada (workspace selecionado no composer), regra de symlink,
   timeout, limite de bytes de saída, e se exige aprovação explícita do usuário antes de rodar.
3. `threat-model.md` na pasta desta story cobre STRIDE para: path traversal, symlink escape,
   execução de comando arbitrário, exfiltração de segredos (`OH_SECRETS`, `.env`), e prompt
   injection vinda do conteúdo de arquivos lidos — cada ameaça com mitigação e custo.
4. O contrato explica como o loop de tools funciona para Ollama/HTTP (backend orquestra tool calls)
   **e** para adapters CLI, mantendo SEC-1/SEC-5 de `backend/adapters/cli_claude.py` (não reativar
   hooks/MCP não confiáveis).
5. O contrato diz explicitamente o que "expandir texto de skill" faz vs. o que "executar" faz —
   o FE não pode rotular como execução algo que só insere draft.
6. ADR curta em `docs/adr/` registra a decisão (backend como broker de tools; aprovação por ação).

## Testing seams
- AC#1/2/4 → `contract.md` — revisão ARCH: cada endpoint tem exemplo JSON válido
- AC#3 → `threat-model.md` — revisão SEC fresh-context: nenhuma ameaça sem mitigação nomeada
- AC#5 → `contract.md` §Semântica — QA lê e confirma que Command/Skill/Tool são distinguíveis
- AC#6 → `docs/adr/00NN-chat-tools-broker.md` existe e linka as duas stories consumidoras

## Definition of Done
- [ ] `contract.md`, `threat-model.md`, ADR commitados
- [ ] SEC fresh-context aprovou o threat-model (após reset de 2026-09-20)
- [ ] CHAT-TOOLS-BE e CHAT-TOOLS-FE referenciam o contrato pelo caminho
- [ ] PO accepted in Sprint Review

## Story Points
3

## Priority
P0
