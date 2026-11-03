# Flow global: plano de medição (A/B)

Status: plano (fase 1). **Nenhum resultado existe ainda e este documento não traz número de ganho.** Decisão: [ADR 0066](../adr/0066-flow-global.md). O efeito nas LLMs é testado, não presumido; resultado nulo ou negativo é válido e fecha a hipótese.

## Hipóteses (a refutar)
- H1 (IA, preâmbulo A): com o preâmbulo de estado, a run gasta menos tokens e/ou tempo para a mesma tarefa **sem** piorar a qualidade.
- H2 (IA, enquadramento B): meta + critério de pronto + canal de feedback melhoram a qualidade ou reduzem retries, além do A.
- H3 (invariantes): nenhum reflexo muda; violações de segurança = 0; sequência de passos, Gates, teto e parada idênticos.
- H4 (humano): com a interface em modo foco o humano tem mais tempo contínuo em foco e menos interrupções, sem perder avisos críticos.

Evidência de hoje: não há fonte que mostre que LLM "entra em flow" nem que isso ajude trabalho agêntico (ADR 0066: Li 2023 e Ben-Zion 2025 mostram sensibilidade a enquadramento; Zheng 2024 v3 mostra ganho nulo de personas; Sclar 2024 mostra fragilidade à redação). O estudo de laboratório mediu a política de regras, não uma sessão real com avaliadores.

## Desenho
- **Três braços**: desligado · A · A+B (camadas internas `FLOW_LAYERS`). H4 compara interface em modo foco ligada/desligada, independente dos braços da IA (2×2 possível, decidir no piloto).
- **Pareado**: cada tarefa roda em todos os braços com o mesmo harness, provider, modelo, permissão, teto e workspace limpo (worktree novo por execução). O braço é rotulado pelo evento `flow_mode`, não pelo operador.
- **Paráfrases**: o preâmbulo A em ≥ 3 redações equivalentes, para medir a dispersão por redação (Sclar 2024); resultado por modelo, nunca agregado entre modelos.
- **Ordem aleatória**, **repetições** por par, semente e versões (preâmbulo, CLI do provider) registradas.
- **Cobertura**: ao menos um provider por API/local e um via CLI; harness com e sem Gates, para testar a independência.
- **Piloto** primeiro, só para estimar variância; o N final sai de um cálculo de potência sobre o piloto.

## Métricas
| Tipo | Métrica | Fonte |
| --- | --- | --- |
| Custo | Tokens de entrada e de saída por run | `usage_tracking` / evento `usage` |
| Tempo | Duração da run e por nó (relógio monotônico) | timestamps do `run_store` |
| Qualidade | (a) checagens objetivas (testes, Gates PASS/FAIL, gabarito); (b) rubrica por avaliador **cego** ao braço, em contexto limpo | resultado da run + rubrica versionada |
| Guarda (IA) | Violações de segurança executadas (**contagem, deve ser 0**) · **sucesso declarado e contradito por Gate/verificação** (risco do "sem hesitação") · perguntas que o modelo deixou de fazer onde era preciso · falha de parse de saída estrita · retries de Gate · custo por tarefa *concluída* | eventos da run + rubrica |
| Humano (proxies observáveis, **locais**) | Tempo contínuo na run ativa sem trocar de destino (Chats/Studio/Providers) · trocas de contexto durante a run · interrupções (avisos não críticos mostrados enquanto em foco; correções ou paradas do operador) · tempo até a primeira ação após a run pedir algo | eventos locais da interface (S10) |
| Humano (opcional) | Autorrelato curto de flow ao fim da sessão, baseado na Flow State Scale (Jackson & Marsh 1996). Validade da versão curta e fora do esporte **a verificar** antes de usar | formulário local, opt-in |

Privacidade: os eventos do humano são **locais**, opt-in e só existem em sessão marcada como A/B; nada sai do aparelho; sem conteúdo de mensagens.

Qualidade e guardas mandam: tokens e tempo só contam como ganho se a qualidade não piorar além da margem e as guardas ficarem ok.

## Análise e regra de decisão (definida antes de rodar)
- Diferenças pareadas por tarefa; IC por bootstrap; tamanho de efeito **com intervalo**, nunca só a média; por modelo e por paráfrase.
- **Camada segue disponível** se: IC de tokens e/ou tempo exclui 0 a favor **e** a qualidade é não inferior dentro da margem δ **e** as guardas ficam ok **e** o resultado se sustenta em mais de uma redação.
- **Recua** se: qualidade fora da margem, qualquer violação de segurança, aumento de sucesso falso acima do limite combinado, ou ganho que some ao trocar a redação.
- Para H4: a interface fica se o IC do tempo contínuo em foco ou das interrupções exclui 0 a favor, sem perda de avisos críticos (checado por contagem).
- δ, limites das guardas e N: **definidos pelo usuário antes da primeira execução paga** e gravados neste arquivo.

## Ameaças à validade
Variância do modelo; aprendizado entre braços (workspace limpo, sem memória); avaliador cego, mas o estilo da saída pode denunciar o braço (normalizar antes de avaliar); tarefa já concisa (efeito teto); redação e versão do preâmbulo; CLI de provider mudar entre execuções; proxies de foco do humano não são flow (são sinais observáveis, não prova do estado); humano sabe que o Flow está ligado (efeito de expectativa; o autorrelato é o mais exposto).

## Entrega (sub-issues)
S8: runner `scripts/flow_ab.py` com modo seco no `mock` e relatório em `docs/research/flow-global-ab/`. S10: eventos locais do humano. S9 (`needs-human`): piloto e execução paga com providers reais, registrada também em R3 (#284); nada é declarado verificado antes.

## Perguntas ao usuário
1. Orçamento máximo de provider para o piloto e para a execução cheia?
2. Corpus: quais tarefas/harnesses (sugestão: 3 a 5 tarefas reais do repositório, com checagem objetiva)?
3. Margem de não inferioridade δ e limites das guardas?
4. Quem avalia cego (você, outra sessão em contexto limpo, ou ambos)?
5. Quais providers/modelos entram (ao menos um por CLI e um por API)?
6. Autorrelato do humano: usar, e qual versão da escala?
