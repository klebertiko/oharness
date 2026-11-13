# Diagnóstico de Providers — `GET /providers/diagnostics` (R-PRV-07, #390)

Relatório estilo doctor, sem segredos, sem rede. Duas portas, uma função (`providers.diagnostics.build_report`): o endpoint HTTP e `oharness providers doctor [--json]`, que lê as conexões do diretório de dados e acrescenta só `schemaVersion` e `command` (schema em `backend/oharness/schema/providers-cli.schema.json`). A CLI sai com 1 se uma conexão habilitada tem `failureClass`; conexão desabilitada não conta. Follow-up: ligar a tela a este JSON.

```json
{
  "app": {"version": "0.1.0", "os": "Windows"},
  "connections": [{
    "id": "anthropic", "provider": "anthropic", "label": "Claude", "enabled": true,
    "credentialKind": "cli | api-key | none",
    "credentialOrigin": "cli | vault | none",
    "state": "ready | not-logged-in | not-installed | unavailable | error | configured | no-credential | disabled",
    "failureClass": "cli-signin | cli-missing | cli-unavailable | cli-error | credential-missing | null",
    "endpoint": "https://host[:port]/path  (sem userinfo, query ou fragmento; \"\" se vazio)",
    "cli": {"id": "claude|codex|cursor", "version": "2.1.4 | null", "path": "~/bin/claude | null"}
  }]
}
```

- `cli` só existe para `credentialKind=cli`; senão `null`.
- `path` tem o diretório do usuário trocado por `~`.
- Nunca aparecem: chave do cofre, e-mail da conta do probe, stderr/stdout cru de CLI, usuário local.
- O estado de CLI vem das mesmas sondas só de status de `GET /providers/clis`; conexões por chave não fazem chamada de rede (testar a chave continua sendo o probe).

## Texto livre e endpoint

- `label` e `id` são digitados pelo usuário: no JSON saem como estão (o JSON escapa caracteres de controle); no texto da CLI saem só com caracteres imprimíveis e cortados em 80.
- O endpoint sai como `esquema://host[:porta]/caminho`, sem userinfo, query, fragmento nem `;params`, e vazio se tiver mais de 200 caracteres de caminho. Um token escrito no próprio caminho não tem como ser reconhecido: não cole chave em endpoint.
- A versão do relatório vem de `backend/version.py` (a mesma do app), sem carregar o app inteiro.
