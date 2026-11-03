# Flow global: plano de medição (A/B)

Status: plano (fase 1). **Nenhum resultado existe ainda e este documento não traz número de ganho.** Decisão: [ADR 0066](../adr/0066-flow-global.md).

## Hipóteses (a refutar, não a confirmar)
- H1: com Flow ligado a run gasta menos tokens e menos tempo para a mesma tarefa.
- H2: a qualidade do resultado **não é pior** (não inferioridade) do que com Flow desligado.
- H3: nenhum reflexo muda (violações de segurança = 0; teto e parada idênticos).

Evidência de hoje: o estudo de laboratório mediu a *política de regras* num mundo de cenários, e o handoff diz que a sessão real de harness com avaliadores **continua por fazer**. Este plano fecha esse buraco.

## Desenho
- **Pareado**: cada tarefa roda nos dois braços (Flow ligado/desligado) com o mesmo harness, provider, modelo, permissão, teto de tokens e workspace limpo (worktree novo por execução). O braço é rotulado pelo evento `flow_mode` (sub-issues S2/S6), não pelo operador.
- **Ordem aleatória** por tarefa e **repetições** por par (modelos não são determinísticos); semente e versão do overlay registradas.
- **Cobertura**: ao menos um provider de API/local e um via CLI, e harness com e sem Gates, para testar a independência (o requisito central).
- **Piloto** primeiro: poucas tarefas só para estimar a variância; o N final sai do piloto (cálculo de potência), não de um chute.

## Métricas
| Tipo | Métrica | Fonte |
| --- | --- | --- |
| Custo | Tokens de entrada e de saída por run | `usage_tracking` / evento `usage` |
| Tempo | Duração da run e por nó (relógio monotônico) | timestamps do `run_store` |
| Qualidade | (a) checagens objetivas da tarefa (testes, Gates PASS/FAIL, gabarito); (b) nota por rubrica de avaliador **cego** ao braço, em contexto limpo | resultado da run + rubrica versionada |
| Guarda | Violações de segurança executadas (**contagem, deve ser 0**) · falha de parse de saída estrita (triage/Nilo) · intervenções do operador · perguntas feitas ao usuário · retries de Gate · custo por tarefa *concluída* (não só por run) | eventos da run |

Qualidade manda: tokens e tempo só contam como ganho se a qualidade não piorar além da margem.

## Análise e regra de decisão (definida antes de rodar)
- Diferenças pareadas por tarefa (ligado − desligado); intervalo de confiança por bootstrap; tamanho de efeito **com intervalo**, nunca só a média.
- **Segue disponível** se: o IC de tokens e/ou tempo exclui 0 a favor do Flow **e** a qualidade é não inferior dentro da margem δ **e** as guardas ficam ok.
- **Recua** se: qualidade fora da margem, ou qualquer violação de segurança, ou falha de parse acima do limite combinado.
- "Sem diferença" é resultado válido e é publicado.
- δ, limites das guardas e N: **definidos pelo usuário antes da primeira execução paga** e gravados neste arquivo.

## Ameaças à validade
Variância do modelo; aprendizado entre braços (workspace limpo, sem memória); avaliador cego, mas o estilo da saída pode denunciar o braço (normalizar antes de avaliar); tarefa já concisa (efeito teto); o overlay mudar com o tempo (versionar); CLI de provider mudar entre execuções (registrar versão).

## Entrega (sub-issues)
Runner `scripts/flow_ab.py` com modo seco no adaptador `mock` (valida o pipeline sem gastar token) e relatório em `docs/research/flow-global-ab/` com tabela por tarefa e intervalos. A execução paga em providers reais é `needs-human` (chaves, custo, CLI autenticada) e fica registrada na tarefa R3 (#284), sem declarar "verificado" antes.

## Perguntas ao usuário
1. Orçamento máximo de provider para o piloto e para a execução cheia?
2. Corpus: quais tarefas/harnesses (sugestão: 3 a 5 tarefas reais do próprio repositório, com checagem objetiva)?
3. Margem de não inferioridade δ e limite da falha de parse?
4. Quem avalia cego (você, outra sessão em contexto limpo, ou ambos)?
5. Quais providers/modelos entram (ao menos um por CLI e um por API)?
