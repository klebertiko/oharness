# ADR 0059: Entrada da fábrica — contrato, porta e modelo de ameaça

Status: aceita. Pacote B da issue #244 (entrada e interface). Depende do modelo de work item do Pacote A (ADRs 0053–0058).

## Contexto
O trabalho chega à fábrica por muitos caminhos (GitHub, webhooks, agendas, um agente local via MCP, a CLI). Todos acabam no mesmo ponto: criar, consultar, comentar, cancelar, assumir e devolver um work item. Tudo é local ou self-hosted; nada é exposto à internet sem opt-in explícito.

## Decisão
- **Porta fina.** O lado de entrada (`backend/factory_intake/`) só conhece `FactoryPort` (`port.py`): `submit`, `get`, `list`, `comment`, `cancel`, `claim`, `release`, `metrics`, com `WorkItemDraft` (entrada) e `WorkItemView` (saída). A fundação (Pacote A) implementa a porta sobre o modelo dela; até lá, `memory.MemoryFactory` serve aos testes. **Acoplamento documentado:** os nomes de estado (`queued|running|waiting_human|done|failed|cancelled|claimed`) e de fonte são os do B; se o A publicar vocabulário diferente, muda o adaptador, não os conectores, os endpoints, o MCP nem a CLI.
- **Idempotência.** `submit` com a mesma `(source.kind, idempotency_key)` (a chave é escopada pela fonte) devolve o item já criado (entrega repetida de webhook não duplica trabalho).
- **Conector plugável** (`connector.py`): `parse(delivery, rules) -> [WorkItemDraft]`, `reply(ref, text)`, `required_scopes()`. Um conector não executa comando, não lê repositório e não decide o que a fábrica pode fazer. Gatilho = menção explícita ao handle da fábrica ou label configurado como gatilho; `allowed_authors` restringe quem pode disparar (recomendado em repositório público).
- **Cofre.** Credenciais (token de API, segredo de webhook, token de endpoint) vivem só no cofre (`SecretsStore`) sob a referência opaca `oharness/factory/<nome>`. Definições e config guardam a referência, nunca o valor; nada disso vai para log, erro ou resposta.

## Modelo de ameaça: todo texto de fora é dado não confiável
Título, corpo, comentário, label, nome de branch, mensagem de Slack: tudo isso pode ser uma injeção de prompt.
1. Nunca vira instrução privilegiada: entra como dado citado (`fence_untrusted`, com redação de segredos e a cerca não fecha por dentro) e passa pelas permissões e pelos checkpoints humanos (ADR 0021, 0045). **O texto nunca dispara execução de comando fora da política.**
2. **Autenticidade:** HMAC-SHA256 em tempo constante (ou bearer do cofre) antes de qualquer parse; sem segredo configurado a entrada é recusada (503), não aceita.
3. **Replay:** `ReplayGuard` limitado em memória (id de entrega + janela de tempo); tabela cheia recusa (503) em vez de despejar ids válidos.
4. **Taxa e tamanho:** `RateLimiter` (balde de tokens por chave) e `enforce_size` (256 KiB por padrão) antes do parse; os campos do draft têm teto.
5. **Log:** `safe_for_log` — uma linha, curta, redigida; nunca o corpo cru.
6. **A fábrica nunca faz merge nem push em branch protegida**; devolver um item assumido o leva a revisão humana (`needs_review`) ou o recoloca na fila (`abandoned`); uma devolução nunca conclui o item nem faz merge.
7. **Rede:** receptores fazem bind em `127.0.0.1` por padrão; escutar em outra interface exige flag explícita e segredo configurado.

## Ordem de entrega
contrato (este) → GitHub (0060) → endpoints/webhook (0061) → automações (0062) → MCP (0063) → CLI e esqueletos dos demais conectores (0064).

## O que não foi verificado aqui
Sandbox de nuvem sem rede e sem tokens reais: nada foi testado contra GitHub ou outro serviço de verdade; os testes usam fixtures de payload e um `MemoryFactory`.
