# ADR 0059: Entrada da fábrica — contrato, porta e modelo de ameaça

Status: aceita. Pacote B da issue #244 (entrada e interface). Compartilha o contrato com o Pacote A (ADRs 0053–0058); mudanças no vocabulário são combinadas entre as sessões.

**Fontes dos conceitos.** Páginas públicas de Warp Factories em docs.warp.dev/factories (Connect your factory, integrações, Factory automations, Factory endpoints, Factory MCP for coding agents, Triggering automations with custom webhooks, Factory inbox). Só os **conceitos** foram aproveitados; nomes, formatos e textos são do OHarness. Fora de escopo: agentes em nuvem, execução hospedada, app web hospedado, créditos.

## Contexto
O trabalho chega à fábrica por muitos caminhos (GitHub e outros trackers, webhooks, agendas, um agente local via MCP, a CLI). Todos acabam no mesmo ponto: criar, consultar, comentar, cancelar, assumir e devolver um work item. Tudo é local ou self-hosted; nada fica exposto à internet sem opt-in explícito.

## Decisão
- **Porta fina.** O lado de entrada (`backend/factory_intake/`) só conhece `FactoryPort` (`port.py`): `submit`, `get`, `list`, `comment`, `cancel`, `claim`, `release`, `metrics`. A fundação (Pacote A) implementa a porta sobre o modelo do ADR 0053 num adaptador; até lá `memory.MemoryFactory` serve aos testes. O vocabulário é o do A: `status` ∈ `queued|running|awaiting_human|waiting_merge|claimed|parked|done|cancelled|failed`, `source = {kind, ref, url?, thread_ref?}`, `claim = {holder, worktree_ref}`. Mudou o vocabulário do A → muda o adaptador, não conectores, endpoints, MCP nem CLI.
- **Um pedido novo, um follow-up ou uma repetição** (`SubmitResult`, `pipeline.deliver`): a mesma `(source.kind, idempotency_key)` é repetição e não muda nada (entrega duplicada de webhook não duplica trabalho); uma chave nova sobre um item **ainda aberto** da mesma `(source.kind, source.ref)` é resposta no mesmo thread e vira **comentário** do item, não item novo; só um `ref` sem item aberto cria item. Um item fechado não bloqueia uma nova entrada.
- **O resultado volta ao thread de origem** (`SourceRef.thread_ref`, opaco): issue, PR, mensagem. Responder lá continua o mesmo item.
- **Gatilho explícito ou implícito.** Explícito: mensagem que menciona o handle da fábrica (`@alias`, o alias do `factory.yaml`, ADR 0056). Implícito: label configurado. Só conteúdo **novo** conta como menção: edição, citação (`>`) e código (inline ou em bloco) são ignorados. Bots não disparam trabalho por padrão (evita laço); `allowed_authors` restringe quem pode disparar (recomendado em repositório público).
- **Conector plugável** (`connector.py`): `verify`, `parse(delivery, rules) -> [WorkItemDraft]`, `reply(ref, text)`, `required_scopes()`. Um conector não executa comando, não lê repositório e não decide o que a fábrica pode fazer.
- **Classes de credencial.** Entrada e MCP usam a classe **agente/integração** do ADR 0055: podem criar, consultar, comentar, cancelar, assumir (`claim`) e devolver (`release`). Aprovar spec, responder pergunta, `confirm_merged` e ativar/reverter definição são **só da classe humana**: nenhum endpoint, ferramenta MCP ou comando da CLI de B os expõe. Não existe ação de merge.
- **Caixa de entrada.** O que precisa de decisão humana é `status = awaiting_human` (`list(state="awaiting_human")`); a UI da caixa de entrada é do Pacote A. B só a expõe como filtro.
- **Cofre.** Credenciais (token de API, segredo de webhook, tokens de cliente) vivem só no `SecretsStore`, sob `oharness/factory/<nome>`. Definições e config guardam a referência, nunca o valor; nada vai para log, erro ou resposta.

## Modelo de ameaça: todo texto de fora é dado não confiável
Título, corpo, comentário, label, nome de branch, mensagem de Slack, corpo de webhook: tudo pode ser injeção de prompt.
1. Nunca vira instrução privilegiada: entra como dado citado (`fence_untrusted`, com redação de segredos e cerca que não se fecha por dentro) e passa pelas permissões e pelos checkpoints humanos (ADR 0021, 0045). **O texto nunca dispara execução de comando fora da política.**
2. **Autenticidade** antes de qualquer parse: HMAC-SHA256 em tempo constante ou token do cofre; sem segredo configurado a entrada é recusada (503).
3. **Replay:** `ReplayGuard` limitado, com lock; tabela cheia recusa (503) em vez de despejar ids válidos.
4. **Taxa e tamanho:** `RateLimiter` por chave (nunca esquece uma chave limitada para abrir espaço) e `enforce_size` (256 KiB) antes do parse; campos do draft têm teto, e `clamp_draft` corta o que a fonte permite maior.
5. **Log:** `safe_for_log` — uma linha, curta, redigida; nunca o corpo cru.
6. **A fábrica nunca faz merge nem push em branch protegida.** Devolver um item assumido o leva a revisão humana (`needs_review`) ou o recoloca na fila (`abandoned`); nunca o conclui.
7. **Rede:** o receptor faz bind em `127.0.0.1` por padrão; outra interface exige flag explícita e segredo configurado (ADR 0061).

## Ordem de entrega
contrato (este) → GitHub (0060) → endpoints/webhook (0061) → automações (0062) → MCP (0063) → CLI e esqueletos dos demais conectores (0064).

## O que não foi verificado aqui
Ambiente de nuvem sem rede e sem tokens: nada foi testado contra GitHub ou outro serviço real; os testes usam fixtures de payload, `httpx.MockTransport` e `MemoryFactory`.
