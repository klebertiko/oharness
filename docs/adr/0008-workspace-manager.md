# ADR 0008 — Workspace Manager: worktrees Git gerenciados, selecionáveis e removíveis com confirmação

Status: Proposto (primeiro corte: backend + API, sem UI) · 2026-10-22 · Código: `backend/workspaces/`, `backend/routers/workspaces.py`

## Contexto
Hoje um "workspace" do OpenHarness é só o `rootPath` de um projeto Cowork (`routers/cowork.py`): uma string que o usuário digita. Nada cria, lista,
isola ou apaga diretórios. Para rodar agentes em paralelo no mesmo repositório sem pisar um no outro, o app precisa de um Git worktree por
trabalho, com ciclo de vida controlado: criar a partir de uma ref, listar com estado honesto, selecionar para execução, remover sem perder trabalho.

Esta feature **cria e apaga diretórios**. Foi tratada como superfície de ataque, não como conveniência.

## O que já existia (e como foi aproveitado)
| Peça | Achado | Uso aqui |
|---|---|---|
| `routers/cowork.py` | CRUD de `CoworkProject(root_path, ...)`; `root_path` é string livre, sem noção de git | Não alterado. Um workspace selecionado vira `cwd` registrando-se como projeto Cowork (passo explícito do cliente). |
| `routers/execution.py::_validated_project_cwd` | Único contrato de cwd: só aceita `cwd` **igual** ao `root_path` de um projeto Cowork existente e que ainda resolve para diretório | É o ponto de integração. Não foi tocado. |
| `routers/chat_tools.py`, `sandbox/broker.py`, `sandbox/permission.py` | Consomem o `cwd` validado; confiança de workspace (`is_workspace_trusted`) é por raiz, explícita e armazenada | Sem mudança: cada worktree é uma raiz nova e **não confiável** até o usuário confiar. Nada herda confiança do repositório de origem. |
| `engine.py` | Repassa `cwd` ao adapter; sem ideia de workspace | Sem mudança. |
| `sandbox/exec.py::run` | Runner de ferramentas aprovadas: junta stdout+stderr, redige segredos, trunca em 64 KiB | **Não serve** para este módulo (ver "Runner"). |
| `main.py::require_sidecar_token` | Middleware global: toda rota exceto `/health` exige `Authorization: Bearer <token>` | Herdado. O router novo não declara auth; teste cobre as 7 rotas com e sem token. |

Não existe contrato "workspace selecionado → execução". Portanto este corte expõe `GET /workspaces/selected` (com `cwd`) e **não altera a execução**.

## Decisão
### API (todas autenticadas pelo token do sidecar; erros `{"detail": {"code", "message"}}`)
| Rota | Função |
|---|---|
| `GET /workspaces?repo=` | lista: id, path, kind (`main`/`linked`), managed, branch ou detached, head, state (`clean`/`dirty`/`missing`/`unknown`), changes (modified/staged/untracked/conflicted), locked + motivo, prunable, missing, selected |
| `POST /workspaces {repo, ref, branch?}` | cria worktree a partir de branch/tag/commit; `branch` opcional cria branch nova, ausente = HEAD destacado |
| `GET/PUT/DELETE /workspaces/selected` | seleção persistida no servidor, **limitada ao worktree principal ou a um workspace gerenciado** (`403 workspace_not_selectable` para o resto); `GET` devolve `{selected, cwd, stale}` revalidado contra o git e contra essa mesma regra |
| `POST /workspaces/{id}/removal-check {repo}` | fase 1: relatório + `confirmation_token` |
| `POST /workspaces/{id}/remove {repo, confirmation_token, release_lock?}` | fase 2: remove (preservando trabalho pendente) |

O cliente informa o **repositório de origem** e a ref. **Nunca o destino**: corpos rejeitam campos desconhecidos (422) e o caminho é construído no servidor.

### Raiz gerenciada
`<dados do app>/workspaces/worktrees/<nome-do-repo>-<hash10>/<ws-id>`; dados do app = `%LOCALAPPDATA%\OpenHarness` (como o token do sidecar), sobrescrevível por
`OH_WORKSPACES_HOME` (testes). Fica **fora** de qualquer árvore de trabalho do repositório (evita repositório aninhado, issue #121/PR #122); criar é recusado se a raiz
estiver dentro de um worktree do repositório ou o repositório estiver dentro da raiz. `ws-id` = `ws-` + 16 hex gerados; colisão tenta de novo (5x) e depois 409.

### Estado
Arquivo JSON `state.json` (registro dos worktrees gerenciados + seleção), escrita atômica (tmp + `os.replace` + fsync), lock em processo, arquivo corrompido é posto de lado (`.corrupt-*`) em vez de sobrescrito.
**Não** é tabela do ORM: o esquema do ORM está sendo alterado por outras entregas, e este estado é pequeno e reconstruível.
- **Reconstrução:** o `git worktree list` é a fonte da verdade do que existe. Um worktree que o git lista em `<raiz>/<nome-do-repo>-<hash10>/<ws-id>` (repo-dir e hash10 do **próprio** repositório, id no formato gerado, nenhum link no caminho) é *adotado* como gerenciado mesmo sem registro. Apagar ou corromper o `state.json` não deixa mais worktrees "estranhos" nem trava as criações seguintes. **O que se perde:** a seleção, `created_at`, `base_ref` e `base_commit` (voltam como nulos).
- **Registro malformado:** cada registro é validado individualmente (id gerado igual à chave, `path` absoluto, extras texto-ou-nulo); o inválido, a seleção inválida e um grupo de tipo errado saem da visão e vão para `quarantine` (até 50) para inspeção, sem derrubar a listagem.

### Runner de git (um único ponto de spawn)
Timeout: o processo entra num *job object* (`sandbox/process_tree.py`, reaproveitado; nenhum `taskkill` novo) e, fora do Windows, num grupo de processos próprio; ao estourar o prazo a **árvore inteira** é encerrada e a chamada devolve `504 git_timeout` no prazo (antes: 20 s com limite de 3 s, porque o neto segurava o pipe). Toda chamada que lê worktree, índice ou status (inclusive `worktree add`, o `ls-files` da inspeção e o rollback do create, que roda `worktree remove`) neutraliza filtros, hooks e fsmonitor; o conjunto de drivers zerados é a configuração do repositório mais, quando o chamador passa `filter_dirs`, a de cada outro worktree que o git vá ler (`config.worktree` incluído); o único chamador de produção é o rollback do create, e o mecanismo é exercido por um teste com `git worktree remove` sem `--force`, com controle positivo e mutação (apagar o laço torna o teste vermelho); um teste de auditoria falha se uma chamada nova que leia a árvore esquecer `filters=True`.
`workspaces/gitrun.py`. `sandbox.exec.run` foi avaliado e descartado: truncar em 64 KiB, redigir e misturar stderr corromperia a saída NUL-separada
que é parseada e *hasheada* para amarrar a confirmação de remoção. O helper devolve bytes exatos e mantém stderr separado. Por chamada: argv em lista, sem shell,
git por caminho absoluto, ambiente reconstruído da allowlist do sidecar (`scrub_env` + remoção de todo `GIT_*`), `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<null>`, `GIT_TERMINAL_PROMPT=0`, timeout, stdin fechado.
**Achado do OpenGrep:** `dangerous-subprocess-use-audit` neste call site (a regra acusa qualquer argv não literal). Este `Popen` carrega o **único** `# nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit` do módulo `workspaces/`, autorizado explicitamente pelo mantenedor (2026-10-24) depois de duas revisões de SEC; o comentário no código resume os controles acima. Nenhuma outra regra é suprimida: os achados `regex_dos` de `scrub_paths` foram corrigidos no código (abaixo), não suprimidos.

### Criar
1. `validate_ref` (rejeita início `-`, controles, espaço, `..`, `@{`, `~^:?*[\`, `//`, `.lock`, >255) → `git check-ref-format --allow-onelevel` → `git rev-parse --verify --end-of-options <ref>^{commit}`.
2. Branch nova: allowlist (letras/dígitos Unicode, `_ . - /`), `check-ref-format refs/heads/<n>`; já existente → 409.
3. Lock por repositório; destino construído e provado; `git worktree add [-b n | --detach] --quiet -- <dest> <sha>` (recebe o **sha resolvido**, não o texto do cliente).
4. Registro atômico. Qualquer falha em 3–4 desfaz tudo: `git worktree remove --force`, `update-ref -d` da branch criada (só se ainda aponta para o commit base), `rmdir` do diretório pai se foi criado agora, sem metadado órfão.

### Remover (duas fases)
**Fase 1** devolve: contagens (modified/staged/untracked/conflicted), primeiros 100 caminhos, entradas ignoradas, commits que só existem aqui (alcançáveis do HEAD e de nenhuma outra branch, ref remota ou tag; `has_upstream`), lock + motivo, `will_preserve`, nome planejado da ref de resgate e um token.
O token é `expiração.HMAC-SHA256(chave do processo, expiração | repo | id | impressão do estado)`; a impressão cobre HEAD, branch, lock, hash do `status --porcelain=v2 -z` completo, `(tamanho, mtime_ns)` de cada caminho alterado, contagem de ignorados e commits exclusivos. Mudou algo → 409 `confirmation_invalid` (`stale`); passou de 10 min → `expired`; forjado/mal formado → `malformed`. A chave vive só na memória: reiniciar o sidecar invalida confirmações pendentes (direção segura).
**Fase 2** só com token válido. Nunca remove: o worktree principal (403), um que o gerenciador não criou ou que está fora da raiz gerenciada ou com link no caminho (403/409), um com submódulo inicializado ou repositório aninhado não rastreado (403: o resgate não carrega histórico/edições deles), um *locked* sem `release_lock` explícito (409).
**Links (junction/symlink).** `git worktree remove` segue um link que encontre dentro do worktree e apaga o conteúdo do alvo, e `git add --all` embute os arquivos do alvo no resgate. Por isso, antes de qualquer outra leitura, o worktree **inteiro** (ignorados e ocultos incluídos, em qualquer profundidade) é varrido sem seguir links (symlink, junction/mount point e qualquer ponto de reanálise de diretório; um diretório ilegível falha fechado). O relatório de `removal-check` lista `links` (nome e alvo) e eles entram na impressão do estado do token (link novo ou reapontado invalida a confirmação). No resgate eles são **excluídos** (`add --all` com pathspec `:(exclude,literal)<caminho>`) e nome → alvo vai na mensagem dos commits de resgate; a verificação recusa o resgate se algo atrás de um link entrou. Só depois do resgate verificado cada link é desfeito **como link** (`rmdir` de junction/link de diretório no Windows, `unlink` nos demais, conferindo por `lstat` que ainda é link e que o pai não virou link) e então o worktree e o diretório administrativo são apagados pelo próprio gerenciador (`remove_tree`, ver "Exclusão"). Se a exclusão falhar depois disso, os links já foram desfeitos (ficam no relatório e no resgate).
**Diretório administrativo.** O `git worktree remove` também apaga recursivamente `<repo>/.git/worktrees/<nome>/`, e um processo dentro do workspace o alcança pelo arquivo `.git`; uma junction ali apagaria o alvo. Esse diretório é achado **pelo lado do repositório** (o único `<common>/worktrees/*` cujo arquivo `gitdir` aponta para este worktree; zero ou mais de um candidato falha fechado, e o `.git` do worktree, que o processo pode reescrever, nunca é consultado), varrido com o mesmo `scan_tree`, e seus links entram em `admin_links` (relatório e resposta da remoção) e na impressão do token (link novo ou reapontado invalida a confirmação). São desfeitos como links, junto com os do worktree, antes da exclusão. Vale também para worktree cuja pasta sumiu (`missing`).
**Última varredura.** Depois de desfazer os links (e de soltar o lock), o worktree e o diretório administrativo são varridos de novo; qualquer link novo aborta a remoção (409 `unsafe_destination`, o lock é refeito e nada é removido).
**Exclusão (rodada 3).** O gerenciador **não chama mais `git worktree remove`** neste caminho: ele percorria as duas árvores no seu próprio ritmo e seguia um link plantado depois da última varredura (medido contra um plantador que alterna uma junction a cada 0,5-20 ms: dados externos perdidos em 6 de 60 tentativas no worktree e 5 de 60 no diretório administrativo; "microssegundos" estava errado). Agora `remove_tree` (`links.py`) apaga o worktree e depois `<common>/worktrees/<id>/` de baixo para cima: cada entrada é relida com `lstat` quando o laço chega nela, um link é desfeito como link e só se desce em diretório real; o diretório é conferido de novo depois de listado e antes de apagar algo dentro. Apagar o diretório administrativo é o que faz o git esquecer o worktree (o diretório é reconfirmado pelo lado do repositório logo antes); não se usa `git worktree prune`, que descartaria entradas obsoletas de outros worktrees. Se um arquivo preso (aberto no Windows) impedir a exclusão, o diretório administrativo é apagado mesmo assim, como o git fazia, e o que sobra é um workspace `orphaned` concluído pelas mesmas duas fases. Com isso o filtro definido só no `config.worktree` do alvo também deixa de importar para a remoção: nenhum `git status` interno roda mais. **Medição:** o mesmo plantador, 150 tentativas por local (worktree e diretório administrativo, limpo e sujo alternados), 300 no total: 0 perdas de dados externos (`tests/workspace_manager/test_workspaces_race.py`, 24 tentativas por padrão, `OH_RACE_TRIALS` para mais). Resta uma janela que o teste não alcançou: entre a releitura do diretório e o `unlink` dos nomes listados dentro dele, trocar esse diretório por um link que contenha arquivos de mesmo nome apagaria esses arquivos. Exige trocar um diretório não vazio por um link num intervalo muito curto; não foi observada em 300 tentativas, e só se fecha com chamadas relativas a descritor de diretório (`dir_fd`, indisponíveis no Windows).

Com trabalho pendente (sujo **ou** commits exclusivos), antes de qualquer remoção cria `refs/openharness/rescue/<id>` (sufixo `-n` se existir; nunca sobrescreve):
- cópia do índice do usuário (o índice real nunca é escrito) → `write-tree` → commit "snapshot do índice" (pai = HEAD) se diferir do HEAD;
- outra cópia → `add --all` (inclui modificados, staged e untracked; respeita `.gitignore`), com `core.autocrlf=false` e atributos tirados da árvore vazia (`GIT_ATTR_SOURCE`) para guardar os **bytes do disco** → commit "work tree";
- verificação relida do git: ref aponta para o commit e todo arquivo alterado ainda presente no disco está na árvore **com os mesmos bytes** (oid do blob no resgate igual a `git hash-object --no-filters` do arquivo no disco, em lote); staged-e-apagado é conferido no snapshot do índice; nada que esteja atrás de um link pode estar no resgate. Falhou → apaga a ref, **recusa a remoção** (409 `preservation_failed`), nada é removido;
- só então a exclusão (abaixo). Se a impressão do estado mudou durante o resgate → aborta (409 stale).
Limpo e sem commits exclusivos remove direto (ainda desfazendo links antes). Ref curta ambígua entre tag e branch (ou remote-tracking) no `create` devolve `409 ambiguous_ref`; refs totalmente qualificadas continuam aceitas.
**Workspace `orphaned`** (registro no store + diretório sob a raiz gerenciada, exatamente no caminho esperado, + sem entrada no git): é o que sobra de uma remoção que parou no meio (ex.: arquivo aberto no Windows; o gerenciador apaga o diretório administrativo e quase tudo, e falha com `remove_failed`). Aparece na listagem com `state: "orphaned"` e se conclui com as **mesmas duas fases**: `removal-check` lista o que restou (primeiros 100 caminhos, links, refs de resgate que já existem) e dá o token (impressão = hash de nome, tipo, tamanho e mtime de tudo o que restou); `remove` desfaz os links como links e apaga o resto de baixo para cima, **sem seguir links e restrito ao diretório gerenciado**. Um registro cujo caminho não é o esperado nunca é oferecido. Não pode ser selecionado. A branch **não** é apagada (`branch_kept`).

## Ameaças e mitigações (STRIDE resumido)
| Ameaça | Mitigação |
|---|---|
| Injeção de opção via ref/branch (`--upload-pack=…`, `-x`, `--force`) | pré-filtro sintático + `check-ref-format` + `--end-of-options`/`--` + o sha resolvido é o que chega ao `worktree add` |
| Metacaracteres de shell (`;`, `$()`, crases, Unicode) | argv sem shell; branch nova por allowlist; ref só é lida |
| Cliente escolhe destino / path traversal / Windows (CON, NUL…, `:`, `..`, UNC, `\\?\`) | destino 100% server-side; `ws-id` regex rígida; nome do repo sanitizado + hash; componentes validados; limite de 220 chars |
| Symlink/junction trocando o destino ou o ancestral | recusa se há link entre raiz e destino (`islink`+`isjunction`) na criação e na remoção; `realpath` deve cair sob a raiz; checagem refeita após o `mkdir` |
| Link **dentro** do worktree (junction não rastreada, `node_modules\linked` ignorado, aninhado) ou do seu **diretório administrativo** (`.git/worktrees/<id>/`) apontando para fora | varredura completa sem seguir links dos dois diretórios; resgate exclui; links desfeitos como links só após resgate verificado; nova varredura logo antes da exclusão pelo gerenciador (link novo aborta); testes afirmam o alvo externo intacto e nenhum arquivo externo na árvore do resgate |
| Seleção de worktree fabricado por repositório hostil (`.git/worktrees/x/gitdir`) devolvendo `cwd` arbitrário | só principal ou gerenciado; revalidado em `GET /workspaces/selected` (`stale: workspace_not_selectable`) |
| Repositório aninhado (#121) | raiz fora de qualquer worktree do repositório, nos dois sentidos |
| Execução de código do repositório hostil (hooks, filtros `clean/smudge/process`, fsmonitor, `diff.external`, assinatura em log) | `core.hooksPath` → diretório vazio garantido; `core.fsmonitor=false`; cada `filter.<n>.{clean,smudge,process}` do config do repo **e do `config.worktree` de cada worktree que o git vá ler** (`extensions.worktreeConfig`) é zerado por `-c`, **inclusive o driver de nome vazio** (`[filter ""]` com `.gitattributes` `filter=`). As chaves são lidas como **bytes**: nome que não é UTF-8 estrito (`ÿ`, latin1, overlong, surrogate codificado), contém `=` ou controle → recusa `409 unsafe_repository`, fail closed (antes o nome era decodificado com `replace` e o `-c` zerava um driver que o git não tem); `protocol.allow=never`, `GIT_NO_LAZY_FETCH` |
| Config global/de sistema do usuário alterando o comportamento | desligados por ambiente |
| Perda de trabalho ao remover | duas fases, token ligado ao estado, resgate verificado antes da remoção, exclusão própria e link-safe (`remove_tree`), depois do resgate verificado |
| Remover o que não é nosso | bloqueios: principal, não gerenciado, fora da raiz, link, locked, submódulo/aninhado |
| Corrida entre duas operações | lock por repositório (em processo); `branch_exists` verificado sob lock; testes de concorrência |
| Sidecar acessível por outro processo local | token do sidecar herdado do middleware, sem exceção por rota |

## Limitações conhecidas (documentadas, não escondidas)
- **Arquivos ignorados (`.gitignore`) não entram no resgate** e `git worktree remove` os apaga (`node_modules`, `.env`…). O relatório traz `ignored_entries`; a UI deve avisar.
- Filtros externos de **repositório** são neutralizados: um repositório que depende de filtro (ex.: Git LFS) faz checkout do *ponteiro*, não do conteúdo, dentro do worktree gerenciado. Preferimos isso a executar código do repo.
- O que **não** dá para neutralizar: git continua lendo o `.git` do repositório de origem (objetos, `config`, `info/attributes`, `commondir`); um repositório de um dono diferente cai no `safe.directory` do próprio git (erro `not_a_repository`). Drivers `diff`/`merge` não são usados por nenhuma operação daqui.
- Dois sidecars concorrentes sobre os mesmos dados não compartilham o lock em processo (o git ainda serializa pelo próprio `index.lock`). O sidecar é um processo por usuário.
- Janela TOCTOU residual entre provar o destino e o `git worktree add`, para quem já tem escrita no diretório de dados do app. Entre o resgate e a exclusão ela é coberta pela releitura da impressão do estado, pela última varredura e pelo `remove_tree` link-safe (ver "Exclusão"); resta só a troca de um diretório por um link entre a releitura dele e o `unlink` dos seus filhos (0 em 300 tentativas).
- O `.git` do worktree é reescrevível por quem roda dentro dele: a inspeção (`git status` com cwd no worktree) lê o repositório para onde ele apontar. Os filtros desse repositório também são neutralizados (cada chamada soma as configurações que vai ler), mas um `.git` redirecionado para um repositório de terceiros continua sendo lido pelo git.
- Status/contagens na listagem usam `--untracked-files=normal` (diretórios inteiros contam como uma entrada); a remoção usa `all`. Mudanças *dentro* de submódulos não aparecem como sujeira (`--ignore-submodules=dirty`), por isso submódulo inicializado bloqueia a remoção.
- **Janela entre ler a configuração e rodar o git** (`gitrun.py`, `_filter_neutralisers` e depois `_execute`): os drivers a zerar são lidos com `git config --list` e só então o comando roda; quem altera o `config.worktree` do repositório entre as duas chamadas faz o filtro novo rodar. Medido pelo SEC com um plantador alternando o `config.worktree`: o filtro rodou em 21 de 60 chamadas. No modelo atual não há ganho de privilégio (quem escreve ali já é o mesmo usuário do sidecar e já executaria código direto); fica no backlog (issue #154, item 2).
- Janela residual no timeout: o git entra no job logo após o spawn; um descendente criado nesses milissegundos fica fora do job (fora do Windows, o grupo de processos cobre).
- Repositórios em UNC e bare não são aceitos. Git < 2.36 (`worktree list -z`) não é suportado.
- Em Windows um hook só dispara se o arquivo for executável para o git; o teste de hook é decisivo no CI Linux, e o de filtro vale em todo SO.

## Limitações e backlog (achados do SEC **não** implementados neste corte)
- Sem checagem de versão do git no start (o mínimo, 2.36, é só documentado; versão antiga falha em `worktree list -z`).
- O limite de saída de 64 MiB é conferido **depois** de bufferizar a saída do git.
- Homóglifos/Unicode confundível em nome de branch nova (a allowlist aceita letras de qualquer escrita).
- `state.json` acumula grupos vazios de repositórios que já não têm workspaces.
- O `stderr` do git em `detail` das respostas de erro (limitado a 300 caracteres) passa por `scrub_paths`, que troca caminhos absolutos por `<path>` (entre aspas, ou sem aspas com espaços simples dentro de um componente, como `C:\Program Files\My App\ws`); refs entre aspas (`'feature/x'`) ficam legíveis. Os caminhos com letra de unidade e os POSIX são percorridos por um scanner linear (corridas de caracteres de componente, sem quantificadores aninhados), no lugar das duas regex que o OpenGrep acusava como `regex_dos`; contra as regex anteriores, 450 mil strings aleatórias deram saídas idênticas, e `test_workspaces_scrub.py` fixa os casos de borda e limita o tempo (menos de 0,5 s) em entradas hostis de 100 mil caracteres. Um caminho sem aspas com dois espaços seguidos, ou com espaço antes de um separador, ainda pode vazar o trecho final.
- Orphan com arquivo ainda preso (aberto): a limpeza falha com `remove_failed` e pode ser repetida; o gerenciador não força handles.

## Integração futura (NÃO feita aqui)
- **Execução:** quando houver contrato "workspace selecionado → run", ele deve consumir `GET /workspaces/selected.cwd` do servidor (e não um caminho do cliente), registrando o worktree como raiz Cowork de forma explícita e preservando o `workspace_trusted` por raiz (um worktree novo começa não confiável).
- **Run Record durável:** associar `workspace_id` + commit base/HEAD ao run, lease por run (impedir remoção de workspace em uso) e política de limpeza. Fica para depois da entrega do Run Record (sessão paralela); nada neste módulo toca `models.py`, `database.py` ou `routers/execution.py`.

## Alternativas rejeitadas
- *Cliente fornece o caminho de destino*: reabre traversal/aninhamento; custo zero para evitar.
- *Tabela nova no ORM*: conflita com a persistência em andamento e é desnecessária para estado pequeno e reconstruível.
- *Reutilizar `sandbox.exec.run`*: ver "Runner de git".
- *`git stash` como resgate*: ignora untracked por padrão e mexe no índice/árvore do usuário; o resgate por plumbing com índice de rascunho não toca em nada.
- *`worktree remove --force` direto*: é exatamente o caminho de perda de dados que as duas fases existem para impedir.
- *Deixar o `git worktree remove` apagar a árvore depois da última varredura*: rejeitado na rodada 3 (6/60 e 5/60 perdas medidas); a exclusão é própria e link-safe.
