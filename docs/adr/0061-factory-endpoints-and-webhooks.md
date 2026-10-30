# ADR 0061: Endpoints da fábrica e receptor de webhooks

Status: aceita (implementação no PR de endpoints). Conceitos de: docs.warp.dev/factories/factory-api (descobrir e despachar), /webhooks (modos de autenticação, contrato de entrega, log de entregas, filtro por payload); desenho próprio.

## Decisão
- **Receptor separado do sidecar.** `oharness factory serve` sobe um app FastAPI próprio (`factory_intake/server.py`) com **só** `/hooks/*` e `/api/*`. Assim, abrir uma porta para o GitHub (túnel do dono) não expõe as rotas do sidecar. Bind padrão `127.0.0.1`; outro `--host` exige `--allow-remote` e segredo configurado; a fábrica nunca abre túnel sozinha. O app acessa a fábrica pela `FactoryPort` (mesmo banco local do sidecar).
- **API de integração** (`/api/work-items` criar/listar, `/api/work-items/{id}` status, `/{id}/comments`, `/{id}/cancel`, `/{id}/claim`, `/{id}/release`, `/api/metrics`): autenticada por **token de cliente do cofre** (`Authorization: Bearer`), um por integração, com escopos (`work:write`, `work:read`, `work:claim`); sempre classe agente/integração (ADR 0059), nunca humana. O token do sidecar, que pode tudo, não é usado aqui. Erros com `code` estável.
- **Webhooks genéricos nomeados** (`/hooks/{name}`): cada webhook tem nome, modo de autenticação, referência de segredo no cofre e estado `enabled`; definidos em `webhooks/<nome>.yaml` na definição da fábrica (ADR 0056), sem segredo. Modos: `token` (bearer) e `signature` (HMAC-SHA256 do corpo, esquemas `github`, `generic` e Standard Webhooks, com janela de 5 minutos). **Não** oferecemos token na URL: a URL vaza para log de proxy e histórico.
- **Contrato de entrega:** só `POST`, JSON de até 256 KiB. `202 {"delivery_id"}` aceito; `401` autenticação; `400` JSON inválido; `404` webhook desconhecido, desligado ou apagado (indistinguíveis, sem enumeração); `413` grande demais; `429` com `Retry-After` acima de 60 entregas/min por webhook (falhas de autenticação têm orçamento próprio). Recusas respondem genérico, sem eco do conteúdo.
- **Log de entregas** local (SQLite): `accepted|duplicate|rejected_auth|rejected_json|rejected_size`, id, tamanho, hora; payload aceito guardado **redigido**; recusadas e duplicadas só metadados; mantém ao menos as últimas 50 e 7 dias. Duplicata = mesmo id de entrega (cabeçalho configurável) ou, sem ele, mesmo hash de corpo.
- **O payload é dado, não instrução.** Vira anexo do work item (`origin_context`, não confiável), com envelope que diz isso ao agente; o prompt da automação é do dono e nunca é concatenado com o payload.
- **Operação:** habilitar/desabilitar, girar segredo (o antigo morre na hora; rollover sem parada = segundo webhook), apagar; e **teste de filtro** que avalia um filtro de payload contra uma entrega guardada sem criar trabalho.
- GitHub entra por `/hooks/{name}` com o conector do ADR 0060 (`signature: github`).

## Não verificado
Exposição real por túnel/proxy e entrega real de um provedor; os testes exercem o app com `TestClient`.
