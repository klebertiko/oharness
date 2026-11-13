# `oharness doctor` — relatório global (R-DX-01, #411)

Um relatório de versão, diretório de dados, banco, cofre de segredos, sidecar, sandbox e conexões. Só olha: não cria nada (nem o diretório de dados, nem o banco e suas tabelas, nem a pasta de segredos, nem `sidecar.token`), não lê o stdin, não testa provedor, não chama adaptador e não carrega o app. O banco é aberto em somente leitura e só se já existir; o cofre não é construído (só se confere se a pasta pode ser lida). Para detectar as CLIs instaladas (`<cli> --version` e o comando de status), o processo filho roda com o diretório do usuário (`Path.home()`) como diretório de trabalho: ele já existe, só o próprio usuário escreve nele (uma CLI lê hooks e regras do projeto a partir do cwd, então não pode ser a pasta temp compartilhada) e nada é criado ou removido, nem uma pasta temporária. Sai com 1 se alguma verificação falhar; `--json` segue `backend/oharness/schema/doctor.schema.json` (versionado, validado por testes).

| verificação | o que confere | falha (código fixo) |
|---|---|---|
| `dataDir` | o diretório de dados que o app e a CLI resolvem; ainda não existir é primeira execução, não falha | `invalid`, `not-a-folder`, `not-writable` |
| `database` | o banco de conexões, aberto só para leitura; ainda não existir é primeira execução, não falha | `cannot-open` (inclusive banco que não é sqlite) |
| `secretsStore` | a pasta do cofre pode ser lida (sem construir o cofre nem ler valores); ainda não existir é primeira execução | `cannot-open` |
| `sidecar` | sempre `skipped`: a CLI não conhece a porta nem o token de um sidecar em execução (verificação no app instalado: #388/#397). A versão do relatório vem de `backend/version.py`, a mesma do app | |
| `sandbox` | a tabela de modos de permissão carrega; informa o modo padrão, os modos e se há `git` | `cannot-load` |
| `connections` | as linhas de `providers.diagnostics.build_report` (as mesmas de `oharness providers doctor`), sem alteração; falha se uma conexão habilitada tem `failureClass` | |

Nunca aparecem: chave ou referência do cofre, e-mail da conta, texto de exceção, stderr de CLI, usuário local (o diretório do usuário vira `~`). Quando uma verificação falha, só o código fixo sai.
