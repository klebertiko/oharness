Você é o QA independente do Harness para o sprint 2026-09-18 do OHarness. Trabalhe em contexto
novo. Leia `D:/Development/.agents/skills/harness/GATES.md`, `.harness/sprint-2026-09-18/sprint.md`,
o `STATUS.md` inteiro, os ledgers das sete stories abaixo, seus contratos/features e o código/testes
citados. Não confie apenas nos resumos: confronte AC, DoD, implementação e evidência bruta disponível.

Stories em gate: CHAT-TOOLS-CONTRACT, CHAT-TOOLS-BE, CHAT-TOOLS-FE, DIRECT-HISTORY,
AUTOMATE-CHECKPOINT, CONTEXT-GAUNTLET-R2 e DOSSIER-CRED-LENGTH. STUDIO-REDESIGN está fora do gate.

Evidência consolidada mais recente: backend 607 passed/34 skipped; frontend 369 passed + tsc;
CHAT-TOOLS-BE E2E 28 e mutation por módulo no ledger; FE Playwright 3, OHM roundtrip e Stryker
79,27%; DIRECT-HISTORY 84,91%; CONTEXT rollup 16/16. Verifique a justificativa dos skips e os
escopos de mutation. Faça também o parecer crítico fresh-context exigido por CONTEXT-GAUNTLET-R2
AC#4 e pela auditoria AUTOMATE-CHECKPOINT.

Você pode executar apenas comandos de leitura/teste necessários. Não edite código nem documentos.
Para cada story escreva `PASS` ou `BOUNCE`, com AC/DoD/camadas verificadas e achados concretos com
caminho e linha. Só dê PASS se cumprir o QA Gate. Termine com uma decisão global exata:
`QA-PASS: <stories>` ou `QA-BOUNCE: <stories e motivos>`.
