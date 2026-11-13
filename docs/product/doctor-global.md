# `oharness doctor` — relatório global (R-DX-01, #411)

Um relatório de versão, diretório de dados, banco, cofre de segredos, sidecar, sandbox e conexões. Só olha: não cria nada, não testa provedor, não chama adaptador. Sai com 1 se alguma verificação falhar; `--json` segue `backend/oharness/schema/doctor.schema.json` (versionado, validado por testes).

| verificação | o que confere | falha (código fixo) |
|---|---|---|
| `dataDir` | o diretório de dados que o app e a CLI resolvem; ainda não existir é primeira execução, não falha | `invalid`, `not-a-folder`, `not-writable` |
| `database` | o banco de conexões abre (o mesmo caminho do sidecar) | `cannot-open` |
| `secretsStore` | o cofre de segredos monta; `skipped` se o banco não abriu | |
| `sidecar` | o app (FastAPI) do sidecar carrega e informa a versão | `cannot-load` |
| `sandbox` | a tabela de modos de permissão carrega; informa o modo padrão, os modos e se há `git` | `cannot-load` |
| `connections` | as linhas de `providers.diagnostics.build_report` (as mesmas de `oharness providers doctor`), sem alteração; falha se uma conexão habilitada tem `failureClass` | |

Nunca aparecem: chave ou referência do cofre, e-mail da conta, texto de exceção, stderr de CLI, usuário local (o diretório do usuário vira `~`). Quando uma verificação falha, só o código fixo sai.
