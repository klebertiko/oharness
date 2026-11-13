# Configuração efetiva — `oharness providers dump-config` (R-PRV-19, #410)

Mostra, para cada conexão e para o ambiente que localiza os dados, o valor efetivo e **de onde ele veio**. Só lê; sem rede, sem probe, sem chamar adaptador. Usa o mesmo carregador somente leitura de `providers list` e `oharness doctor` (`backend/oharness/readonly.py`): o banco é aberto em somente leitura e só se já existir, o cofre não é construído, e um diretório de dados vazio (ou ausente) continua igual depois (#497, #494).

`--json` segue `backend/oharness/schema/providers-cli.schema.json` (`command: "dump-config"`). Cada campo é `{"value", "origin"}`:

| origin | significa |
|---|---|
| `default` | valor embutido: o endpoint padrão do catálogo, o diretório padrão da plataforma, os padrões que o sidecar empacotado preenche |
| `app` | a conexão que o app guardou no banco |
| `env` | o ambiente do processo (o do app ou do sidecar; o da CLI faz as vezes dele) |

- `environment`: `dataDir`, `secretsBackend`, `secretsDir` e `database`. `secretsBackend` sai de um vocabulário fixo: `memory`, `file`, `keychain` ou `unknown` (aceita os apelidos `mem` → `memory` e `keyring`/`os` → `keychain`, sem diferenciar maiúsculas; um texto que a CLI não reconhece vira `unknown` e nunca é repetido). Uma variável que não está definida vale o padrão do sidecar empacotado (`sidecar_entry.configure_environment`), calculado sem definir nada: cofre `file` em `<dados>/secrets` e banco `sqlite` em `<dados>/harness.db`. `OH_SECRETS` definida e vazia é `memory`, como no `secret_store.factory`. `secretsDir` é um rótulo: `default` (a pasta `<dados>/secrets` do app), `custom` (outra pasta) ou `null` com origem `default` quando o backend não é arquivo (um `OH_SECRETS_DIR` definido não se aplica); o caminho dela nunca é impresso. O banco aparece só pelo tipo (`sqlite` ou `other`): uma URL pode carregar senha. `dataDir` troca o diretório do usuário por `~`.
- `connections[].fields`: `label`, `residence`, `enabled`, `endpoint`, `defaultModel`, `credentialKind` e `secretStored`. O endpoint não tem userinfo, query nem fragmento. Um endpoint guardado que não seja uma URL http(s) sai `null` com origem `app` (no texto, `invalid`/`inválido`): o valor quebrado é do app e não se esconde atrás do padrão do catálogo. A credencial é descrita (tipo, se há uma guardada), nunca mostrada.
- Só quatro variáveis são lidas (`OH_DATA_DIR`, `OH_SECRETS`, `OH_SECRETS_DIR`, `DATABASE_URL`). Nenhuma variável de credencial e nunca o ambiente do subprocesso de uma CLI (I5).
- O texto segue o idioma como o `doctor` (`OHARNESS_LANG`, depois `LC_ALL`/`LANG`; `pt*` é pt-BR, o resto en): a origem sai traduzida (`padrão`, `app`, `ambiente`) e, sem conexões, uma linha diz isso. Os nomes dos campos são as chaves do JSON nos dois idiomas.
