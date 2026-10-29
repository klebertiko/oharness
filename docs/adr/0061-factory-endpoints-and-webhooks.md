# ADR 0061: Endpoints da fábrica e receptor de webhooks

Status: aceita (implementação no PR de endpoints).

## Decisão
- **Endpoints** no sidecar (já em loopback e atrás do token do sidecar): `POST /factory/work`, `GET /factory/work`, `GET /factory/work/{id}`, `POST /factory/work/{id}/comment`, `POST /factory/work/{id}/cancel`, `GET /factory/metrics`. Além do token do sidecar, o cliente apresenta um **token da fábrica** guardado no cofre (`oharness/factory/endpoint-token`), comparado em tempo constante.
- **Webhooks de entrada** (`POST /factory/hooks/{source}`): autenticados por HMAC (segredo no cofre por fonte) e replay-guard; limite de corpo e de taxa antes do parse. Resposta sempre genérica em recusa (sem eco do conteúdo).
- **Rede:** bind padrão `127.0.0.1`. Expor para fora é opt-in explícito (`OH_FACTORY_BIND`) e exige segredo configurado; a documentação recomenda túnel/proxy autenticado do dono, e a fábrica não abre túnel sozinha.
- Erros têm `code` estável (`unauthorized`, `bad_signature`, `replay`, `rate_limited`, `too_large`, `not_found`...).
