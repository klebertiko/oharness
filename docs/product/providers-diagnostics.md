# Diagnóstico de Providers — `GET /providers/diagnostics` (R-PRV-07, #390)

Relatório estilo doctor, sem segredos, sem rede. Hoje só o endpoint HTTP o serve. Follow-up: ligar a tela e a CLI `oharness providers` a este JSON (ainda não existe; a CLI hoje lê direto o diretório de dados).

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
