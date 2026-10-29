# ADR 0058 — Fábrica local: sala de controle e métricas

Status: proposta (issue #244, pacote A). Depende de 0053–0057.

## Decisão

### Sala de controle (app local, sem web hospedada)
Destino do app para a fábrica, seguindo `docs/design-system/` (tokens, dois temas, alvo de toque de 44 px do ADR 0033, i18n pt-BR/en do ADR 0034, axe sem violações). Seções:
1. **Runs**: ao vivo e históricas (usa o jornal existente). Abrir uma run ao vivo mostra a árvore e os eventos e permite interagir pelos controles que a run já oferece (parar, aprovar HITL, fila de mensagens).
2. **Work items**: kanban pelas colunas derivadas (`new`, `triaged`, `planned`, `implementing`, `in_review`, `verifying`, `done`, `parked`); card abre histórico, spec (editável, com aprovar), artefatos e runs vinculadas. Mover cartão por arrastar **não** existe: as transições são ações com checkpoint, também acessíveis por teclado.
3. **Caixa de entrada**: itens `awaiting_human` (specs a aprovar, "pronto para revisão", perguntas do foreman).
4. **Automações**: lista (somente leitura no pacote A; o B preenche).
5. **Configuração**: definição vigente, diff entre versões, ativar/canary/rollback, agentes ligados/desligados, memória por agente, segredos (sem valores).
6. **Métricas**.
Dados da fábrica (itens, conversas, memórias, versões) ficam só no SQLite e na pasta de dados locais; o app não envia nada a terceiros.

### Métricas (definições)
Janela `window` (`7d`, `30d`, `90d`). Calculadas a partir das tabelas e do jornal, sem estado duplicado.
| Métrica | Definição |
| --- | --- |
| Vazão | work items que chegaram a `done` (e que chegaram a "pronto para revisão") por janela. |
| Custo | tokens (e estimativa quando houver preço) das runs vinculadas; total, por item concluído e por estágio. |
| Qualidade | proporção de itens aprovados na primeira revisão; média de voltas Review→Implement; itens com revisão `changes_requested` após verificação. |
| Autonomia | proporção de transições feitas sem intervenção humana além dos checkpoints obrigatórios; intervenções por item. |
| Tempo de ciclo | `created_at`→`done`, mediana e p90, e duração por estágio. |
Todas separáveis por `factory_version` (comparar canary com estável).

### Endpoint
`GET /factory/metrics?window=&factory_version=` devolve JSON versionado (`schemaVersion`). É a mesma fonte da UI; o pacote B o expõe por MCP. Sem dados pessoais: ids, contagens e durações.

## Escolhas conservadoras
Métricas só leem; nenhum agente usa a métrica para mudar a fábrica por conta própria (auto-melhoria é o pacote C, sempre por PR). ROI em moeda fica fora (depende de preço que o app pode não conhecer).
