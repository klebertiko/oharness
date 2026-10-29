# ADR 0054 — Fábrica local: foreman, agentes e memória por agente

Status: proposta (issue #244, pacote A). Depende de 0053.

## Vocabulário
- **Agente da fábrica**: ator de longa duração da fábrica, definido em arquivo (ADR 0056). **Não** é o *Agent* de nó do harness (CONTEXT.md): um agente da fábrica **executa** um harness `.ohm` (ou o loop direto) em runs.
- **Foreman**: o agente coordenador de uma fábrica, com **handle** (`@payments`). Não é Nilo (Nilo é o assistente do Studio e não é papel de equipe).

## Decisão

### Agentes
Cada agente declara: `id`, `role` (`foreman`, `triage`, `spec`, `implement`, `review`, `verify`, `monitor` ou `custom`), `model` (provider+modelo), `harness` (id de harness salvo, opcional), `instructions`, `skills`, `mcp` (servidores permitidos), `permissions` (preset do ADR 0021 + limites), `tokenCeiling` (ADR 0025/0040), `memory` (limites) e `enabled`.
- **Padrão**: a fábrica traz as definições base de Triage, Spec, Implement, Review, Verify, Monitor. **Adoção parcial**: só `enabled: true` participam; o foreman só atribui estágios a agentes ligados e o resto do trabalho espera a pessoa (ex.: ligar só Triage).
- **Custom**: qualquer `id` novo com `role: custom` e gatilho opcional (usado pelo pacote B para automações).
- **Skills por agente**: referências a skills do repositório (`.oharness/factory/skills/<id>/SKILL.md`, ADR 0056). **MCPs por agente**: lista explícita de servidores; nenhum herdado implicitamente. **Permissões por agente**: o preset mais restritivo vale; um agente nunca ganha capacidade que a fábrica não declara.

### Foreman
Recebe o work item (ADR 0053) e produz um **plano de execução**, uma estrutura JSON validada por código (não texto livre):
```json
{"stages": [{"stage": "triage|spec|implement|review|verify|monitor", "action": "run|skip", "reason": "string",
             "assignments": [{"agent": "id", "model": "id", "harness": "id|null", "context": ["spec","origin","diff"], "maxTokens": 0}]}]}
```
- **Divisão em subagentes**: dentro de uma run usa o mecanismo existente (`run_subagent`, ADR 0027: filhos sem ferramentas, limites `SUBAGENT_RULES`); para trabalho com ferramentas, o foreman abre **runs de estágio** separadas (cada uma com worktree próprio, ADR 0019) vinculadas ao work item.
- **Modelo/harness/contexto por custo e qualidade**: a definição declara `tiers` (ex.: `fast`, `balanced`, `deep`) com modelos permitidos; o foreman escolhe o tier por estágio. Código **valida** o plano: modelo fora da lista permitida, `maxTokens` acima do teto da fábrica ou estágio obrigatório pulado → plano rejeitado e o foreman recebe o erro para corrigir (máx. 2 tentativas, depois `awaiting_human`). O foreman propõe; a fábrica dispõe.
- **Handle e conversa**: cada fábrica tem um handle único; a pessoa fala com `@handle` na sala de controle. Conversas ficam em `factory_conversations` (local, ADR 0058). O foreman responde com contexto do work item e das runs, nunca com credenciais.
- O foreman **não tem** ferramentas de escrita nem de rede: só `plan`, `delegate` e `ask_human`.

### Memória por agente
Tabela `factory_memories {id, agent_id, text, origin ('human'|'agent'), source_run_id?, pinned, created_at, updated_at}`.
- **Local, editável e removível** pela pessoa na sala de controle.
- **Limites**: 50 notas por agente, 2000 caracteres por nota, 20 KB por agente; acima disso a gravação é recusada com erro explícito (sem descarte silencioso).
- **Redação** de segredos em toda gravação (`redact_value`).
- Memória escrita por agente (`origin: agent`) aparece marcada para revisão e **nunca** é copiada automaticamente de texto externo não confiável (mitiga memory poisoning); entra na run como bloco "dado", nunca como instrução de sistema.

## Segurança
Texto de work item, issue, mensagem de chat e saída de ferramenta são dados não confiáveis para todos os agentes. Ferramentas passam pelo broker, pelos presets e pelo HITL existentes; agente que leu texto externo não ganha rede/push além da definição. A fábrica **nunca** dá a um agente merge nem push em branch protegida (ADR 0055).

## Escolhas conservadoras
Foreman e estágios usam o caminho de run existente (sem novo motor). Sem aprendizado automático de preferências neste corte (pacote C).
