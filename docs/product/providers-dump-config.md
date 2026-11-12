# Configuração efetiva — `oharness providers dump-config` (R-PRV-19, #410)

Mostra, para cada conexão e para o ambiente que localiza os dados, o valor efetivo e **de onde ele veio**. Só lê; sem rede, sem probe, sem chamar adaptador.

`--json` segue `backend/oharness/schema/providers-cli.schema.json` (`command: "dump-config"`). Cada campo é `{"value", "origin"}`:

| origin | significa |
|---|---|
| `default` | valor embutido: o endpoint padrão do catálogo, o diretório padrão da plataforma, os padrões que o sidecar empacotado preenche |
| `app` | a conexão que o app guardou no banco |
| `env` | o ambiente do processo (o do app ou do sidecar; o da CLI faz as vezes dele) |

- `environment`: `dataDir`, `secretsBackend`, `secretsDir` e `database`. O banco aparece só pelo tipo (`sqlite` ou `other`): uma URL pode carregar senha. Caminhos trocam o diretório do usuário por `~`.
- `connections[].fields`: `label`, `residence`, `enabled`, `endpoint`, `defaultModel`, `credentialKind` e `secretStored`. O endpoint não tem userinfo, query nem fragmento. A credencial é descrita (tipo, se há uma guardada), nunca mostrada.
- Só quatro variáveis são lidas (`OH_DATA_DIR`, `OH_SECRETS`, `OH_SECRETS_DIR`, `DATABASE_URL`). Nenhuma variável de credencial e nunca o ambiente do subprocesso de uma CLI (I5).
