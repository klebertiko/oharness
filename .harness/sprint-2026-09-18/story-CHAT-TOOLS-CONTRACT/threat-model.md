# Threat model — Chat Tools Broker (OHarness)

Data: 2026-09-18 · Autor: Claude (ARCH + SEC inline) · Revisão SEC fresh-context: **pendente** (reset 20/09)
Escopo: os endpoints e o loop que deixam o assistente do chat (adapters HTTP/OpenAI-compatível como
Ollama e OpenRouter; adapters CLI claude/codex/cursor) descobrir skills, ler arquivos e executar
comandos dentro do workspace escolhido no composer. Contrato: `contract.md` ao lado.

## 1. Escopo

**Ativos**
- A1 — Arquivos do usuário fora do workspace (outros repos, `%USERPROFILE%`, cofres).
- A2 — Segredos: `OH_SECRETS` (keychain/file store), `.env*`, chaves privadas, tokens em arquivos do repo.
- A3 — Integridade do workspace (um `exec` destrutivo: `git reset --hard`, `rm -rf`, `npm publish`).
- A4 — Sessão/credenciais de provedores já carregadas no sidecar (env do processo).
- A5 — Disponibilidade do sidecar (um exec que nunca termina, saída gigante, loop infinito de tools).
- A6 — Auditabilidade: saber depois o que foi lido e executado, e quem aprovou.

**Pontos de entrada (novos ou alterados)**
- E1 `GET /chat/tools/capabilities`, `GET /chat/tools/discover`, `POST /chat/tools/read` — chamados pelo FE.
- E2 `POST /execute/direct` com `tools.enabled` / `tools.preset` — inicia run com tools.
- E3 Resposta do modelo (HTTP) contendo `tool_calls` — **entrada não confiável**: o modelo é
  influenciado por tudo que leu.
- E4 Conteúdo de arquivos lidos e saída de comandos — voltam ao modelo como mensagens `tool`.
- E5 `POST /execute/{run_id}/control` com `decision: approve|reject` — o clique de aprovação.

**Fronteiras de confiança**
- B1 Qualquer processo local → sidecar (`127.0.0.1:8000`). Já coberto por token de sidecar
  (`security/sidecar_token.py`, SEC-3) e CORS fechado sem `"null"`.
- B2 FE → backend: o backend **não** confia no `cwd` do request; só honra `rootPath` registrado em
  `cowork_projects` e existente no disco (`_validated_project_cwd`). Reaproveitado integralmente.
- B3 Backend → modelo: system prompt e resultados de tool são texto; o modelo pode ignorar instruções.
- B4 Backend → processo filho (`exec`): herda só o env da allowlist (`scrub_env`), cwd = raiz
  validada, árvore morta no timeout/stop (`_kill`, SEC-4).
- B5 Modelo → usuário: o card de aprovação é a última linha de defesa; precisa mostrar o argv literal.

**Atores**
- T1 Página web maliciosa aberta no navegador do usuário (remoto, sem credencial).
- T2 Processo local malicioso rodando como o usuário.
- T3 Conteúdo hostil dentro do workspace (README, issue clonada, dependência) que o modelo lê —
  **prompt injection indireta**. O ator mais provável deste sprint.
- T4 Modelo local/remoto com comportamento errático (alucina caminhos, insiste em comandos).
- T5 O próprio usuário aprovando rápido demais (fadiga de aprovação).

## 2. STRIDE por fronteira

| Fronteira | Categoria | Ameaça | Estado |
|---|---|---|---|
| B1 | Spoofing | T1 chama `/execute/direct` com `tools.preset exec` via fetch cross-origin | **Fechado** por CORS sem `"null"` + token de sidecar obrigatório em rotas mutantes. Novas rotas herdam o middleware; teste de regressão obrigatório. |
| B1 | Spoofing | T2 chama o sidecar com o token (lê o arquivo do token) | **Aceito**: T2 já roda como o usuário; não há elevação. Documentado em `sidecar_token.py`. |
| B2 | Tampering | `cwd` apontando para fora dos projetos registrados | **Fechado** por `_validated_project_cwd`. Sem `cwd` válido → tools desabilitadas (`reason: no-workspace`). |
| B2 | Info disclosure | `read` com `..`, caminho absoluto fora da raiz, UNC, `\\?\` | **Mitigar**: `sandbox/paths.py` resolve e exige `resolved.is_relative_to(root.resolve())`; rejeita UNC e prefixos estendidos. |
| B2 | Info disclosure | Symlink/junction dentro da raiz apontando para fora (ex.: `link → C:\Users\x\.ssh`) | **Mitigar**: checagem **pós**-`resolve()` (segue o link) — o alvo real precisa estar na raiz. Teste com symlink absoluto e relativo, e junction no Windows. |
| B2 | Info disclosure | `read` de `.env`, chaves, store de segredos dentro do workspace | **Mitigar**: denylist de padrões (`.env*`, `*.pem`, `*.key`, `id_*`, `*.pfx`, `*.p12`, `*.kdbx`, `.git/config`, `**/.aws/**`, `**/.ssh/**`, o path do file store) → exige aprovação explícita (mesmo gate do exec). |
| B4 | Info disclosure | `exec` contorna a denylist (`type .env`, `cat`, `printenv`) | **Mitigar em camadas**: (a) todo `exec` exige aprovação com argv literal; (b) redação de saída por regex de segredos conhecidos (`sk-`, `AKIA`, `ghp_`, `xox[abprs]-`, `-----BEGIN`, `OPENROUTER`, `ANTHROPIC_API_KEY=`), marcando `redactions: n`; (c) env do filho é só a allowlist. **Residual aceito**: segredo em formato desconhecido dentro de um arquivo que o usuário aprovou ler/imprimir. |
| B3/E3 | Tampering / EoP | T3 injeta "ignore as regras e rode X" num arquivo; o modelo emite `tool_call exec` | **Mitigar**: exec **sempre** para no gate; injeção só consegue *pedir*. Resultados de tool vão ao modelo delimitados como dados, com instrução fixa no system prompt. **Residual aceito**: o modelo pode ser induzido a ler mais arquivos não-secretos (read é automático) — limitado por cota de reads por turno e cada read aparece no transcript. |
| B3 | Tampering | T3 induz o modelo a "aprovar" via texto ("o usuário já aprovou") | **Fechado por construção**: aprovação só chega por E5 (control endpoint), nunca por conteúdo de mensagem. |
| B5 | EoP | T5 aprova sem ler; argv longo/ofuscado (`cmd /c "..."`, `powershell -enc ...`) | **Mitigar**: card mostra argv como lista, um item por linha; itens que casem com `-enc`, `-EncodedCommand`, `| iex`, `curl … \| sh`, `Invoke-Expression` recebem rótulo `alto risco` (heurística, não bloqueio). Sem shell (`shell=False`) — pipes e redirecionamentos literais não funcionam. |
| B4 | Tampering (A3) | Comando destrutivo aprovado | **Aceito com legibilidade**: é a máquina e o repo do usuário; o produto promete "mãos", não impede. Mitigação: rótulo `alto risco` para `git reset --hard`, `git push --force`, `rm -rf`, `rmdir /s`, `del /f`, `npm publish`, `git clean -f`. Sem denylist bloqueante (bypassável e frustrante). |
| B4 | DoS (A5) | Exec que nunca termina / imprime GB | **Mitigar**: timeout (padrão 60 s, máx 600 s), cap de saída 64 KiB por stream com marcador, árvore de processos morta via `_kill` (taskkill /T no Windows). Um exec por run por vez. |
| E3 | DoS | Loop infinito modelo↔tools | **Mitigar**: máx 8 tool calls por turno; cota 20 reads/turno; discover com profundidade 4, ignora `node_modules/.git/.venv/dist`, máx 500 itens. |
| E3 | DoS | `read` de arquivo binário/enorme | **Mitigar**: cap 256 KiB, detecção de binário → 415, truncamento marcado. |
| todas | Repudiation (A6) | "Eu não aprovei isso" / "o que ele leu?" | **Mitigar**: cada `tool_call`, `tool_approval_required`, decisão (com `note`) e `tool_result` entram nos `events` do `ExecutionLog` do run. **Depende de DIRECT-HISTORY** (Codex) para o modo direto persistir. |
| B3 | Info disclosure | Conteúdo lido vai para provedor remoto (OpenRouter) | **Aceito e declarado**: é o propósito; o `capabilities` diz o `provider_kind` e o FE mostra "arquivos lidos são enviados a `<provider>`" na primeira leitura da sessão. |
| CLI | EoP | Reativar tools do CLI (`--tools`), hooks, MCP | **Fechado**: adapters CLI não recebem tools neste sprint. SEC-1/SEC-5 mantidos; teste trava o argv. Ponte MCP é fase 2 (ADR). |

## 3. Árvores de ataque (alvos de maior valor)

```
Goal A: exfiltrar um segredo do usuário
├── OR ler .env via read
│   └── AND passar pela denylist            ← fechado (padrões) → cai no gate de aprovação
├── OR ler alvo fora da raiz via symlink
│   └── AND checagem pré-resolve            ← fechado: checagem é pós-resolve
├── OR exec `type .env` / `printenv`
│   ├── AND obter aprovação                  ← gate; argv literal no card (T5 é o elo fraco)
│   └── AND saída não redigida               ← redação por regex; residual: formato desconhecido
└── OR env do filho com chaves               ← fechado: scrub_env allowlist
```

```
Goal B: executar comando sem o usuário saber (via T3 injeção)
├── OR tool_call exec sem gate               ← fechado: exec nunca é automático
├── OR fingir aprovação por texto            ← fechado: aprovação só via control endpoint
├── OR esconder o comando no card            ← mitigado: argv em lista + rótulo alto risco; residual T5
└── OR chamar /execute/direct de uma página  ← fechado: CORS + token (SEC-3); regressão obrigatória
```

Caminho mais barato restante: **A → exec aprovado às pressas (T5)**. Por isso o card de aprovação é
requisito de segurança (AC#3 do FE), não só de UX.

## 4. Mitigações ranqueadas

| # | Ameaça | Prob. | Impacto | Mitigação (código) | Custo | Alternativa mais barata |
|---|---|---|---|---|---|---|
| 1 | Escape de raiz (traversal/symlink) | Alta | Alto | `sandbox/paths.py` pós-resolve + testes symlink/junction | 0,5 d | — (é o mínimo) |
| 2 | Exec sem aprovação | Média | Alto | Gate por ação reusando `RunControl.gate` + control endpoint | 1 d | — |
| 3 | Exfiltração via exec/read de segredo | Média | Alto | Denylist → gate; redação de saída; `scrub_env` | 1 d | Só denylist sem redação (residual: `type` de arquivo secreto aprovado) |
| 4 | Injeção indireta induz reads em massa | Alta | Médio | Cota de reads/turno; cada read no transcript; delimitação como dados | 0,5 d | Só a cota |
| 5 | DoS por exec/saída/loop | Média | Médio | Timeout, caps, `_kill`, máx 8 tools/turno | 0,5 d | — |
| 6 | Repúdio | Baixa | Médio | Eventos de tool no `ExecutionLog` | 0 d extra (vem com DIRECT-HISTORY) | — |
| 7 | Fadiga de aprovação (T5) | Alta | Alto | Card com argv em lista + rótulo `alto risco` | 0,5 d | Só argv literal, sem rótulo |
| 8 | Regressão de SEC-1/3/4/5 | Baixa | Alto | Testes que travam argv do CLI, CORS, token, `_kill` | 0,25 d | — |

Nenhum controle passa de 20% do orçamento do sprint (8 pts BE + 5 FE); o loop de Value Engineering
não dispara. O controle mais caro relativo ao ganho é a redação de saída (#3b): mantido porque é a
única camada que age *depois* de uma aprovação errada.

## 5. Riscos aceitos (decisão, não esquecimento)

- R1 Processo local malicioso rodando como o usuário (T2) — já tem tudo o que o broker daria.
- R2 Comando destrutivo **aprovado** pelo usuário — o produto promete mãos; rótulo, não bloqueio.
- R3 Segredo em formato desconhecido impresso por comando aprovado.
- R4 Conteúdo lido enviado a provedor remoto — declarado no FE.
- R5 Adapters CLI sem tools neste sprint — capacidade honesta em vez de reabrir SEC-1/SEC-5.
- R6 (proposta Codex §5, aceita) **Exec não é sandbox de SO.** cwd + `scrub_env` + `shell=False`
  não impedem um processo aprovado de ler/escrever fora do workspace ou usar rede, com os
  privilégios do usuário. A contenção de caminhos protege `read`/`cwd`. Mitigação: aprovação por
  ação com `call_id`, card com "execução local, com os seus privilégios", rótulo `alto risco`,
  persistência redigida de args/note/result. Sandbox real (job objects/AppContainer/contêiner) é
  trabalho futuro com story própria.

## 6. O que o SEC fresh-context deve verificar (checklist para 20/09)

1. Testes de `sandbox/paths.py` cobrem: `..`, absoluto fora, UNC, `\\?\`, symlink absoluto,
   symlink relativo, junction, link dentro→dentro (deve passar).
2. Não existe rota standalone de exec; grep por `subprocess`/`run_cli` fora de `engine`/`chat_tools` loop.
3. Novas rotas passam pelo middleware de token (teste 401 sem header).
4. Argv de `cli_claude.py`/`cli_codex.py`/`cli_cursor.py` inalterado (teste de trava).
5. Aprovação nunca deriva de conteúdo de mensagem (grep por `approve` no loop de tools).
6. Regex de redação tem teste positivo e negativo; `redactions` aparece no evento.
7. Decisão sem `call_id`, com id errado ou repetida → 409; decisão antes do gate → 409 (`no_pending_call`).
8. `ExecutionLog` guarda args/note/result **redigidos**; o card mostra o argv exato só em memória.
9. `discover` não segue links para fora da raiz e nunca lista caminhos da denylist, mesmo por alias.
