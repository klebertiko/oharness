# ADR 0058 — Fábrica local: sala de controle e métricas

Status: proposta (issue #244, pacote A). Depende de 0053–0057.

## Decisão

### Sala de controle (app local, sem web hospedada)
Destino do app para a fábrica, seguindo `docs/design-system/` (tokens, dois temas, alvo de toque de 44 px do ADR 0033, i18n pt-BR/en do ADR 0034, axe sem violações). Seções:
1. **Runs**: ao vivo e históricas (usa o jornal existente). Abrir uma run ao vivo mostra a árvore e os eventos e permite interagir pelos controles que a run já oferece (parar, aprovar HITL, fila de mensagens).
2. **Work items**: kanban pelas colunas derivadas da tabela do ADR 0053 (`new`, `triaged`, `planned`, `implementing`, `in_review`, `verifying`, `monitoring`, `needs_you`, `parked`, `done`; `closed` atrás de filtro); card abre histórico, spec (editável, com aprovar), artefatos e runs vinculadas. Mover cartão por arrastar **não** existe: as transições são ações com checkpoint, também acessíveis por teclado.
3. **Caixa de entrada** (fila pessoal e local), seis tipos: pergunta feita, pergunta respondida (informativa), spec para revisar, PR/handoff pronto para revisar, bloqueado e falhou (estes dois só quando nada mais no item espera a pessoa). Itens saem sozinhos quando deixam de valer e podem ser resolvidos à mão, com desfazer.
4. **Automações**: lista (somente leitura no pacote A; o B preenche).
5. **Configuração**: definição vigente, diff entre versões, ativar/canary/rollback, agentes ligados/desligados, memória por agente, segredos (sem valores).
6. **Métricas**.
Dados da fábrica (itens, conversas, memórias, versões) ficam só no SQLite e na pasta de dados locais; o app não envia nada a terceiros.

### Métricas (definições)
Janela `window` (`7d`, `30d`, `90d`). Calculadas a partir das tabelas e do jornal, sem estado duplicado.
| Métrica | Definição |
| --- | --- |
| Vazão | PRs/branches abertos pela fábrica no período e, desses, quantos foram mergeados depois (merge observado ou confirmado, ADR 0055); work items concluídos. |
| Custo | tokens (e estimativa quando houver preço) das runs vinculadas, **incluindo runs filhas**; total, mediana por PR (dividida igualmente entre os PRs da run), por estágio e por tamanho de PR (S/M/L/XL, cortes em 100/500/1000 linhas alteradas). |
| Qualidade | proporção de itens aprovados na primeira revisão; média de voltas Review→Implement; itens com revisão `changes_requested` após verificação. |
| Autonomia | proporção dos PRs mergeados que não precisaram de push humano na branch antes do merge (abrir o PR conta como push da fábrica; comentário, revisão e o merge não contam). Detecção local: commits na branch com autor diferente da identidade da fábrica. Também: intervenções humanas por item. |
| Tempo de ciclo | mediana do início da run até o PR, até a primeira revisão e até o merge, com mediana **por etapa** (as medianas das etapas não somam o total); e `created_at`→`done`, p90. |
Todas separáveis por `factory_version` (comparar canary com estável).

### Endpoint
`GET /factory/metrics?window=&factory_version=` devolve JSON versionado (`schemaVersion`). É a mesma fonte da UI; o pacote B o expõe por MCP. Sem dados pessoais: ids, contagens e durações.

Ver também a fonte dos conceitos no ADR 0053. O painel permite escolher o intervalo de datas.

## Escolhas conservadoras
Métricas só leem; nenhum agente usa a métrica para mudar a fábrica por conta própria (auto-melhoria é o pacote C, sempre por PR). ROI em moeda fica fora (depende de preço que o app pode não conhecer).
