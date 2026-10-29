# ADR 0054 — Fábrica local: foreman, agentes e memória por agente

Status: proposta (issue #244, pacote A). Depende de 0053.

## Vocabulário
- **Agente da fábrica**: ator de longa duração da fábrica, definido em arquivo (ADR 0056). **Não** é o *Agent* de nó do harness (CONTEXT.md): um agente da fábrica **executa** um harness `.ohm` (ou o loop direto) em runs.
- **Foreman**: o agente coordenador de uma fábrica, com **handle** (`@payments`). Não é Nilo (Nilo é o assistente do Studio e não é papel de equipe).

**Estágio** neste conjunto de ADRs é sempre *estágio de work item da fábrica*; não tem relação com o termo "stage" da visão de chat (CONTEXT.md). Os termos entram no glossário no PR da sala de controle.

## Decisão

### Agentes
Cada agente declara: `id`, `role` (`foreman`, `triage`, `spec`, `implement`, `review`, `verify`, `monitor` ou `custom`), `model` (provider+modelo), `harness` (id de harness salvo, opcional), `instructions`, `skills`, `mcp` (servidores permitidos), `permissions` (preset do ADR 0021 + limites), `tokenCeiling` (ADR 0025/0040), `secrets` (lista de `secretRef`, ADR 0057), `memory` (limites) e `enabled`.
- **Padrão**: o foreman é obrigatório; a pessoa escolhe quais dos demais (Triage, Spec, Implement, Review, Verify, Monitor) incluir. **Adoção parcial**: só `enabled: true` participam; o foreman só atribui estágios a agentes ligados e o resto do trabalho espera a pessoa (ex.: ligar só Triage).
- **Custom**: qualquer `id` novo com `role: custom` e gatilho opcional (usado pelo pacote B para automações).
- **Skills por agente**: referências a skills do repositório (`.oharness/factory/skills/<id>/SKILL.md`, ADR 0056). **MCPs por agente**: lista explícita de servidores; nenhum herdado implicitamente. **Permissões por agente**: o preset mais restritivo vale; um agente nunca ganha capacidade que a fábrica não declara.

### Acesso vem da configuração, nunca das instruções
O que um agente alcança (repositórios, `secrets`, `mcp`, `permissions`, runner) é calculado **pelo código** a partir dos campos de configuração do agente na definição versionada. `instructions` e skills dão *orientação*, não *acesso*: editar o texto de um prompt ou instalar uma skill não adiciona repositório, segredo, servidor MCP nem permissão. Um teste de contrato compara o conjunto de capacidades calculado antes e depois de mudar só as instruções e exige igualdade. Isso também limita prompt injection: texto injetado no contexto não amplia capacidades.

### Skills (três origens)
(1) **de papel/integração**, embarcadas no app por papel (ex.: o foreman e a skill de devolver resposta à origem do item); (2) **embutidas** do OHarness (ex.: `factory-definition`, para editar e validar a definição, e `factory-intake`, usada pelo pacote B); (3) **custom**, `SKILL.md` na definição, globais (`skills/<id>/`) ou de um agente (`agents/<id>/skills/<id>/`). Agentes custom **não** trazem skills embutidas. Skills estendem as instruções; não substituem as embutidas.

### Foreman
Escolhe o **caminho mais curto que ainda cumpre a política de qualidade da fábrica**: pula estágios quando o trabalho já está bem definido, começa no meio quando há contexto, e devolve a um estágio anterior para revisões. Ao devolver, **continua a conversa do agente existente** (`continue_run`, ADR 0044, quando a run é continuável; senão abre uma run nova semeada com o resumo da anterior). Os filhos que despacha têm a **identidade do agente configurado** (`agent_id` no vínculo da run, com o acesso daquele agente). Recebe o work item (ADR 0053) e produz um **plano de execução**, uma estrutura JSON validada por código (não texto livre):
```json
{"stages": [{"stage": "triage|spec|implement|review|verify|monitor", "action": "run|skip", "reason": "string",
             "assignments": [{"agent": "id", "model": "id", "harness": "id|null", "context": ["spec","origin","diff"], "maxTokens": 1000}]}]}
```
- **Caminho de execução (decisão explícita).** Existem dois caminhos hoje e a fábrica usa cada um onde ele serve: (a) **loop direto com broker** (`read`/`discover`/`exec`, presets ADR 0021, hooks 0026, worktree 0019): é onde Implement, Verify e Review-com-ferramentas rodam; (b) **motor de harness** (ADR 0045): o modelo não recebe ferramentas, então um agente com `harness:` só serve a papéis sem escrita (Triage, Spec, Review sobre diff já pronto, Monitor). O validador da definição **rejeita** `harness:` em agente com permissão de escrita/`exec`. Provedores por CLI (Claude Code, Codex) rodam o estágio inteiro no loop próprio deles, dentro do worktree e com o preset mais restritivo que o provedor permitir.
- **Divisão em subagentes**: `run_subagent` (ADR 0027: filhos sem ferramentas, só provider HTTP, limites `SUBAGENT_RULES`) serve para pensar em paralelo dentro de um turno. Para trabalho com ferramentas, o foreman abre **runs de estágio** separadas (cada uma com worktree próprio) vinculadas ao work item.
- **Modelo/harness/contexto por custo e qualidade**: a definição declara `tiers` (ex.: `fast`, `balanced`, `deep`) com modelos permitidos; o foreman escolhe o tier por estágio. Código **valida** o plano: o agente de Review com o **mesmo modelo e harness** do Implement do mesmo item (a revisão deve ter pontos cegos diferentes; `policy.reviewIndependence`, padrão `require`), modelo fora da lista permitida, `maxTokens` acima do teto da fábrica ou estágio obrigatório pulado → plano rejeitado e o foreman recebe o erro para corrigir (máx. 2 tentativas, depois `awaiting_human`). O foreman propõe; a fábrica dispõe.
- **Handle e conversa**: cada fábrica tem um handle único; a pessoa fala com `@handle` na sala de controle. Conversas ficam em `factory_conversations` (local, ADR 0058). O foreman responde com contexto do work item e das runs, nunca com credenciais.
- O foreman **não tem** ferramentas do broker nem de escrita/rede. Ele é **um turno de provider com saída estruturada** (o plano JSON acima, ou uma pergunta à pessoa); `delegate` e `ask_human` são ações do código da fábrica sobre esse resultado validado, não ferramentas expostas ao modelo.

### Memória por agente
Tabela `factory_memories {id, agent_id, text, origin ('human'|'agent'), source_run_id?, pinned, created_at, updated_at}`.
- **Local, editável e removível** pela pessoa na sala de controle.
- **Limites**: 50 notas por agente, 400 caracteres por nota e 20 KB no total (50 × 400 = 20 KB; os três limites são alcançáveis); acima disso a gravação é recusada com erro explícito (sem descarte silencioso).
- **Redação** de segredos em toda gravação (`redact_value`).
- Memória escrita por agente (`origin: agent`) aparece marcada para revisão e **nunca** é copiada automaticamente de texto externo não confiável (mitiga memory poisoning); entra na run como bloco "dado", nunca como instrução de sistema.

## Segurança
Texto de work item, issue, mensagem de chat e saída de ferramenta são dados não confiáveis para todos os agentes. Ferramentas passam pelo broker, pelos presets e pelo HITL existentes; agente que leu texto externo não ganha rede/push além da definição. A fábrica **nunca** dá a um agente merge nem push em branch protegida (ADR 0055).

## Escolhas conservadoras
Foreman e estágios usam o caminho de run existente (sem novo motor). Sem aprendizado automático de preferências neste corte (pacote C).
