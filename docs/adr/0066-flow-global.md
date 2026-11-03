# ADR 0066 — Flow global: estado compartilhado entre você e as IAs, induzido abaixo de harness, provider e modelo

Status: **aceita em 2026-11-03** com as recomendações deste ADR como decisões (ver "Decisões adotadas"); Flow DESLIGADO por padrão; o #336 já está mesclado · Origem: pedido do usuário (klebertiko) a partir do estudo de Flow em `src/laya-playground` (handoff `2026-10-30-flow-to-openharness`); escopo corrigido pelo usuário em 2026-11-02 (ver "Leitura do pedido").
Relacionadas: [ADR 0005](0005-laya-decision-node.md) (modelo é evidência, nunca gate) · ADR 0065 (Flow de regras como evidência, PR #336, ainda não mesclado) · [UX](../design/flow-global/spec.md) · [Medição](../research/flow-global-measurement.md).

## Leitura do pedido (o que o Flow é e o que não é)

Com o interruptor **Flow** do app ligado, duas coisas acontecem juntas: (1) **todas as LLMs em uso**, de qualquer harness, provider, modelo, agent ou skill, são colocadas em **estado de flow**, o análogo artificial do estado que humanos atingem; (2) **o app se transforma** para ajudar **você** a entrar no mesmo estado. É um estado **compartilhado humano + IA** (co-flow). Desligado, tudo volta ao normal.

**O Flow não corta passos, verificações nem etapas de ninguém.** Ele induz um estado; não remove trabalho. A versão anterior deste ADR tratava o Flow como regulação para baixo de etapas ("pular replanejamento", "adiar avisos do motor", "política de passos opcionais"): isso foi descartado.

## Fontes e o que elas sustentam (e o que não)

Verificadas por busca nas páginas dos periódicos, PubMed e arXiv em 2026-11-02. Onde só o resumo foi lido, a tabela diz; confira o trecho antes de citar página.

**Flow humano**

| Fonte | O que sustenta aqui |
| --- | --- |
| Dietrich, A. (2003). *Functional neuroanatomy of altered states of consciousness: the transient hypofrontality hypothesis.* Consciousness and Cognition 12(2), 231–256. doi:10.1016/S1053-8100(02)00046-6 | Estados alterados têm em comum uma **regulação para baixo transitória de redes pré-frontais**; o que difere entre estados é quais circuitos frontais seguem ativos. |
| Dietrich, A. (2004). *Neurocognitive mechanisms underlying the experience of flow.* Consciousness and Cognition 13(4), 746–761. doi:10.1016/j.concog.2004.07.002 | No flow, uma habilidade bem treinada roda no sistema **implícito** sem interferência do sistema **explícito** (analítico, de automonitoramento); hipofrontalidade transitória é pré-requisito. |
| Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience.* Harper & Row | Construto: absorção na tarefa, menos autoconsciência, distorção do tempo. |
| Nakamura, J. & Csikszentmihalyi, M. (2002). *The concept of flow.* In Snyder & Lopez (eds.), Handbook of Positive Psychology, pp. 89–105 | Condições: **meta clara**, **feedback imediato**, **equilíbrio desafio–habilidade**. (Lido por cópias secundárias.) |
| Ulrich, Keller, Hoenig, Waller & Grön (2014). NeuroImage 86, 194–202 (*Neural correlates of experimentally induced flow experiences*) | fMRI (n=27): flow com **menos** córtex pré-frontal medial e amígdala e **mais** giro frontal inferior esquerdo e putâmen: regulação **seletiva**, não apagão. (Só o resumo.) |
| Jackson, S. & Marsh, H. (1996). *Development and validation of a scale to measure optimal experience: the Flow State Scale.* J. Sport & Exercise Psychology 18(1), 17–35. doi:10.1123/jsep.18.1.17 | Escala de 36 itens, 9 dimensões, validada em atletas: base para o autorrelato opcional do humano (validade fora do esporte **não** verificada). |

**Condicionamento de estado em LLMs** (o que existe e o que não prova nada sobre flow)

| Fonte | O que mostra | Limite |
| --- | --- | --- |
| Li et al. (2023). *Large Language Models Understand and Can be Enhanced by Emotional Stimuli.* arXiv:2307.11760 | Frases de estímulo emocional anexadas ao prompt mudaram o desempenho em 45 tarefas (Flan-T5, Vicuna, Llama 2, BLOOM, ChatGPT, GPT-4). | Prompt de uma frase em benchmarks; não é agente com ferramentas; ganhos relatados pelos autores, sem replicação independente verificada aqui. |
| Ben-Zion et al. (2025). *Assessing and alleviating state anxiety in large language models.* npj Digital Medicine 8, 132. doi:10.1038/s41746-025-01512-6 | O **estado autorrelatado** do GPT-4 (STAI-state) sobe com narrativas traumáticas e cai (sem voltar à linha de base) com prompts de relaxamento. Ou seja, o contexto desloca o "estado" expresso. | Mede o que o modelo diz sobre si, não a qualidade da tarefa; um modelo; autores ressalvam generalização. |
| Zheng, Pei & Jurgens (2023/2024). *Is "A Helpful Assistant" the Best Role…* arXiv:2311.10054 (v3 retitulada *When "A Helpful Assistant" Is Not Really Helpful…*) | A v1 achava ganho com papéis; a **v3 conclui que personas no system prompt não melhoram** o desempenho em perguntas fatuais. | Aviso: enquadrar o modelo com um "papel/estado" pode não render nada. As versões divergem; cite a que usar. |
| Sclar, Choi, Tsvetkov & Suhr (2024). *Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design…* EMNLP 2024, arXiv:2310.11324 | O desempenho varia muito entre formatações equivalentes do mesmo prompt e quase não correlaciona entre modelos. | Obriga a testar **várias paráfrases** do preâmbulo e por modelo, e relatar a dispersão. |

**Conclusão honesta.** Há evidência de que modelos são sensíveis a enquadramento de estado (Li, Ben-Zion) e evidência de que enquadramento de papel pode não melhorar nada (Zheng) e é frágil à redação (Sclar). **Não existe fonte que mostre que um modelo "entra em flow" nem que isso melhora trabalho agêntico.** Tudo abaixo que afirma efeito nas LLMs é **hipótese a testar**; a analogia com o cérebro é de projeto. "Reflexos do tronco cerebral não desligam" é princípio seu, não afirmação de Dietrich; aqui vira invariante de engenharia testável. O estudo de laboratório do Cursor mediu a política de regras num mundo de cenários, não uma sessão real com avaliadores.

## Decisão

### 1. Mapa neurociência → OpenHarness, como indução de estado

**Pré-condições do flow** (Nakamura & Csikszentmihalyi 2002), para você e para as IAs:

| Pré-condição | Para você (a interface) | Para a IA (a camada comum) |
| --- | --- | --- |
| Meta clara | Meta da run/turno fixa no topo | **Enquadramento da tarefa**: meta explícita e critério de pronto (os Gates da run, quando houver) no contexto de cada chamada. Fonte: `data.goal` do nó e a mensagem do turno; a percepção do #336 (`goal_met`) já lê essa meta |
| Feedback imediato | Passo atual e resultado de Gate em tempo real, sempre visíveis | O resultado de ferramentas e Gates já volta ao modelo; o enquadramento apenas **nomeia** esse canal ("aja, observe o resultado, ajuste"). A percepção do #336 (repetição do último resultado, parada) segue como evidência |
| Equilíbrio desafio–habilidade | — | **Não há como medir nem controlar hoje** (o app não tem escada de habilidades, handoff). O Flow **não alega** isso. Proxy possível mais tarde, a medir antes: retries de Gate como sinal de "desafio alto demais" |

**Análogo da hipofrontalidade transitória** (menos autoconsciência/automonitoramento explícito, atenção absorvida na tarefa):

| Em humanos (Dietrich 2003/2004) | Para você | Para a IA (hipótese a testar) |
| --- | --- | --- |
| Menos autoconsciência e noção de tempo | Menos relógios, contadores, ETAs e medidores competindo por atenção; avisos não críticos apresentados depois, nunca descartados | **Condicionamento de expressão**: atenção na tarefa, linguagem direta, sem desculpas, autocomentário nem recapitulação do próprio processo. Muda *como* diz, não *o que faz* |
| Sistema implícito executa a habilidade | Foco na run ativa, resto do cromo mais quieto | Mesmo preâmbulo; nenhuma mudança de ferramentas, parâmetros de amostragem ou limites |

**Mecanismos candidatos** (todos provider-agnósticos, só texto; status honesto):

| Mecanismo | Status |
| --- | --- |
| **A. Preâmbulo de estado** no `system_prompt` (absorção na tarefa, expressão direta), em ≥ 3 paráfrases equivalentes | Hipótese. Li/Ben-Zion sugerem sensibilidade; Zheng/Sclar avisam de ganho nulo e fragilidade. Entra só com medição |
| **B. Enquadramento da tarefa** (meta, critério de pronto, canal de feedback) | Hipótese; é a pré-condição que dá para operacionalizar. Medido em separado do A |
| C. Sinal de feedback dinâmico (ex.: "o último resultado se repetiu") vindo da percepção do #336 | Hipótese, fora das primeiras fatias |
| D. Ajustar amostragem (`temperature` etc.) | **Rejeitado**: muda o comportamento de forma diferente por provider e foge de "estado" |
| E. Esteering de ativações / representation engineering | **Fora**: exige pesos; não serve a provider por API ou CLI |

Rascunho do preâmbulo (A), em inglês, igual para qualquer provider, a refinar e a testar em paráfrases:

> Working state: you are absorbed in this task. Keep your attention on the work itself: act, observe the result, adjust. Express yourself plainly and directly, without filler such as apologies, self-commentary or restating your own process. This changes how you phrase things, not what you do: still verify your work, still follow every rule, permission and tool restriction you were given, still say plainly when something is uncertain, blocked or failed, and still ask when you cannot proceed safely.

**Risco central do A:** expressão "sem hesitação" pode virar excesso de confiança. Métrica-guarda obrigatória: afirmações de sucesso contradizidas por Gate ou verificação.

### 2. Invariantes: o que o Flow não toca (nem amplia, nem reduz)

Gates e HITL · sandbox e confinamento de caminho · hooks pré-ferramenta fail-closed · permissões, modos e aprovações do broker · teto de custo/tokens e compactação · parada do operador (`RunControl.stop`) · redação de segredos e a regra "resultado de ferramenta é dado" · avisos críticos (erro, aprovação pendente, orçamento perto do teto, parada) · a ordem e a quantidade de nós, passos e verificações da run · o formato de saída pedido. Também não toca ferramentas, parâmetros de amostragem nem `max_tokens`. **O Flow nunca é gate** (ADR 0005); o conselho `flow_advice` do #336 segue evidência.

Testável: com Flow desligado, ligado e ligado com adaptador adversarial, são **idênticos** a sequência de nós/passos, eventos de Gate, decisões de permissão, resultados de hook, parada por teto e pelo operador e o status terminal; e a **única** mutação de `AdapterConfig` é o sufixo de `system_prompt`.

### 3. Contrato de camada: FlowGovernor e FlowAdapter

Abaixo de harness, provider, modelo, agents e skills, no ponto por onde toda chamada passa. Todo adaptador nasce de `adapters.get_adapter()` (`engine.py`, `providers/resolution.py`, rotas de execução e sondagem) e `AdapterConfig.system_prompt` é honrado por todos (Claude CLI `--system-prompt`, Codex por prefixo, OpenAI-compatível por mensagem `system`, mock).

- **`backend/flow/governor.py`** (puro): `FlowState{enabled, epoch}`, lido **a cada chamada**, persistido em `flow_config` do #336 (`GET/PUT /flow/config`). Uma só fonte de verdade.
- **`FlowAdapter`**: decorador de `AgentAdapter` aplicado dentro de `get_adapter`; ligado, acrescenta ao `system_prompt` o preâmbulo (A) e, quando o ponto de chamada informar, o enquadramento (B) em `config.extra["flow"]`. `probe` passa direto. Subagentes e broker herdam; o `replace(system_prompt=…)` do broker acrescenta depois, então o texto entra **uma vez** (teste). Sem `extra["flow"]` o enquadramento B é omitido e A funciona sozinho: **independente de harness**.
- **Evento `flow_mode`** `{on, epoch, layers}` no início de cada run e a cada mudança, para que transcrição e histórico digam *quais chamadas rodaram sob Flow* (e com quais camadas).
- **Ligar/desligar com runs em andamento**: vale a partir da **próxima chamada de modelo** de cada run, subagentes inclusos. Uma chamada já em curso termina como começou.
- **Falha do governor ⇒ Flow desligado**, registrada; nunca toca os invariantes.
- **Camadas internas** (`FLOW_LAYERS`: A, A+B) existem só para o A/B; para você continua um único interruptor.
- **Relação com o #336**: o padrão global de `flow_config` vira o interruptor do app; `ExecuteRequest.flow` por run permanece como substituição explícita (A/B). O `FlowToggle` do #336 é absorvido pelo interruptor global.

### 4. UX do co-flow
Parte central, em [`docs/design/flow-global/spec.md`](../design/flow-global/spec.md): indicador do estado compartilhado (você + N IAs), calma visual, foco na run ativa, menos ruído visual (o app hoje não tem som nem notificação do sistema; o Flow não adiciona nenhum), transição suave, `prefers-reduced-motion`, a11y/axe, pt-BR e en, assistente = Nilo.

### 5. Medição
[`docs/research/flow-global-measurement.md`](../research/flow-global-measurement.md): três braços (desligado, A, A+B), tokens, tempo, qualidade, guardas, e proxies observáveis do humano. O efeito nas LLMs é **testado, não presumido**; padrão **desligado** até haver resultado.

## Fora do escopo
Laya/Clef; `request_neighbor`, skills e arestas novas; recalibrar pisos; `GATES.md`; `triage.py`; `backend/factory/**`; steering de ativações; qualquer corte de passo, verificação ou aviso crítico.

## Consequências e riscos
- O preâmbulo pode não render nada (Zheng) ou render só para algumas redações/modelos (Sclar). Resultado nulo é válido e fecha a hipótese.
- Excesso de confiança por expressão "sem hesitação": guarda de afirmações falsas de sucesso.
- Chamadas de saída estrita (JSON do triage, planos do Nilo) recebem o preâmbulo, que manda preservar o formato; falha de parse é métrica-guarda.
- Eficácia por provider (claude/cursor/codex via CLI, API, local) **não foi verificada**; só se declara depois do A/B real (sandbox não verifica; tarefa R3 #284).

## Decisões adotadas (2026-11-03)

O usuário aceitou "siga as recomendações do ADR" (relayado pela sessão Maestro). Tudo é reversível e o Flow nasce **desligado**. Respostas às perguntas abaixo: 1 o interruptor global manda; `ExecuteRequest.flow` fica como substituição por run (A/B) e o global liga também o `flow_advice` · 2 padrão desligado até a medição · 3 vale na próxima chamada de cada run · 4 preâmbulo também em saída estrita, com a cláusula de formato · 5 estado persiste · 6 `Mod+Shift+F`, a confirmar no teclado real · 7 `node_reason` recolhido por padrão, só apresentação · 11 número 0066. **Sem recomendação explícita no texto, adotado o mais conservador** (revisável): 8 a camada B fica no desenho, implementada depois da A e atrás de `FLOW_LAYERS`; o A/B decide se entra · 9 só proxies observáveis na v1, autorrelato fora · 10 orçamento, corpus, margem de não inferioridade, avaliador e providers seguem abertos e são pré-requisito da S9 (`needs-human`).

## Perguntas originais
1. **Um interruptor ou dois?** Proposta: o global manda; `ExecuteRequest.flow` fica como substituição por run (A/B). O global também liga o `flow_advice` do #336?
2. **Padrão desligado** até a medição? (recomendo sim)
3. **Mudança no meio da run** vale na próxima chamada de cada run (recomendo) ou só em runs novas?
4. **Preâmbulo em chamadas de saída estrita** (triage, Nilo): aplicar com a cláusula de formato (recomendo, é o "todos") ou isentar?
5. **Persistência** do estado entre reinícios? (recomendo sim)
6. **Atalho** `Mod+Shift+F` (sem conflito no keymap atual)?
7. **Raciocínio na UI** (`node_reason`) recolhido por padrão sob Flow? É só apresentação, o log guarda tudo (recomendo sim).
8. **Camada B** (enquadramento com meta e critério de pronto) entra já no desenho ou só depois do resultado do A?
9. **Autorrelato do humano** (Flow State Scale, opcional, local) no A/B: sim ou só proxies observáveis?
10. **Medição**: orçamento de provider, corpus, margem de não inferioridade, quem avalia cego, quais providers (plano).
11. **Número do ADR**: 0066 (o #336 usa 0065); há faixa reservada?
