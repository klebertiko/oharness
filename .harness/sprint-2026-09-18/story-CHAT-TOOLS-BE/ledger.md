# CHAT-TOOLS-BE — Codex

## START 2026-09-18

Contrato v1.0, threat-model e 3 features lidos; owner Claude. Propostas de compatibilidade/segurança em ../story-CHAT-TOOLS-CONTRACT/contract-proposals.md aguardam resposta, principalmente call_id da aprovação. Não alterar contrato unilateralmente.

### Seams / ordem
- AC#2: sandbox.paths.resolve_in_root(root, requested), fixtures reais de arquivos e symlinks/junctions; API read via pytest-bdd da feature sandbox-read.
- AC#7: sandbox.secrets, negação antes de ler + redação antes de responder/modelo/persistir.
- AC#1: discover/capabilities via API, fixtures reais; aguarda esclarecimento de capacidades de preset CLI.
- AC#3/4: processo real temporário via broker/control; gate aguarda call_id publicado no contrato; não abrir endpoint exec.
- AC#5: fronteira HTTP local scripted provider; loop real e SSE via HTTP isolado.
- AC#6/8: testes CLI e propagação cwd existentes mais regressões.

BDD, regressão, mutation e E2E são camadas separadas. Nenhuma aprovação independente alegada; gates pós-reset. Trabalho começa nas fatias independentes de paths/read; exec/loop ainda não implementados.

## AC#2 paths — RED
pytest -q -p no:cacheprovider tests/test_sandbox_paths.py → ModuleNotFoundError sandbox; 1 error in 0.39s. Cenários de resolução canônica, traversal/UNC/device/ADS, links relativos/absolutos e junction real do Windows.

## AC#2 paths — GREEN
Primeira tentativa teve erro de fixture mklink (quoting subprocess), corrigido usando _winapi.CreateJunction em path temporário. Resultado: 10 passed, 4 skipped in 0.13s. Quatro symlinks reais sem privilégio Windows: cobertura pendente em ambiente habilitado; junction real passou.
## AC#7 segredos — RED/GREEN
RED test_sandbox_secrets.py: ModuleNotFoundError sandbox.secrets, 1 error in 0.36s.
GREEN paths+secrets: 38 passed, 4 skipped in 0.15s. Denylist case-insensitive, store configurado e redação de 8 formatos, preservando texto normal. Não é sandbox OS nem revisão SEC independente.

## API read / BDD contrato
Feature chat-tools-sandbox.feature copiada sem alterar cenários (11). Primeiro cenário RED 404: 1 failed in 1.50s. Suite dos cenários read: 8 failed, 1 passed, 2 skipped in 2.76s (401 já protegido pelo middleware). GREEN API read + paths/secrets + sidecar auth: 53 passed, 6 skipped in 1.52s. Skips somente privilégios de symlink; junction real coberta em unit.
Implementação: routers/chat_tools.py, sandbox/read.py, main.py registra router. Raiz vem exclusivamente de _validated_project_cwd; conteúdo limitado, tipos binários negados, redação após leitura; não existe endpoint exec.

## Contrato v1.1 / discovery / aprovação / processo
Propostas 6/6 aceitas; bloqueio contrato resolvido. Read strict/400: RED 8 failed in 1.48s -> GREEN 18 passed, 2 skipped in 1.60s.
Discovery/capabilities API: RED 404 (1 failed in 1.46s) -> GREEN combinado read 26 passed, 2 skipped in 2.16s. Metadados .claude/.agents/.codex, scripts, limites, root registrado, sem conteúdo completo.
Gate call_id e processo: RED missing modules (2 collection errors in 0.47s). Primeira execução marcou async incorretamente (pytest-asyncio ausente); corrigido para plugin anyio existente. GREEN real 11 passed in 1.00s. Aprovação única, timeout, argv/cwd/env, saída/segredos, timeout e risk labels; ainda falta integração broker/control e E2E.

## Integração broker/HTTP e regressão
Preset RED instruction vazia 400 (1 failed in 1.29s) -> 32 passed in 2.83s junto à regressão de resolução.
Loop RED uma chamada sem tools (1 failed in 0.82s) -> GREEN 15 passed in 1.41s com presets. HTTP real via adapter/MockTransport: fragments por index, retorno role tool delimitado, usage acumulado, orçamento de 8, fallback completo e 401 sem fallback.
E2E isolado :8001: 6 passed in 19.56s; ampliado para filho+neto e histórico reforçado: 9 passed in 30.98s. Timeout/stop/disconnect verificam processos terminados, aprovação call_id, rejeição sem execução, log redigido, preset-only sem verificação/tokens falsos e model read.
Regressão checkout: 494 passed, 15 skipped in 38.76s. Skips: 9 E2E reservados ao isolado, 6 symlinks sem privilégio.
BDD menu backend: 3 passed in 1.58s, cenários originais do contrato sem alterações; FE scenarios ficam com Claude.
Três regressões novas RED: root ausente no contexto do modelo; mesmo root registrado com dois nomes levantava MultipleResultsFound; backend OH_SECRETS case/whitespace não casava factory. GREEN 42 passed in 1.70s após normalização e lookup first.
Mutation paths/secrets R1 isolada: 68 killed / 15 survived (83 total), abaixo da meta 90%; assertions de marcador/tipo/UNC/ADS/nested .git/config reforçadas, R2 em andamento. Nenhum gate independente alegado.

## BDD e mutação R2 do núcleo
Exec BDD via SSE real: 15 passed in 50.45s. Cenários copiados do contrato. CLI lock BDD separado em seam runner externo: 1 passed in 0.98s, --tools vazio, --strict-mcp-config, stdin e cwd; nenhum CLI real chamado nesse teste.
Paths/secrets mutmut R2 (isolado, consultado após terminar): paths 26 killed/1 survived=96,30%; secrets 55 killed/2 survived=96,49%. Ambos acima de 90%. Sobreviventes paths ID11, secrets54/85; não descartados do denominador. Cache preservado no worktree audit; próxima rodada mede arquivos restantes.
API control e broker: 11 passed in 1.02s, decisões inválidas/pré-aprovação/replay, stop sem aprovação, secret read aprovar/rejeitar, contenção cwd, redação recursiva.
Novo teste de ciclo de vida encontrou timeout real: processo pai já terminado deixava neto segurando pipes por 3s (RED 1 failed in 3.53s). sandbox/process_tree.py usa Windows Job Object de ciclo de vida (não sandbox de filesystem/rede), job attach após spawn; encerramento mata descendentes mesmo sem pai vivo. GREEN 9 passed in 1.23s. POSIX mantém grupo de processos. Requer revisão SEC independente; não alegar resistência a processos hostis/privilegiados nem eliminar a janela entre spawn e attach.

## Validação consolidada antes do mutation restante
BDD do contrato executável: 11 cenários sandbox-read (2 skips por privilégio de symlink), 3 cenários discovery da feature menu, 20 cenários exec (19 HTTP/SSE/processos reais em isolado; 1 CLI no runner externo controlado). Features originais copiadas sem mudar AC.
E2E completo: 28 passed in 96.01s (19 BDD exec + 6 broker adicionais + 3 histórico). Windows Job corrigido passou junto com timeout/stop/desconexão e observação de filho+neto.
Regressão completa após alterações: 522 passed, 34 skipped in 44.18s; 28 E2E rodam só isolados (passaram acima), 6 cenários symlink sem privilégio no host (junction real coberta). git diff --check -- backend sem erros de whitespace; avisos CRLF preexistentes.
Contratos de control testados: 409 preapproval/mismatch/replay, decisão inválida 400, stop libera sem aprovar. Fonte dos tools requests permanece root validado de projeto registrado. Nenhum argv de CLI foi liberado/modificado nesta story.
Backend pronto para integração FE em cópia isolada; porta 8001 livre após tests. Processo 8000 não foi reiniciado. Story permanece In Progress até mutation dos arquivos restantes e depois QA/ARCH/SEC independentes (restrição até reset).

## Mutation final — 2026-09-22

Caches isolados foram consultados diretamente por status; `survived` e `suspicious` permanecem no
denominador. Resultado por módulo da story:

| Módulo | Mortos / decididos | Score |
|---|---:|---:|
| `paths.py` | 26/27 | 96,30% |
| `secrets.py` | 55/57 | 96,49% |
| `approval.py` | 26/28 | 92,86% |
| `exec.py` | 99/127 | 77,95% |
| `process_tree.py` | 31/34 | 91,18% |
| `read.py` | 44/48 | 91,67% |
| `capabilities.py` | 58/58 | 100% |
| `discover.py` | 115/146 | 78,77% |
| `schemas.py` | 88/104 | 84,62% |
| `routers/chat_tools.py` | 45/60 | 75,00% |
| `broker.py` | 275/330 | 83,33% |

`process_tree.py` tinha 13 mutantes equivalentes que apenas renomeavam campos reservados de
estruturas `ctypes`, sem alterar ordem, tamanho ou ABI. As linhas receberam `pragma: no mutate` com
justificativa no código; o denominador final contém todos os mutantes comportamentais. Um teste novo
trava os argumentos exatos de `OpenProcess`, attach, terminate e close. `schemas.py` ganhou uma
asserção integral do contrato publicado. Testes direcionados após as mudanças: **52 passed in
2.61s**. Caches finais:
`D:\Development\.worktrees\oharness-mutation-final-20260922\{process,schemas}\.mutmut-cache`.

Regressão backend final após os testes de mutation: **607 passed, 34 skipped in 44.18s**. Os 34
skips continuam sendo 28 E2E reservados à cópia isolada e 6 symlinks sem privilégio; os 28 E2E
passaram na execução isolada registrada acima.

## 2026-09-24 — Correção de SEC gate (Claude, autorizado pelo HITL — Codex indisponível)

SEC fresh-context (`gates/sec-2026-09-24.md`) achou dois P2 reais em `sandbox/secrets.py`, ambos
com fix roteado para `@BE`. Como o Codex bateu limite de uso e o humano pediu para eu terminar as
implementações em aberto, corrigi eu mesmo — é território dele por convenção, não por regra dura,
e a correção é pequena e bem especificada pelo próprio SEC.

- RED: 17 testes novos (`tests/test_sandbox_secrets.py`) cobrindo os achados exatos do SEC:
  `id_ecdsa`/`id_dsa`/`.npmrc`/`.netrc`/`.pypirc`/`.kube/config`/`.docker/config.json`/
  `terraform.tfstate*` sem gate, e três formas de chave/valor citados (`"api_key": "sk-..."`,
  `'password': '...'`, `"token":"..."`) passando sem redação → **17 failed**.
- GREEN: `_NAMES` trocou `id_rsa*`/`id_ed25519*` por `id_*` (bate com `threat-model.md` §2, que o
  contrato tinha estreitado sem motivo) e ganhou `.npmrc`/`.netrc`/`.pypirc`/`terraform.tfstate*`;
  novo `_DIRS` (`.kube`, `.docker`, além de `.ssh`/`.aws`/`secrets` que já existiam) para os
  arquivos de config que não têm nome fixo; regex `assignment` ganhou aspa opcional de cada lado
  do separador. Primeira rodada: 4 dos 17 ainda falhavam (`.kube`/`.docker`) — `_DIRS` estava
  definido mas a função ainda checava o set antigo hardcoded; corrigido para usar `_DIRS` de
  verdade. `pytest tests/test_sandbox_secrets.py` → **54 passed**.
- Regressão completa: `pytest -q` → **625 passed, 34 skipped in 41.42s** (era 607 antes; +17 dos
  testes novos, mesma contagem de skip, sem regressão).
- `contract.md` atualizado para 1.1.1 (Claude, território dele) com a denylist/regex corrigidas
  e uma entrada no Changelog citando o SEC gate — sem mudança de shape de API.
