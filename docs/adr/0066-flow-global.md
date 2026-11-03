# ADR 0066 — Flow global: um interruptor do app inteiro, abaixo de harness, provider e modelo

Status: proposta (fase 1, só documentos; implementação depende do merge do PR #336) · Origem: pedido do usuário (klebertiko) a partir do estudo de Flow em `src/laya-playground` (handoff `2026-10-30-flow-to-openharness`).
Relacionadas: [ADR 0005](0005-laya-decision-node.md) (modelo é evidência, nunca gate) · ADR 0065 (Flow de regras como evidência, PR #336, ainda não mesclado) · [UX](../design/flow-global/spec.md) · [Medição](../research/flow-global-measurement.md).

## Contexto

O PR #336 (fatia 1) entrega o `backend/flow/` com a política de regras (`advise`), o evento SSE `flow_advice` e um interruptor **por run**, desligado por padrão. Ele responde "o que a política aconselharia neste checkpoint". Não responde ao pedido de agora: **um único interruptor do app inteiro** que, ligado, põe *todo* neurônio artificial em andamento (qualquer run, agente, subagente ou chamada de modelo) em modo Flow, e, desligado, devolve tudo ao normal — **independente de harness, provider, modelo, agents e skills** — com uma interface que ajude visualmente o estado.

## Fontes e o que elas sustentam (e o que não)

Verificadas por busca nas páginas dos periódicos/PubMed em 2026-11-02; o texto integral só foi lido onde indicado no resumo, então cite página/trecho só depois de conferir a obra.

| Fonte | O que sustenta aqui |
| --- | --- |
| Dietrich, A. (2003). *Functional neuroanatomy of altered states of consciousness: the transient hypofrontality hypothesis.* Consciousness and Cognition 12(2), 231–256. doi:10.1016/S1053-8100(02)00046-6 | Estados alterados (corrida de resistência, meditação, devaneio, hipnose etc.) têm em comum uma **regulação para baixo transitória de redes pré-frontais**; o que difere entre estados é quais circuitos frontais seguem ativos. |
| Dietrich, A. (2004). *Neurocognitive mechanisms underlying the experience of flow.* Consciousness and Cognition 13(4), 746–761. doi:10.1016/j.concog.2004.07.002 | Aplica a hipótese ao flow: o sistema **explícito** (frontal/temporal medial; flexível, analítico, automonitorado) é suprimido e uma habilidade bem treinada roda no sistema **implícito** (gânglios da base; eficiente). Hipofrontalidade transitória é pré-requisito, não o fim. |
| Csikszentmihalyi, M. (1990). *Flow: The Psychology of Optimal Experience.* Harper & Row | Origem do construto: absorção, perda de autoconsciência, distorção do tempo. |
| Nakamura, J. & Csikszentmihalyi, M. (2002). *The concept of flow.* In Snyder & Lopez (eds.), Handbook of Positive Psychology, pp. 89–105 | Condições: **meta clara**, **feedback imediato**, **equilíbrio desafio–habilidade**. (Lido por cópias secundárias; conferir na obra publicada.) |
| Ulrich, Keller, Hoenig, Waller & Grön (2014). *Neural correlates of experimentally induced flow experiences.* NeuroImage 86, 194–202 | fMRI de perfusão (n=27): flow com **menos** ativação de córtex pré-frontal medial e amígdala e **mais** do giro frontal inferior esquerdo e do putâmen. Ou seja, a regulação é **seletiva**, não um "apagão" frontal. Só o resumo foi lido. |
| Dietrich & Al-Shawaf (2018). *The transient hypofrontality theory of altered states of consciousness.* J. Consciousness Studies 25(1–2) | Revisão posterior; descreve a teoria como regulação para baixo de redes cognitivas superiores. |

**Limites honestos.** (1) A teoria é sobre cérebros; aplicá-la a um sistema de software é **analogia de projeto**, não evidência de que modelos "entram em flow". (2) Há imagem funcional que contesta a versão forte (regiões dorsolaterais ativas no flow; o que cai é o pensamento autorreferente), por isso o mapa abaixo regula **funções**, nunca "desliga o pré-frontal". (3) "Reflexos de segurança do tronco cerebral não desligam" é o **princípio de projeto** do usuário e não uma afirmação de Dietrich; aqui ele vira uma invariante de engenharia testável, não uma tese neurocientífica. (4) O estudo de laboratório do Cursor (regras 96/96 etc.) mediu a *política* num mundo de cenários, não uma sessão real de harness com avaliadores; não vale como prova de ganho (handoff, "Fora desta sessão").

## Decisão

### 1. Mapa neurociência → OpenHarness

**Regulado para baixo (o "pré-frontal" do app).** Funções explícitas, de automonitoramento, que o Flow reduz quando ligado:

| Função pré-frontal (Dietrich 2004: analítica, autocrítica, monitoramento explícito) | Equivalente no OpenHarness | Como o Flow reduz |
| --- | --- | --- |
| Automonólogo / autoconsciência | Narração do que vai fazer, preâmbulos, "vou agora…", recapitulações | Overlay de instruções (item 2); `node_reason` e narração recolhidos por padrão na UI (nunca apagados do log) |
| Crítico interno | Autorrevisão redundante do que a própria chamada já verificou; pedir desculpas/hesitar | Overlay: verificar uma vez, sem ciclo extra. **O crítico externo (Gate, QA, SEC) não é regulado** (ver reflexos) |
| Monitoramento explícito / replanejamento | Replanejar sem falha nova; re-listar o plano a cada passo | Política `plan_once` (já existe no ADR 0065) vira regra de execução: um plano por meta, replanejar só diante de falha ou parada |
| Perguntas de esclarecimento | O modelo perguntando o que pode ser assumido com segurança | "Assumir e anotar": declarar a suposição em uma linha e seguir; perguntar só se a ambiguidade impede agir com segurança |
| Pedidos de confirmação de **baixo risco** | O modelo pedindo "posso continuar?" em passo reversível já coberto pela permissão vigente | Overlay: seguir sem pedir. **Não toca** nas aprovações do broker (ver reflexos) |
| Relatórios intermediários | Resumos de progresso entre passos | Agrupar em um relatório ao fim do passo/da run |
| Ruído de notificações | Avisos comuns na UI (SSE de severidade ordinária) | Adiar para um resumo ("N avisos adiados"), nunca descartar |
| Noção de tempo | Contadores ao segundo, ETAs, "há X s" | UI exibe tempo com sobriedade (spec de UX); o modelo não narra tempo |

**Reflexos — NUNCA regulados, com Flow ligado ou desligado.** Equivalem ao que o tronco cerebral mantém no princípio de projeto do usuário. Estão em código, não em instrução, portanto um modelo que ignore o overlay ainda é contido:

1. **Gates** (PASS/FAIL, `gate_retry`) e **HITL** (aprovação/merge humanos).
2. **Sandbox** e confinamento de caminho (`sandbox/paths`, `exec`).
3. **Hooks pré-ferramenta fail-closed** (`sandbox/hooks.py`).
4. **Permissões e aprovações do broker** (modos Plan/Read-only/Ask/Auto/Workspace write/Full; aprovação de ferramenta; confiança do workspace). **O Flow jamais amplia permissões.**
5. **Teto de custo/tokens** (`run_budget`, `budget_exceeded`) e compactação.
6. **Parada do operador** (`RunControl.stop`), a qualquer momento.
7. **Redação de segredos** e a regra "resultado de ferramenta é dado" (`TOOL_DATA_RULE`).
8. **Avisos críticos**: erro, pedido de aprovação, orçamento próximo do teto, parada. Nunca silenciados nem adiados.
9. **O próprio interruptor**: sempre alcançável, de qualquer tela, por atalho e botão.

**O Flow nunca é gate.** O conselho de regras do ADR 0065 continua evidência; promover abstenção/subida/descida a desvio de aresta segue dependendo de um sim por escrito do usuário e do ADR 0005.

**Condições de entrada** (Nakamura & Csikszentmihalyi 2002) e o que o app honestamente tem: *meta clara* (o objetivo da run/turno, mostrado fixo na UI); *feedback imediato* (passo e resultado de Gate visíveis na hora, preservados no modo foco); *equilíbrio desafio–habilidade* — **o OpenHarness não tem escada de habilidades** (handoff), então o app **não alega** medir isso; `raise`/`request_neighbor` continuam sem destino.

### 2. Contrato de camada: o FlowGovernor

Ele vive **abaixo** de harness, provider, modelo, agents e skills, no ponto por onde toda chamada passa. Todo adaptador de modelo nasce de `adapters.get_adapter()` (usado em `engine.py`, `providers/resolution.py`, rotas de execução e sondagem), e `AdapterConfig.system_prompt` já é honrado por todos (Claude CLI via `--system-prompt`, Codex por prefixo, OpenAI-compatível por mensagem `system`, mock). Logo:

- **`backend/flow/governor.py`** (puro, sem I/O de modelo): `FlowGovernor` guarda `FlowState{enabled, epoch}` e expõe `current()`. Uma só fonte de verdade, persistida na tabela `flow_config` do #336 (`GET/PUT /flow/config`), lida **a cada chamada** (não congelada na criação da run).
- **`FlowAdapter`** (decorador de `AgentAdapter`, aplicado dentro de `get_adapter`): em `invoke`/`stream`/`stream_events`, se `enabled`, devolve a chamada com `system_prompt += OVERLAY` (bloco curto, versionado, em inglês, igual para qualquer provider, que **termina preservando o formato pedido**: "mantenha exatamente o formato de saída solicitado"). `probe` passa direto (nada de overlay em verificação de conexão). Subagentes e o broker herdam sem mudança porque recebem o adaptador já decorado; o `replace(config, system_prompt=…)` do broker acrescenta depois, então o overlay entra **uma vez** (teste).
- **Política de passos opcionais** (`backend/flow/steps.py`): funções puras que o motor consulta num checkpoint: replanejar? agrupar relatório? Só *reduzem* passos opcionais, nunca pulam Gate, nunca criam aresta.
- **Filtro de eventos** (`backend/flow/quiet.py`): toda espécie de evento SSE é **classificada** (`critical` | `ordinary`) numa tabela única; espécie **não classificada vale `critical`** (falha para o lado seguro) e um teste exaustivo quebra o CI se surgir espécie nova sem classe. `ordinary` é adiado para o resumo, `critical` passa sempre.
- **Evento `flow_mode`** `{on, epoch}` emitido no stream de cada run quando o estado em vigor muda e ao iniciar a run, para que transcrição e histórico digam *quais chamadas rodaram sob Flow* (indispensável para a medição).
- **Semântica de ligar/desligar com runs em andamento.** O estado vale **a partir da próxima chamada de modelo** de cada run, subagente incluso. Uma chamada já em curso (processo de CLI já lançado, stream aberto) **termina como começou**; não afirmamos o contrário. Resultado: em segundos, todas as runs vivas passam a rodar sob o novo estado.
- **Falha do governor ⇒ Flow desligado.** Ao contrário dos hooks (fail-closed), uma falha do Flow volta ao comportamento normal, nunca mexe em reflexos, e registra o motivo. O Flow não pode piorar a segurança por quebrar.
- **Relação com o #336.** O padrão global de `flow_config` vira o interruptor do app. O `ExecuteRequest.flow` por run permanece como **substituição explícita** (útil para A/B e depuração). O conselho `flow_advice` passa a ser emitido quando o Flow global está ligado (decisão confirmável, Pergunta 1). O `FlowToggle` do #336 é subsumido pelo interruptor global (UX).

**Invariantes testadas (contrato do Flow global)**, estendendo `test_engine_flow_advice.py`: com Flow desligado, ligado e ligado com adaptador/conselheiro adversarial, **idênticos**: eventos de Gate, decisões de permissão e aprovação, resultados de hook, parada por teto de custo, parada do operador, status terminal. A única mutação permitida em `AdapterConfig` é o sufixo de `system_prompt`. Nenhum campo de permissão/ferramenta/teto é lido ou escrito pelo `flow/`.

## Fora do escopo (fase 1 e desta decisão)

Laya/Clef; `request_neighbor`/skills/arestas; recalibrar pisos; `GATES.md`; `triage.py` (é outra pergunta, ADR 0005); `backend/factory/**` (Factory A); níveis de intensidade (um interruptor, liga/desliga); ocultar ou apagar raciocínio do log (só recolher na UI).

## Consequências e riscos

- Overlay é só instrução: o modelo pode ignorá-lo ou, pior, **reduzir qualidade** (menos verificação, suposições erradas). Por isso o ganho **não é assumido**: ver plano de medição, com métricas-guarda e critério de reversão. Padrão **desligado** até haver medição.
- Chamadas de saída estrita (JSON do triage, planos do Nilo) também recebem o overlay, com a cláusula de formato; a taxa de falha de parse é métrica-guarda (Pergunta 4).
- `claude`/`cursor`/`codex` via CLI recebem o overlay pelo mecanismo do adaptador; a eficácia por provider **não foi verificada** e só se declara medida depois do A/B real (verificação que o sandbox não faz: provider real, tarefa R3 #284).

## Perguntas ao usuário (decisões que não são minhas)

1. **Um interruptor ou dois?** Recomendo: global manda; `ExecuteRequest.flow` fica como substituição por run (A/B). E o global liga também o `flow_advice` do #336?
2. **Padrão desligado** até a medição? (recomendo sim)
3. **Mudança no meio da run**: vale na próxima chamada de modelo (recomendo) ou só em runs novas?
4. **Overlay em chamadas de saída estrita** (triage, Nilo): aplicar com cláusula de formato (recomendo, é o que "todos" pede) ou isentar?
5. **Persistência**: o estado sobrevive a reiniciar o app? (recomendo sim)
6. **Atalho**: `Mod+Shift+F` (sem conflito no keymap atual; confirmar no teclado real do Tauri)?
7. **Raciocínio na UI**: sob Flow, recolher por padrão (recomendo) ou manter aberto?
8. **Medição**: orçamento de provider, tarefas do corpus, margem de não inferioridade de qualidade (δ) e quem avalia — ver o plano.
9. **Número do ADR**: 0066 (o #336 usa 0065); confirmar se há faixa reservada para esta sessão.
10. **Ordem**: a implementação só começa após o merge do #336; confirmar que o `FlowToggle` pode ser absorvido pelo interruptor global.
