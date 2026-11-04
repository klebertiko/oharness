# Requisitos: lacunas de paridade e plano de issues (2026-11-04)

Complementa `docs/product/parity-matrix.md` (consolidada em 2026-10-29), sem duplicá-la: o que ela já cobre (chat, composer, diff, worktree, fábrica) é referenciado pelo código da linha (A1.., B1.., C1.., D1.., E1.., G1..). Este documento acrescenta o que faltava: providers e uso por assinatura em profundidade, diagnóstico, onboarding, DX/CLI e uma reconciliação com o estado real da `main`. Issues fechadas = entregues.

Convenção de IDs de fonte: IDs com número (CL1, CX1, CU1, DS1) são desta rodada e estão na seção 7. As siglas sem número (CL, CX, CU, DS) citadas como `PM:A1` vêm da matriz de paridade e valem como lidas em 2026-10-29.

## 0. Resumo executivo

1. Base: 4 concorrentes (Claude, Codex/ChatGPT, Cursor, DeepSeek) contra o OHarness na `main` @ 008472d; 68 requisitos priorizados + 10 itens "não trazer".
2. Prioridade: **Must 9**, **Should 35**, **Could 24**, **Won't 10**. Dos 68, 39 reaproveitam issue existente (marcadas) e 29 são novos, 25 deles de Providers.
3. Lacuna 1 (Providers): falha de CLI em run/chat vira mensagem genérica e a conexão continua "Verified" com a sessão expirada (R-PRV-03, R-PRV-04).
4. Lacuna 2 (Providers): não há detecção de CLI instalado nem wizard; "Turn on" antecede o aviso de instalar/entrar (R-PRV-01, R-PRV-02, R-PRV-23).
5. Lacuna 3 (Providers/custo): o orçamento e o ledger tratam assinatura como API; o gasto pode ser recusado ou estimado por preço de lista (R-PRV-06, R-PRV-11).
6. Lacuna 4 (Providers): catálogo fechado, sem endpoint próprio nem chave Anthropic/OpenAI; sem `oharness providers`, sem doctor, sem camadas de config (R-PRV-14..20).
7. Lacuna 5 (execução): sem cliente MCP (#316) e sem sandbox de SO para as tools do broker; os quatro concorrentes têm MCP (CL9, CX14, CU15, DS13); Codex e Cursor isolam por SO e o Claude em parte (CX10, CU16, CL6).
8. Única linha "melhor", com prova: probe por conexão com ação única por estado (seção 2, abaixo da tabela). Failover com evidência em harness fica "tem", porque o registro durável nos concorrentes não foi verificado.
9. Restrição transversal: a via de assinatura (`credential.kind=cli`) é preservada por 13 invariantes (I1..I13, seção 3.3) e por uma suíte de não-regressão (R-PRV-00) que precede todo o resto de Providers.
10. A matriz de paridade está desatualizada em worktree (D1), fábrica (G1, G8 a G11) e células DS; correções na seção 2.
11. Itens `inferido, a confirmar` do inventário (links no app empacotado, Ollama Cloud, diretório de dados, atalho `.cmd`) viram tarefas de verificação, não de correção às cegas.
12. Plano de issues: 6 épicos e 38 sub-issues, em arquivo importável separado, com milestones v0.0.2-alpha (Must/Should) e v0.0.3-alpha (Could); R-PRV-10 amplia a #318 e não gera issue nova; R-PRV-11 amplia a #340 e só a sobra vira a sub-issue PRV-11.

## 1. Método e limites

Leitura de documentação oficial pública (URLs na seção Fontes) e de `--version`/`--help` dos CLIs instalados em 2026-11-04; sem leitura de credenciais, sem inspeção de binários, sem captura de tráfego; apps desktop não foram abertos (marcar o que depende disso como não verificado).

Versões: Claude Code 2.1.289, Codex CLI 0.154.0, Cursor CLI 2026.10.01 (IDE 3.27.22), DeepSeek dsh 0.1.1-rc.2 (docs do master), OHarness main @ 008472d.

## 2. Matriz de paridade

Células: "✓ ID" = o produto tem e a fonte prova; "◐" = em parte; "— (não tem)" = a fonte lida mostra que não tem ou o OHarness não tem; "? (não verificada)" = sem prova. "Estado OH" é exatamente um de: tem, pior, não tem, melhor. Linhas já cobertas pela matriz de paridade trazem `PM:código`.

### Providers e conexões

| Tema | Capacidade | Claude | Codex/ChatGPT | Cursor | DeepSeek | OHarness | Estado OH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Providers | Login de assinatura | ✓ CL1, CL19 | ✓ CX1, CX20 | ✓ CU11, CU25 | ◐ DS9 (conta própria, rota separada) | ✓ via CLI do vendor, sem credencial no app | tem: `backend/adapters/catalog.py`, seção 3.2 |
| Providers | Chave de API própria | ✓ CL1 | ✓ CX1 | ✓ CU4 (BYOK; plano Plus não) | ✓ DS3 | ◐ só OpenRouter e Ollama Cloud | pior: F9, `providerStore.ts` |
| Providers | Endpoint ou gateway próprio | ✓ CL2 | ✓ CX3 (exige API Responses) | ? (não verificada; CU4 é omisso) | ✓ DS3 (3 protocolos) | — (não tem) | não tem: catálogo fechado, F9 |
| Providers | Nuvem de terceiros (Bedrock, Vertex, Azure) | ✓ CL1, CL18 | ◐ CX4 (Azure como provedor custom; wizard Bedrock em desenvolvimento, CX20) | ✓ CU4 | ? (não verificada) | — (não tem) | não tem: W-07 |
| Providers | Modelos locais | ? (não verificada) | ✓ CX4, CX21 | ? (não verificada) | ? (não verificada) | ✓ Ollama local | tem: `catalog.py` |
| Providers | Teste por conexão com estado e próximo passo | ◐ CL2 (teste manual, sem botão) | ◐ CX20 (`doctor` do provedor ativo) | ◐ CU7, CU5 (rede; chave sem verificação) | ? (não verificada; ausência inferida, DS3) | ✓ probe sem gastar token + ação única | melhor: ADR 0013, 0016 |
| Providers | Diagnóstico copiável/exportável | ✓ CL19, CL11 | ✓ CX20 | ◐ CU25 (`status`, `about` existem; não executados), CU7 | ◐ DS7 (log de falha de boot) | — (não tem) | não tem: R-PRV-07 |
| Providers | Erros classificados com ação | ✓ CL3, CL17 | ? (não verificada; CX7 não traz) | ◐ CU9 (sem objeto estruturado) | ✓ DS5 | ◐ classifica no probe, não no run | pior: ADR 0013, F1 |
| Providers | Escolha de modelo, padrão x sessão | ✓ CL4 | ✓ CX5, CX9 | ✓ CU1 | ✓ DS3, DS6 | ✓ Enter salva padrão, Shift+Enter só o chat | tem: ADR 0014, 0015 |
| Providers | Lista de modelos descoberta | ◐ CL4 (só gateway) | ◐ CX3 (catálogo próprio) | ✓ CU25 | ✓ DS3, DS4 | ◐ HTTP sim; assinatura estática ou vazia | pior: `providerStore.ts` |
| Providers | Fallback entre modelos ou conexões | ✓ CL4, CL20 | ? (não verificada) | ◐ CU3 (roteia; não é cadeia) | ? (não verificada) | ✓ cadeia ordenada em nó de harness, probe de pré-voo, evidência `failover` (só em nó de harness) | tem: `engine.py`, `provider-harness-rule.md` |
| Providers | Config em camadas e dump | ✓ CL5 | ✓ CX4 | ✓ CU12 | ✓ DS7 | — (não tem; `.ohm` só guarda ids) | não tem: F8 |
| Providers | Wizard de primeira execução | ✓ CL15 | ✓ CX2 | ✓ CU21 | ✓ DS8 | — (não tem; só CTA no composer) | não tem: R-PRV-23 |
| Providers | Estados vazios e CTA | ✓ CL15 | ? (não verificada) | ? (não verificada) | ✓ DS3, DS6 | ✓ "Nothing is connected yet", combo "Needs action" | tem: ADR 0035, 0016 |
| Providers | Uso e limite do plano visíveis | ✓ CL10, CL11 | ◐ CX6, CX8 (janelas não verificadas) | ✓ CU2, CU6 | ◐ DS8 (créditos) | — (não tem) | não tem: W-06 (exigiria credencial) |
| DX/CLI | Comandos de conexão (`status`, `doctor`, `models`) | ✓ CL20 | ✓ CX20 | ✓ CU25 | ◐ DS7 | — (só `validate`, `run`, `factory`) | não tem: R-PRV-17 |

### Chat e controle (detalhe na matriz: A, B, C)

| Tema | Capacidade | Claude | Codex/ChatGPT | Cursor | DeepSeek | OHarness | Estado OH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chat | Linha de tool completa, ação atual, avisos, markdown | ? (não verificada) | ? (não verificada) | ✓ PM:A1 | ✓ PM:A1, A2, A10 | ◐ itens abertos | pior: #296, #297, #298, #299 |
| Chat | Raciocínio visível e eventos estruturados das CLIs | ✓ PM:A3 | ? (não verificada) | ? (não verificada) | ✓ PM:A3, A6 | ◐ o bloco existe, sem fonte real | pior: #301, #302 |
| Chat | Tempo, tokens e custo por passo | ◐ CL10 | ◐ CX6 | ◐ CU2 (preço por modelo; custo por turno não verificado) | ✓ DS14 (tokens e TTFT; sem custo em moeda) | ◐ latência por nó e rollup de tokens | pior: #300 |
| Chat | Medidor de contexto e compactação | ✓ CL10 | ◐ CX6 | ? (não verificada) | ✓ DS19 | ◐ evento de compactação | pior: ADR 0025, #304 |
| Chat | Fila de mensagens | ◐ PM:B1 | ◐ PM:B1 | ✓ PM:B1 | ✓ DS6 | ✓ | tem: ADR 0023 |
| Chat | Enviar agora (steer) | ? (não verificada) | ✓ PM:B2 | ✓ PM:B2 | ✓ DS6 | — (backend sim, tela não) | não tem: #305 |
| Chat | Interromper | ✓ PM:B3 | ? (não verificada) | ✓ PM:B3 | ✓ DS6 | ✓ | tem: PM:B3 |
| Chat | @-menção, anexos, notificações, busca, pergunta lateral, meta, ramificar | ✓ PM:B5..B11 | ◐ PM:B6, B7, B10 | ◐ PM:B5..B10 | ◐ PM:B11 | — | não tem: #307..#313 |
| Chat | Instruções persistentes (AGENTS.md, CLAUDE.md) | ✓ PM:E4 | ✓ CX6 (`/init`) | ✓ CU13, CU14 | ? (não verificada) | — (o chat não lê arquivo de regras) | não tem: #317 |
| Chat | Modo plano com aprovação | ✓ PM:C2 | ? (não verificada) | ◐ PM:C2 | ✓ DS18 | ✓ | tem: ADR 0022 |

### Harness, Studio, runs

| Tema | Capacidade | Claude | Codex/ChatGPT | Cursor | DeepSeek | OHarness | Estado OH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Harness | Harness como grafo editável, com gates e HITL | ? (não verificada) | ? (não verificada) | ? (não verificada) | ◐ DS1 (plugins; grafo de gates não verificado) | ✓ Studio, `.ohm` | tem: ADR 0002, 0009 |
| Harness | Criar harness por conversa | ? (não verificada) | ? (não verificada) | ? (não verificada) | ✓ DS1 ("creation mode") | ✓ Nilo rascunha no Studio | tem: `docs/GLOSSARY.md` |
| Harness | Agentes e skills custom em arquivo | ✓ CL8 | ✓ CX13 | ✓ CU19 | ? (não verificada) | ◐ skills no composer | pior: #258 |
| Runs | Retomar e bifurcar a partir do jornal | ✓ CL20 | ✓ CX21 | ✓ CU25 | ◐ DS15 (fork de conversa) | ✓ | tem: ADR 0018, 0044 (#157) |
| Runs | Execução headless com saída estruturada | ✓ CL17 | ✓ CX17 | ✓ CU9, CU10 | ◐ DS7 (JSON do headless não verificado) | ✓ `oharness run --json` | tem: ADR 0017, 0045 (#158) |

### Permissões, subagentes, hooks, custo

| Tema | Capacidade | Claude | Codex/ChatGPT | Cursor | DeepSeek | OHarness | Estado OH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Permissões | Modos por conversa | ✓ CL6 | ✓ CX11 | ✓ CU16 | ✓ DS10 | ✓ 6 modos, tabela única, sem modo que ignore tudo | tem: ADR 0021 (modos de permissão) |
| Sandbox | Isolamento de SO para comandos | ◐ CL6 (macOS, Linux, WSL2; Windows nativo não) | ✓ CX10, CX21 (Windows nativo) | ✓ CU16 | ◐ DS10 (o aviso de segurança admite que não garante isolamento) | — (política, aprovação e redação; não é sandbox de SO) | não tem: `backend/sandbox/exec.py` |
| Subagentes | Paralelos, atividade ao vivo, cancelar | ✓ CL8 | ✓ CX13 | ✓ CU19 | ✓ DS12 | ✓ até 4; indisponível em provedor CLI | tem: ADR 0027, 0043 |
| Hooks | Veto antes da tool | ✓ CL7 | ✓ CX12 | ✓ CU18 | ◐ DS11 (experimental) | ✓ fail-closed | tem: ADR 0026, 0041 |
| Hooks | Outros eventos (pós-tool, prompt, fim, sessão) | ✓ CL7 | ✓ CX12 | ✓ CU18 | ◐ DS11 | — | não tem: R-HOK-01 |
| Custo | Teto por run | ✓ CL17 (`--max-budget-usd`) | ? (não verificada) | ? (não verificada) | ? (não verificada) | ✓ teto de tokens | tem: ADR 0025, 0040 |
| Custo | Orçamento correto para assinatura | ◐ CL10 (custo a preço de lista) | ? (não verificada) | ? (não verificada) | ? (não verificada) | ◐ trata como API | pior: F5, R-PRV-06 |

### Diff, worktree, automação, MCP, DX

| Tema | Capacidade | Claude | Codex/ChatGPT | Cursor | DeepSeek | OHarness | Estado OH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Diff | Diff por turno e reverter por arquivo | ✓ PM:C4 | ✓ PM:C4 | ✓ PM:C4 | ◐ DS15 (revert não verificado) | ✓ | tem: ADR 0024, 0042 (#163) |
| Diff | Restaurar o workspace a um turno (rewind) | ✓ CL12 | ◐ CX16 (snapshot de worktree; checkpoint ausente na doc lida) | ✓ PM:C6 | ? (não verificada) | — | não tem: #315 |
| Diff | Revisão com comentários por linha | ✓ PM:C5 | ✓ PM:C5 | ✓ PM:C5 | ? (não verificada) | — | não tem: #314 |
| Worktree | Worktree por run | ✓ CL20 | ✓ CX16 | ✓ CU20 | ◐ DS16 (experimental) | ✓ UI e backend | tem: ADR 0019, 0046 (PR #294, #275 fechadas) |
| Automação | Agendamento por tempo e evento, com UI | ✓ CL13 | ✓ CX15 | ✓ CU14 | ✓ DS17 | ◐ backend entregue, sem UI | pior: ADR 0062, #261 |
| Fábrica | Work item, webhook, Factory MCP, CLI | ? (não verificada) | ? (não verificada) | ◐ PM:G8 | ◐ DS17 (webhook experimental) | ◐ backend entregue, sem tela | pior: ADR 0053, 0059..0064; o comparador principal é a Warp (PM:G), fora destas colunas |
| MCP | Cliente MCP | ✓ CL9 | ✓ CX14 | ✓ CU15 | ✓ DS13 | — (o nó `mcp` existe no schema e o motor não o executa) | não tem: #316 |
| MCP | Servidor MCP próprio | ✓ CL20 (`claude mcp serve`) | ? (não verificada) | ? (não verificada) | ? (não verificada) | ✓ Factory MCP local por stdio | tem: ADR 0063 |
| DX | Instalar e atualizar o app | ✓ CL16 | ✓ CX20 (`doctor` avisa de versão nova) | ✓ CU22 | ✓ DS2 | ◐ NSIS por Tauri v2; atualizador não consta no inventário (inferido, a confirmar) | pior: ADR 0001; sem requisito até confirmar |
| DX | Importar configuração de outras ferramentas | ✓ CL20 (`claude import`) | ? (não verificada) | ✓ CU23 (importa do VS Code) | ? (não verificada) | — | não tem: W-08 |

### Por que "melhor" numa linha e "tem" em failover

- **Teste por conexão com estado e próximo passo.** A doc do Claude manda testar com uma chamada manual e não tem botão (CL2); o Cursor só roda diagnóstico de rede e não verifica a chave (CU5, CU7); a documentação do DeepSeek não traz teste de conexão (DS3; ausência inferida, não verificada); o Codex tem `doctor`, que cobre o alcance do provedor ativo mas não devolve ação por conexão (CX20). O OHarness faz probe sem gastar token e devolve estado, detalhe e uma ação única por estado, com o mesmo texto na lista, no dossiê, no combo e no composer (ADR 0013, 0016; testes em 3.5). "Melhor" vale contra os três concorrentes com prova, só para o que a documentação pública mostra; não houve comparação medida.
- **Failover com evidência: "tem", não "melhor".** O Claude tem lista de fallback por turno (CL4, CL20). O OHarness faz probe de pré-voo, escolhe o próximo da cadeia e grava a evidência `failover` em `node_start` e `node_done`, com selo no transcrito (`engine.py`). Escopo: só em nó de harness; o chat direto não tem cadeia, por regra (`docs/product/provider-harness-rule.md`). Se o Claude, o Codex ou o Cursor registram de forma durável o motivo da troca: não verificada; sem essa prova a vantagem não é afirmável.
- Marcadas "tem" de propósito, apesar do apelo: jornal durável de run e gates com HITL. Falta comparação medida com os concorrentes; sem prova, não é "melhor".

### Correções à matriz de paridade (itens desatualizados)

1. D1: a UI de worktree está mesclada (PR #294) e a #275 está fechada.
2. G1: a #255 está fechada. G8 a G11: #264, #265, #266, #267, #268 e #269 estão fechadas; o backend da fábrica (pacote B) está entregue. G10: automações agendadas e por evento existem no backend (ADR 0062), sem UI.
3. Células DS: a matriz as dava como não reverificadas (acesso negado em 2026-10-29). Em 2026-11-04 o repositório público respondeu e a documentação do master confirmou todas as células herdadas; nenhuma foi refutada (DS1..DS21). Continuam sem reverificação contra o desktop instalado.
4. Faltam na matriz: Flow (ADR 0065, 0066; épico #357, tarefas #358 a #366 e #369; mesclados os PR #336 e #367) e i18n (#279, shell, chat e Studio entregues).
5. A matriz não tem linha de Providers; ela não cobre adapters, orçamento nem catálogo (a #82, fechada, cobre só a camada de tela e combo). A seção 3 preenche a lacuna.
6. Confirmadas abertas em 2026-11-04: #296 a #305, #307 a #318, #256 a #263, #270 a #274.
7. Usar "modos de permissão" onde a matriz ainda usa o termo antigo (C1; a #345 trata a recusa visível ao usuário). Requisito: R-DOC-01.

## 3. Providers

### 3.1 Como cada concorrente resolve

| Tema | Claude | Codex/ChatGPT | Cursor | DeepSeek |
| --- | --- | --- | --- | --- |
| Conectar | Login por navegador (`claude auth login`), Console por uso, Bedrock e Vertex por assistente, gateway por variáveis de ambiente (CL1, CL2, CL18, CL20) | `codex login` (navegador, código de dispositivo ou chave por stdin), ChatGPT ou chave de API, provedores custom em TOML (CX1, CX3, CX4, CX20) | `agent login`, chave por variável de ambiente, BYOK colando a chave em Configurações (CU11, CU4) | Cartão do provedor com um campo de chave só de escrita; "Add model provider" com catálogo de terceiros e API custom (DS3, DS4) |
| Testar | Sem botão; teste manual de 1 token e `/status` (CL2) | Sem teste por provedor; `codex doctor` inclui handshake e alcance do provedor ativo (CX20) | "Run Diagnostics" testa os servidores do Cursor; chave BYOK sem verificação documentada (CU7, CU5) | ? (não verificada; ausência inferida); "Fetch available models" é o mais próximo (DS3) |
| Diagnosticar | `/status`, `claude doctor`, categorias de erro nomeadas, `system/api_retry` estruturado (CL11, CL19, CL3, CL17) | `/status`, `codex doctor --json` redigido, `/feedback`; textos de erro específicos não documentados (CX6, CX20, CX7) | Request ID, exportar logs, `agent status`; no modo json a falha é código de saída e stderr (CU8, CU9, CU11) | Códigos estáveis de erro do adaptador, aviso no turno com o código, log de boot (DS5, DS6, DS7) |
| Escolher modelo | `/model` (Enter salva padrão; `s` só a sessão), `--model`, aliases, fallback (CL4, CL20) | Seletor, `/model`, `-m`, `config.toml` compartilhado entre app e CLI (CX5, CX9) | Seletor, `agent models`, Auto; lista depende do plano (CU1, CU3, CU25) | Seletor com nível de raciocínio; lista oficial acompanhada a cada poucos minutos (DS3, DS4, DS6) |
| Estados vazios | Erros nomeados ao abrir a aba Code (assinar, entrar, 403) e "Login: Expired" (CL15, CL19) | ? (não verificada; CX7) | ? (não verificada) | "No available models", botão "Select model", ícone de chave ausente (DS3, DS6) |
| Onboarding | Instalar, entrar, aba Code, linha de ambiente e modelo sob o prompt (CL15) | Instalar, entrar com ChatGPT, pasta, modo (CX2); fluxo da CLI não verificado | Instalar, entrar, abrir pasta, pedir um resumo (CU21) | Desktop em passos (boas-vindas, tipo de trabalho, créditos); web: chave, workspace, tarefa (DS8, DS6) |
| CLI | `auth login/logout/status`, `doctor`, `setup-token` (CL19, CL20) | `login`, `login status`, `logout`, `doctor`, `features` (CX20) | `login`, `logout`, `status`, `models`, `bedrock`, `about` (CU25) | `--profile`, `--dump-config`, `web` (DS7) |
| Config | 4 escopos de settings, precedência, `/status` lista as fontes (CL5) | Camadas usuário, perfil, projeto, `-c`; `--strict-config` (CX4, CX20) | Global em JSON; o projeto só carrega permissões (CU12) | Pilha de patches YAML e `--dump-config` (DS7) |

### 3.2 Estado atual do OHarness

Catálogo: 5 vendors e 6 conexões semeadas (Anthropic, OpenAI, Cursor, OpenRouter, Ollama local, Ollama Cloud). Anthropic, OpenAI e Cursor são `credential.kind=cli`; OpenRouter e Ollama Cloud são `api-key`; Ollama local não tem credencial. O mapa conexão para adapter fica em `ADAPTER_BY_PROVIDER` (`backend/providers/resolution.py`); Cursor não tem entrada.

**Definição precisa de "uso por assinatura".** É uma conexão cujo `credential.kind` é `cli` (Anthropic, OpenAI, Cursor), em que o OHarness não obtém, não guarda e não repassa nenhuma credencial: ele só dispara, como subprocesso local sem shell, o CLI oficial do vendor, que usa a sessão que o próprio CLI já tem em disco no perfil do usuário. Mecânica verificável por código:

1. O login é feito pelo usuário, no terminal (`claude login`, `codex login`, `cursor-agent login`). O OHarness nunca chama login; a UI só copia o comando.
2. O subprocesso nasce por `create_subprocess_exec` com argv em lista, sem shell. O prompt vai só por stdin. O ambiente herdado é uma allowlist (`scrub_env`: PATH, perfil do usuário, diretórios de dados, temporários); nenhuma variável de credencial passa, então autenticar por variável de ambiente não funciona, só a sessão em disco.
3. O `cwd` é validado dentro da pasta de trabalho dos CLIs (`%LOCALAPPDATA%\OHarness\cli-runs`) ou de uma raiz de projeto registrada; há timeout (120 s Claude e Codex, 600 s Cursor) e a árvore de processos é encerrada.
4. O probe nunca gasta token: `claude auth status`, `codex login status`, `cursor-agent status --format json`.
5. A resolução não lê o cofre para `kind=cli` (`api_key` fica vazio). O OHarness guarda só metadados da linha (`provider_connections`, `secret_ref` nulo); e-mail e plano lidos pelo probe ficam só em memória no front.
6. Os CLIs rodam restritos: Claude com tools desligadas, sem MCP, sem settings do usuário e sem persistência de sessão; Codex em read-only, sem config nem regras do usuário, efêmero; Cursor com `--trust` e `--force` (confiança no diretório e escrita liberada) e sempre com sandbox ligado.

Limites desse modo: sem streaming (um único bloco ao fim); sem histórico (cada turno é independente); sem tools do OHarness (permission modes, hooks, diff de turno e subagentes não se aplicam; ficam `/exec` e `/read` do usuário); `temperature` e `max_tokens` do nó não chegam ao CLI; o Codex recusa fora do Windows; o Cursor no Windows exige WSL2 com distro `Ubuntu-24.04`.

Fluxos hoje, em uma linha cada: conectar (Turn on faz ligar e testar; chave colada vai ao cofre); testar (probe devolve `live|setup|degraded|fault`, detalhe e latência); classificar (ADR 0013: `key-rejected`, `out-of-credits`, `rate-limited`, `unreachable`, `cli-signin`, `cli-missing`, `unknown`); ação única por estado (ADR 0016); modelo por conexão, por chat e por nó (ADR 0014, 0015); failover só em nó de harness. Gravação: metadados em SQLite (`harness.db`); segredos só de `api-key` no cofre (`OH_SECRETS=memory|file|keychain`; o modo `file` deriva a chave do caminho, é ofuscação); escolha do chat em `localStorage`. Nota: o rótulo "assinatura" da conexão Ollama Cloud é de cobrança; ela é `api-key` e não entra nos invariantes da via de assinatura.

Fricções com prova de código (F1..F11 do inventário; `inferido` quando derivado só de leitura): F1 erro de CLI em run vira texto genérico e não atualiza a linha; F2 "Turn on" antecede o aviso de instalar/entrar e não há detecção de CLI; F3 links de instalação e de cobrança provavelmente não abrem no app empacotado (a lista de URLs permitidos do Tauri tem 5 endereços de documentação exatos e não inclui `installUrl` nem `billingUrl`; inferido, a confirmar); F4 Cursor é conectável e inutilizável (#318); F5 orçamento e ledger tratam assinatura como API (inferido); F6 Ollama Cloud guarda a chave e nunca a envia (inferido); F7 tokens do CLI estimados por tamanho da saída e modelo vazio; F8 sem config por arquivo nem `oharness providers`, e possível divergência entre o diretório de dados do app e o do CLI (inferido, a confirmar); F9 catálogo fechado e mensagens que mandam "trocar o runtime para API", caminho que não existe; F10 e F11 copy e detalhes menores.

### 3.3 Invariantes de assinatura

Nenhum requisito, de Providers ou de qualquer outra frente, pode violar estes itens. Valem para conexões `kind=cli`.

| ID | Invariante |
| --- | --- |
| I1 | O OHarness não obtém, não guarda e não repassa credencial de assinatura. `secret_ref` fica nulo; e-mail e plano do probe ficam só em memória e nunca vão a log, jornal, diagnóstico ou arquivo. |
| I2 | O login é sempre feito pelo usuário, no terminal. O OHarness nunca executa `login` ou `logout`; a UI só copia o comando ou abre a documentação. |
| I3 | Subprocesso sem shell: argv literal em lista, nunca `shell=True`. |
| I4 | O prompt e qualquer texto do usuário vão só por stdin, nunca em argv. |
| I5 | O ambiente do subprocesso é uma allowlist; nenhuma variável de credencial (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CURSOR_API_KEY`, tokens) é repassada. |
| I6 | O `cwd` é validado dentro da pasta de trabalho dos CLIs ou de uma raiz de projeto registrada. |
| I7 | O probe nunca gasta token: só comandos de status. |
| I8 | A resolução ignora cofre para `kind=cli`: `api_key` é vazio mesmo se existir `secretRef` na conexão. |
| I9 | O CLI roda restrito (tools desligadas, sem MCP e sem config do usuário no Claude; read-only e efêmero no Codex; no Cursor, com as flags de confiança e de escrita `--trust` e `--force` já usadas hoje, mas sempre com `--sandbox enabled`) e o OHarness não amplia essas flags nem retira o sandbox. |
| I10 | Falha de CLI chega à UI só como classe fechada e texto fixo; stderr ou saída livre do CLI nunca é exibida nem registrada. |
| I11 | Assinatura nunca vira gasto em USD inventado: `billing=subscription` é honesto, custo desconhecido não é zero. |
| I12 | Timeout obrigatório e encerramento da árvore de processos. |
| I13 | Os ids `anthropic`, `openai` e `cursor` continuam `credential.kind=cli` e continuam resolvendo para os adapters de CLI; conexões novas por chave usam ids distintos. |

**Regra de não-regressão.** Nenhum PR que toque adapters de CLI, resolução, catálogo, cofre, ledger/orçamento ou o painel de conexão pode ser mesclado com a suíte de 3.5 vermelha. A suíte roda em todo PR, antes dos demais R-PRV; depois que o dono a marcar como obrigatória na proteção de branch (passo do dono, relacionada #290), bloqueia o merge. Não se usa skip, xfail, retry ou timeout maior para escondê-la (`docs/process/pre-pr-checklist.md`). Mudar um invariante exige ADR e decisão do dono; a suíte é atualizada no mesmo PR que o ADR. I11 hoje é violado em parte (F5, inferido): R-PRV-06 o corrige com teste vermelho primeiro.

### 3.4 Requisitos de Providers

Todo critério termina com a cláusula obrigatória: "suíte de não-regressão de assinatura verde (3.5)". Valor: A alto, M médio, B baixo.

| ID | Título | MoSCoW | Esf. | Valor | Critério de aceite testável | Issue | Depende de |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-PRV-00 | Suíte de não-regressão de assinatura (contrato I1..I13) no CI | Must | M | A: protege a via de assinatura de tudo que vem depois | O job de CI roda os testes de 3.5 (backend e frontend) em todo PR; violar cada invariante de propósito (ex.: repassar `ANTHROPIC_API_KEY` ao subprocesso) deixa o job vermelho, e o PR registra a mutação feita; I11 é coberto de fato por PRV-06a e a suíte o lista como pendente até lá, sem teste vermelho nem skip; marcar o job como obrigatório na proteção de branch é passo do dono (relacionada #290); suíte de não-regressão de assinatura verde (3.5) em `main` | nova | — |
| R-PRV-01 | Detectar CLIs instalados e mostrar instale/entre/ok antes de "Turn on" | Must | M | A: elimina a descoberta por tentativa (F2); os quatro concorrentes guiam instalação e entrada (CL15, CX2, CU21, DS8) | Endpoint de detecção reaproveita `probe_known_clis` e os comandos de status, sem gastar token; com `claude` fora do PATH a linha da Anthropic mostra "Instale", e com CLI presente e sem sessão mostra "Entre"; teste de API com runner injetado e teste de componente; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-02 | A ação primária é o bloqueio, não "Turn on" | Must | P | M: o usuário vê o próximo passo real e não um interruptor que esconde o bloqueio | Enquanto houver instalar ou entrar pendente, o botão primário da linha e o do composer são a ação do bloqueio (abrir guia, copiar login); "Turn on" só aparece com o CLI pronto; testes de `nextStep` e `composerAction`; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-01 |
| R-PRV-03 | Falha de CLI no run vira classe segura com ação (estende #86 ao caminho de run) | Must | M | A: hoje a mensagem genérica não diz "entre" (F1); Claude e DeepSeek nomeiam categorias (CL3, DS5) | O adapter devolve classe fechada (`cli-signin`, `cli-missing`, `cli-timeout`, `cli-error`) a partir de código de saída e frases ancoradas, sob o mesmo contrato de `test_probe_detail_contract.py`; o run emite `provider_failure` com a classe; o chat mostra o comando de entrada da conexão; teste com stderr contendo uma chave canário prova que nada chega à UI (I10); suíte de não-regressão de assinatura verde (3.5) | nova (estende #86, fechada) | R-PRV-00 |
| R-PRV-04 | Sessão expirada não pode ficar "Verified" | Must | P | A: a linha enganosa é a falha mais cara (F1); o Claude mostra "Login: Expired" (CL19) | Após run com `provider_failure=cli-signin` a conexão vira "Sign-in needed" sem novo clique, e um probe `live` posterior a restaura; teste do store (`providerStore.runOutcome`); suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-03 |
| R-PRV-05 | Links de instalar e de cobrança abrem no app empacotado (verificar e corrigir) | Must | P | M: sem isso "Open install guide" pode ser botão morto no instalador (F3, inferido) | Condicionado: a primeira tarefa (verificação no instalador real) confirma o achado F3; se refutado, vira Should ou fecha. Se confirmado: teste Rust falha se algum `docs`, `installUrl` ou `billingUrl` de `catalog.ts` não estiver na lista permitida; o casamento segue exato, sem curinga; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-06 | Orçamento e ledger tratam assinatura sem inventar USD | Must | M | A: hoje pode recusar com mensagem errada e estimar por preço de lista (F5, inferido) | Condicionado: a primeira tarefa (teste vermelho) confirma o achado F5; se o teste já passar, vira Should de mensagem ou fecha. Se confirmado: com orçamento global em USD, run em conexão `kind=cli` sem modelo padrão não é recusada por falta de modelo; o ledger grava `billing=subscription` com custo desconhecido (diferente de zero); o painel de gasto separa assinatura de USD; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-07 | Diagnóstico copiável/exportável (estilo doctor) sem segredos | Should | M | A: Claude e Codex têm relatório de ambiente (CL19, CX20) e o suporte depende dele | "Copiar diagnóstico" gera texto e JSON com versão do app, SO e, por conexão, tipo de credencial, estado, classe de falha, endpoint sem credencial, versão do CLI, caminho do CLI com o diretório do usuário mascarado e origem da credencial; teste com chave canário no cofre, e-mail do probe e usuário canário no caminho: nenhum aparece; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-01, R-PRV-03 |
| R-PRV-08 | Detalhes por conexão e `/status` no chat | Should | M | M: Claude e Codex mostram modelo, origem da credencial e endpoint (CL11, CX6) | `/status` e o painel Connection mostram modelo efetivo (ou "padrão do CLI"), origem da credencial ("sessão do CLI; variáveis de ambiente não são usadas", "cofre" ou "nenhuma"), endpoint e último probe; teste de componente; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-03 |
| R-PRV-09 | Modelos de assinatura: aliases do CLI e modelo efetivo; lista descoberta quando houver endpoint | Should | P | M: a Anthropic tem 4 ids estáticos e a OpenAI lista vazia; o Claude aceita aliases (CL4, CL20) e o Cursor lista por comando (CU25) | A Anthropic oferece os aliases aceitos pelo CLI marcados como "alias do CLI", com digitação livre; a OpenAI oferece digitação livre com dica; o modelo digitado vai para o argv do CLI, então é validado antes (só letras, dígitos, ponto, hífen, sublinhado, dois-pontos e barra; não pode começar com "-"; tamanho limitado) e o teste rejeita `--x`, texto com espaço e `;`; conexões com endpoint seguem descobertas; o chip mostra "padrão do CLI" quando vazio e o modelo usado quando o CLI o informa; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-10 | Cursor conectado mas inalcançável: dizer a verdade | Should | P | M: a tela promete um nó Delegate que não existe (F4) | O catálogo e as telas deixam de citar o nó Delegate até ele existir; a linha diz "só para agentes, sem uso no chat ainda" e o pré-requisito de WSL2 no Windows; teste de copy; suíte de não-regressão de assinatura verde (3.5) | #318, existente, ampliar: pré-requisito de WSL2 e linha honesta | R-PRV-00 |
| R-PRV-11 | Tokens e modelo reais do CLI no ledger e no teto | Should | M | M: hoje é tamanho da saída dividido por 4 e modelo vazio (F7) | Depois da #340 (PR #368 em andamento), que faz o teto e o gasto usarem o uso reportado pelo provedor, os adapters dos três CLIs propagam `usage` e o modelo efetivo até o evento; o ledger marca estimado só quando não vem do CLI; teste com saída falsa dos três CLIs; suíte de não-regressão de assinatura verde (3.5) | #340, existente, ampliar (PR #368 em andamento); relacionada #302; a sobra vira a sub-issue PRV-11 | #340, R-PRV-06 |
| R-PRV-12 | Ollama Cloud usa a chave guardada | Should | P | M: hoje a chave é guardada e nunca enviada, e o probe tende a rejeitar (F6, inferido) | Probe e run de `ollama-cloud` enviam a chave como bearer a um servidor falso; a chave não aparece em log, resposta nem diagnóstico; o rótulo "assinatura" é só de cobrança (a conexão é `api-key`); suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-13 | Mensagens de adapter sem "trocar o runtime para API" | Should | P | B: remove uma instrução impossível (F9) | Varredura de teste: nenhum texto dos adapters de CLI manda trocar o runtime para API; cada mensagem aponta o passo real (instalar ou entrar); suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-03 |
| R-PRV-14 | Conexões criadas pelo usuário (endpoint OpenAI-compatível e gateway Anthropic): backend | Should | M | A: três concorrentes aceitam endpoint próprio (CL2, CX3, DS3) e o catálogo aqui é fechado (F9) | A API cria, lista e remove conexão `api-key` com id próprio; `hydrate` não descarta linhas fora da semente; o endpoint é validado (http ou https, sem credencial, query ou fragmento, como em DS5); os ids `anthropic`, `openai` e `cursor` seguem `kind=cli` (I13); a chave só vai ao cofre; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-15 | Tela "Adicionar conexão" | Should | M | A: sem tela o backend de R-PRV-14 é inalcançável | O formulário (nome, URL base, protocolo, chave, modelo) cria a conexão, mostra o host antes de enviar a chave e roda o probe; teclado e axe sem exceção; en e pt-BR; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-14 |
| R-PRV-16 | Conexões por chave de API da Anthropic e da OpenAI, com ids distintos | Could | M | M: caminho para quem não tem assinatura de CLI; o adapter de SDK da Anthropic existe e está inalcançável (F9) | `anthropic-api` e `openai-api` aparecem como `api-key` com cobrança por uso; as conexões de assinatura não mudam (teste de resolução, I13); o orçamento em USD vale só nelas; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-14, R-PRV-06 |
| R-PRV-17 | `oharness providers list|test|doctor` com `--json` | Should | M | A: DX e suporte; os concorrentes têm status e doctor na CLI (CL19, CX20, CU25) | `list` mostra as conexões do diretório de dados; `test <id>` roda o probe e sai com código diferente de zero se o estado não for `live`; `doctor` reaproveita o relatório de R-PRV-07; `--json` com schema versionado; nenhum comando imprime segredo (teste canário); suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-07, R-PRV-18 |
| R-PRV-18 | Diretório de dados único entre app e CLI (confirmar a divergência) | Should | P | A: se divergirem, `run --mode live` não enxerga as conexões do app (F8, inferido) | Uma função única resolve `OH_DATA_DIR` para o sidecar e para o CLI, com teste de paridade contra o identificador do app; o README corrigido; `oharness providers list` mostra as mesmas conexões do app instalado (verificação no Windows registrada); suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-19 | `oharness providers dump-config`: configuração efetiva e origem de cada campo | Could | M | M: DeepSeek e Claude mostram a origem da configuração (DS7, CL5) | Imprime as conexões com campos efetivos e a origem (padrão, app, ambiente do app ou do sidecar; nunca o ambiente do subprocesso de CLI, I5), sem segredos; teste canário; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-17 |
| R-PRV-20 | ADR: camadas de configuração de conexões (usuário, projeto, local) sem credencial | Could | P | M: os quatro concorrentes têm camadas (CL5, CX4, CU12, DS7) | ADR aprovado pelo dono define camadas e precedência, e que arquivo de projeto não carrega segredo nem altera a via de assinatura; suíte de não-regressão de assinatura verde (3.5) | nova (decisão do dono) | R-PRV-19 |
| R-PRV-21 | Estados vazios e de erro numa tabela única estado, texto e ação | Should | P | M: evita telas divergentes e cobre as classes novas, sobre a base de #86 e #87 (fechadas) | Teste de exaustividade: toda classe de falha e todo estado vazio (inclusive sessão expirada, tempo esgotado do CLI e só-agente) tem texto en e pt-BR e uma ação; lista, dossiê, combo e composer mostram o mesmo texto; suíte de não-regressão de assinatura verde (3.5) | nova (amplia a base de #86 e #87, fechadas) | R-PRV-03 |
| R-PRV-22 | Acessibilidade de Providers e do wizard | Should | P | M: a tela é a porta de entrada do produto | axe sem exceção nova nos 2 temas; resultado do probe e mudança de estado anunciados (região viva); fluxo completo por teclado; foco devolvido ao copiar; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-23 | Wizard de primeira execução | Should | M | A: os quatro concorrentes têm onboarding guiado (CL15, CX2, CU21, DS8) | Abre sozinho quando nenhuma conexão está pronta; mostra instalar, entrar (mostrar e copiar o comando de login, nunca executá-lo, I2) e testar para cada CLI detectado, ou chave ou local; pode ser pulado e reaberto; ao fim a primeira mensagem do chat funciona; e2e com CLI falso; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-01, R-PRV-02, R-PRV-05 |
| R-PRV-24 | Polimento de Providers (F10, F11) | Could | M | B: remove inconsistências visíveis | Teste de catálogo: o endpoint da conexão OpenAI não é editável; teste de copy: o texto de ferramentas do composer coincide com o catálogo por vendor; teste de resolução: `openai` (adapter `codex`) não exige modelo e `ollama` e `openrouter` exigem; teste de store: prefixo e final da chave seguem corretos após reiniciar; teste de adapter: o probe de CLI devolve latência maior que zero; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-00 |
| R-PRV-25 | Roteiro de verificação de assinatura em Windows real | Should | P | A: o CI é só Linux e nenhum teste roda CLI real (lacunas 1 e 2 de 3.5) | Roteiro com resultado registrado para `claude.exe` ou `claude.cmd`, `codex` e `cursor-agent` via WSL: instalar, entrar, Turn on, primeira mensagem, sessão expirada; falhas viram issues; suíte de não-regressão de assinatura verde (3.5) | nova (relacionada #287) | R-PRV-03 |
| R-PRV-26 | Jornada e2e de assinatura com CLI falso | Should | M | A: não há jornada de assinatura no e2e (lacuna 2 de 3.5) | e2e no CI usa CLIs falsos no PATH do sidecar de teste: Turn on, "Sign-in needed", copiar login, testar de novo, "Verified", mensagem enviada, sessão expira, "Sign-in needed"; suíte de não-regressão de assinatura verde (3.5) | nova | R-PRV-03, R-PRV-04 |

Contagem: Must 7 (R-PRV-00..06), Should 16, Could 4, total 27; 25 novos e 2 que ampliam issue existente (R-PRV-10 em #318, R-PRV-11 em #340). Streaming e eventos estruturados dos CLIs pertencem a R-RUN-08 (#302); qualquer mudança ali passa por R-PRV-00.

### 3.5 Suíte de não-regressão de assinatura

**Testes que já protegem a via (do inventário; nada foi executado nesta rodada).**

| Invariante | Testes existentes |
| --- | --- |
| I1, I8 | `test_provider_resolution.py::test_anthropic_connection_resolves_to_claude_cli_adapter_without_a_credential`; `test_providers_api.py::test_get_connections_never_contains_sk_material`, `::test_create_list_get_update_delete_connection_metadata` |
| I2 | `nextStep.test.ts` (`signed out copies its own login command`, para as três conexões) |
| I3 | `test_cli_adapters.py`: `test_claude_build_argv_is_a_list_tools_and_settings_disabled`, `test_codex_build_argv_is_a_list_read_only_no_user_config`, `test_cursor_build_argv_windows_goes_through_wsl_not_powershell` |
| I4 | `test_cli_adapters.py`: os três `..._build_argv_never_carries_the_prompt`, `test_claude_invoke_sends_the_prompt_on_stdin_not_argv`, `test_codex_invoke_sends_prompt_on_stdin_and_parses_agent_message`, `test_cursor_invoke_sends_prompt_on_stdin_and_parses_result_field` |
| I5 | `test_cli_adapters.py::test_scrub_env_drops_unrelated_keys`; os testes Rust de allowlist em `src-tauri/src/lib.rs` |
| I6 | `test_cli_adapters.py`: os cinco `test_resolve_cwd_*` |
| I7 | `test_cli_adapters.py`: `test_claude_probe_*`, `test_codex_probe_*`, `test_cursor_probe_*`; `test_cli_probe.py` |
| I9 | `test_cli_adapters.py` (argv restrito); `test_chat_tools_cli_bdd.py::test_cli_tools_remain_locked`; `test_tool_capabilities.py` (`cli-adapter`) |
| I10 | `test_probe_detail_contract.py` (`test_every_failing_detail_an_adapter_emits_has_a_class`, `test_cli_details_and_free_text`); `test_execution_provider_resolution.py::test_connection_failure_is_structured_and_keeps_partial_usage`, `::test_direct_failed_history_preserves_safe_classification`; `providerFault.test.ts` |
| I11 | `test_budget_fixes.py::test_billing_record_distinguishes_local_and_subscription`, `::test_subscription_never_uses_api_catalog_to_pass_budget` (só a função) |
| I12 | `test_claude_invoke_surfaces_timeout`, `test_codex_invoke_surfaces_timeout` |
| I13 | `test_get_adapter_claude_is_cli_backed_not_mock`, `test_get_adapter_cursor_is_cli_backed_not_mock`, `test_get_adapter_codex_openai_and_ollama`; `test_provider_resolution.py::test_cursor_connection_on_an_llm_node_is_an_honest_error`; `chatProvider.recovery.test.ts` |
| Fiação e UI | `test_engine_provider_resolution.py`, `test_provider_persistence.py`, `chatProvider.test.ts`, `composerAction.test.ts`, `ProvidersScreen.test.tsx`, `ChatProviderPicker.test.tsx`, `runReducer.test.ts`; e2e `e2e-providers.mjs` e `e2e-chat-providers.mjs` (só OpenRouter e Ollama) |

**Lacunas de cobertura.**

1. Nenhum teste roda CLI real nem cobre Windows real; o CI é só Linux e `is_windows` é simulado. O atalho `.cmd` do `claude` instalado por npm no Windows não é testado (inferido).
2. Nenhuma jornada de assinatura de ponta a ponta (Turn on até a primeira mensagem).
3. Nenhum teste do ramo `kind: "cli"` do `KeyRow` (`ConnectionPanel.tsx`) nem do texto "usa a sessão do CLI".
4. Nenhum teste afirma que um `secretRef` numa conexão `kind=cli` é ignorado (`api_key` vazio).
5. Nenhum teste de erro de CLI em run ou chat verifica o que o usuário vê.
6. Nenhum teste liga `billing=subscription` ao caminho real de orçamento e ledger (F5); nenhum prova que `installUrl` e `billingUrl` abrem no app empacotado (F3).
7. A cobertura de I5 pelas três variáveis de credencial, do argv do probe como comando de status (I7), do encerramento da árvore de processos (I12) e do `credential.kind` do catálogo (I13) é inferida, a confirmar: os nomes dos testes não a afirmam.

**R-PRV-00 (Must): teste de contrato que fixa I1..I13.** Duas partes, ambas rodando em todo PR no CI e anteriores a qualquer outro R-PRV (tornar o job obrigatório é passo do dono): (a) backend, `backend/tests/test_subscription_contract.py` (nome proposto), com runner injetado, cobre I1 a I10, I12 e I13: nenhuma variável de credencial chega ao subprocesso, o argv não carrega prompt, `secretRef` presente em conexão `kind=cli` resulta em `api_key` vazio, o `credential.kind` das três conexões, o probe só chama comando de status, e uma falha de CLI com stderr canário não chega à resposta de run (propriedade, não texto exato, para o texto poder evoluir em R-PRV-03); (b) frontend, `subscriptionContract.test.tsx` (nome proposto), cobre o ramo `kind: "cli"` do `KeyRow` (sem campo de chave, texto de sessão do CLI), o comando de login copiado por vendor e as classes `cli-signin` e `cli-missing`. I11 é coberto de fato por PRV-06a (R-PRV-06), que escreve o teste de integração vermelho primeiro e o torna verde; até lá a suíte registra I11 como pendente (só vale o teste de função existente), sem ficar vermelha e sem skip. A verificação em Windows real fica em R-PRV-25 (o CI não cobre).

## 4. Requisitos das demais áreas

Esforço: P pequeno (até 1 dia), M médio, G grande. Prioridade herdada das issues quando existem (P0 Must, P1 Should, P2 Could), salvo onde a evidência mudou. "Existente, sem alteração" = nada a mudar na issue.

| ID | Título | MoSCoW | Esf. | Valor | Critério de aceite testável | Issue | Depende de |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-RUN-01 | Linha de tool completa em toda chamada | Should | P | M: fecha a lacuna A1 da matriz (outro produto já mostra) | Toda chamada mostra exit code, truncamento, timeout e redações no `ToolRow` | #296, existente, sem alteração | — |
| R-RUN-02 | Mostrar avisos e retries que o backend já emite | Should | P | M: o usuário vê por que um passo atrasou ou foi pulado | O reducer renderiza `gate_retry`, `node_token_warning`, `budget_warning`, `runtime_selected` e o `reason` de `node_skipped` | #298, existente, sem alteração | — |
| R-RUN-03 | Linha de ação atual ao vivo | Should | P | M: dá sensação de progresso (A2; DS ✓) | A linha mostra nó, fase, tool corrente e tempo do passo | #297, existente, sem alteração | — |
| R-RUN-04 | Resposta do assistente em markdown | Should | P | M: texto puro prejudica código e listas | Markdown renderiza sem HTML cru; teste de sanitização | #299, existente, sem alteração | — |
| R-RUN-05 | Enviar agora (steer) com a run ativa | Should | P | M: o backend já tem; falta a tela (PM:B2) | Botão "Enviar agora" entrega na próxima chamada de tool; teste de componente | #305, existente, sem alteração | — |
| R-RUN-06 | Custo, tokens de entrada/saída e TTFT por passo | Could | M | M: DeepSeek mostra tokens e TTFT (DS14) | Cada passo mostra tokens in/out e TTFT, com proveniência | #300, existente, sem alteração | R-PRV-11 |
| R-RUN-07 | Provedores HTTP emitem o raciocínio | Could | M | B: só o mock alimenta o bloco hoje | O adapter HTTP emite evento de raciocínio exibido no bloco | #301, existente, sem alteração | — |
| R-RUN-08 | Eventos estruturados e streaming nos adapters de CLI | Could | G | M: o Claude e o Cursor oferecem saída em fluxo (CL17, CU9) | Adapters traduzem comando, arquivo, raciocínio e plano; texto chega por fluxo; uso real propagado | #302, existente, ampliar: streaming incremental e eventos estruturados (linha dona; R-PRV-11 só referencia; passa por R-PRV-00) | R-PRV-00 |
| R-RUN-09 | Faixa de to-do do agente | Could | M | B: depende de #302 | A faixa reflete o plano do modelo com progresso | #303, existente, sem alteração | R-RUN-08 |
| R-RUN-10 | Medidor de contexto por conversa | Could | M | M: DeepSeek e Claude têm (DS19, CL10) | Com uso e capacidade conhecidos o anel mostra a proporção e o painel mostra "usado / capacidade"; sem capacidade conhecida mostra "desconhecido" e nunca zero (teste de componente) | #304, existente, sem alteração | — |
| R-CHT-01 | Notificações nativas | Should | P | M: Codex notifica fim de turno, permissão e pergunta (PM:B7) | Notificação nativa em fim de turno, aprovação e pergunta, configurável | #309, existente, sem alteração | — |
| R-CHT-02 | @-menção de arquivos | Could | M | M: PM:B5 | `@` lista arquivos do workspace e insere a referência | #307, existente, sem alteração | — |
| R-CHT-03 | Anexar arquivos e imagens | Could | M | M: PM:B6 | Anexos entram no prompt respeitando o provedor | #308, existente, sem alteração | — |
| R-CHT-04 | Buscar no conteúdo das conversas | Could | M | B: PM:B8 | Buscar uma palavra que só existe no corpo de uma mensagem lista a conversa que a contém, e buscar uma palavra ausente não lista nada (teste de componente) | #310, existente, sem alteração | — |
| R-CHT-05 | Pergunta lateral | Could | M | B: PM:B9 | Enviar uma pergunta lateral com a run ativa mostra a resposta numa área separada e não emite nenhum evento que altere o estado da run (teste de reducer) | #311, existente, sem alteração | — |
| R-CHT-06 | Meta de longa duração (`/goal`) | Could | G | B: PM:B10 | `/goal <texto>` fixa a meta, "pausar" impede o próximo turno automático e "retomar" o libera (teste de store) | #312, existente, sem alteração | — |
| R-CHT-07 | Tentar de novo e ramificar a partir de uma mensagem | Could | M | B: PM:B11 | "Tentar de novo" numa mensagem do usuário cria um turno novo com o mesmo texto, e "ramificar" cria uma conversa nova só com o histórico até aquela mensagem (teste de store) | #313, existente, sem alteração | — |
| R-CHT-08 | Instruções persistentes do workspace | Could | M | M: o Cursor lê AGENTS.md e CLAUDE.md (CU14) e o Codex gera AGENTS.md (CX6) | O chat lê AGENTS.md e CLAUDE.md do workspace e mostra a origem | #317, existente, ampliar: ler AGENTS.md e CLAUDE.md | — |
| R-TRN-01 | Revisão do diff com comentários inline e escopos | Could | G | M: PM:C5 | Um comentário ancorado numa linha do diff do turno é salvo com arquivo, linha e escopo (turno ou arquivo) e reaparece ao reabrir o diff (teste de API e de componente) | #314, existente, sem alteração | — |
| R-TRN-02 | Restaurar o workspace ao início de um turno | Could | G | M: Claude tem checkpoints (CL12) | Restaurar o workspace ao início do turno N devolve cada arquivo alterado por tools do broker ao conteúdo daquele instante, inclusive os alterados em turnos posteriores, e não toca em outros arquivos (teste com repositório temporário) | #315, existente, sem alteração | — |
| R-MCP-01 | Cliente MCP | Should | G | A: os quatro concorrentes têm (CL9, CX14, CU15, DS13) e o nó `mcp` do schema não executa | Servidor MCP configurado expõe ferramentas ao broker; a lista mostra estados (conectado, precisa autenticar, falhou); não vale para provedores de assinatura (I9) | #316, existente, ampliar: lista de estados por servidor | — |
| R-HOK-01 | Hooks pós-ferramenta e de fim de turno (observar, sem vetar) | Could | M | M: os quatro têm mais eventos que o veto (CL7, CX12, CU18) | Programa registrado roda após a tool e no fim do turno, sem poder alterar o resultado; erro vira evidência, não bloqueio | nova | — |
| R-SEC-01 | Spike e ADR: isolamento de SO para as tools do broker | Should | M | A: Codex e Cursor isolam (CX10, CU16) e o OHarness admite que não é sandbox (`exec.py`) | ADR compara opções por SO (inclusive Windows nativo) e define um corte mínimo; protótipo com teste de escape negado | nova | — |
| R-FAC-01 | Definição como código | Must | G | A: base da fábrica | Uma definição inválida é recusada com erro por campo, duas versões geram diff por campo, e reverter para a versão anterior restaura o estado anterior (teste de backend) | #256, existente, sem alteração | — |
| R-FAC-02 | Foreman e estágios com checkpoints | Must | G | A | Um work item só passa de triagem a plano e a implementação depois de aprovação humana registrada em cada checkpoint; sem aprovação o estágio seguinte não inicia e o foreman nunca executa merge (teste de backend) | #257, existente, sem alteração | R-FAC-01 |
| R-FAC-03 | Agentes padrão e custom, skills, MCPs e permissões por agente | Should | G | M | Um agente custom definido em arquivo com skills e lista de MCPs só chama as ferramentas dessa lista; a chamada fora dela é recusada e registrada (teste de backend) | #258, existente, sem alteração | R-FAC-01 |
| R-FAC-04 | Memória por agente | Should | M | M | Um fato gravado na memória de um agente numa run está disponível na run seguinte do mesmo agente e não aparece para outro agente (teste de backend) | #259, existente, sem alteração | R-FAC-03 |
| R-FAC-05 | Runner local e segredos da fábrica | Should | M | M | O runner local executa um work item num worktree, e o segredo da fábrica chega por referência opaca: o valor não aparece em log nem na definição (teste com valor canário) | #260, existente, sem alteração | R-FAC-01 |
| R-FAC-06 | Sala de controle (inclui automações) | Should | G | A: sem UI as automações do backend não são usáveis (CX15, CL13, DS17) | A tela lista runs ao vivo e históricas, work items e automações, e "executar agora" numa automação faz a run aparecer na lista após o evento de início (teste de componente) | #261, existente, ampliar: tela de automações | R-FAC-01 |
| R-FAC-07 | Métricas da fábrica | Should | M | M | Com registros de run fixos, a tela mostra vazão, custo e tempo de ciclo por período iguais aos valores calculados à mão no teste | #262, existente, sem alteração | R-FAC-06 |
| R-FAC-08 | Inbox de decisões humanas | Should | P | M | Toda aprovação humana pendente aparece na inbox e sai dela quando é aprovada ou recusada (teste de componente) | #263, existente, sem alteração | R-FAC-02 |
| R-FAC-09 | Scorers | Should | G | M | Um scorer determinístico aplicado a uma run de fixture registra nota e justificativa na run, e a mesma entrada produz a mesma nota (teste de backend) | #270, existente, sem alteração | R-FAC-07 |
| R-FAC-10 | Benchmarks | Could | G | B | Rodar o mesmo conjunto de casos em dois modelos ou harnesses, no modo mock, gera relatório comparativo por caso com resultado e custo, idêntico em duas execuções com os mesmos dados | #271, existente, sem alteração | R-FAC-09 |
| R-FAC-11 | Observers e auto-melhoria por PR | Could | G | B | Um observer que pontua uma fração configurada das runs abre uma proposta de melhoria como PR em rascunho, sem merge e sem push em branch protegida (teste com forge falso) | #272, existente, sem alteração | R-FAC-09 |
| R-FAC-12 | Verificação com computer use | Could | G | B | A verificação reproduz o passo de um bug em ambiente local e anexa a evidência ao work item; sem ambiente compatível termina como "não verificado", nunca como sucesso (teste com ambiente falso) | #273, existente, sem alteração | R-FAC-02 |
| R-FAC-13 | Modelos de fábrica por caso de uso | Could | M | B | Escolher o modelo de fábrica "triagem" cria uma fábrica com os agentes e estágios definidos para esse caso, e a definição criada passa na validação de R-FAC-01 (teste de backend) | #274, existente, sem alteração | R-FAC-02 |
| R-FAC-14 | Adaptador `FactoryPort` do pacote B | Should | M | M: liga backend entregue à fundação | `factory.port_adapter:build_port` implementado e testado | #332, existente, sem alteração | R-FAC-01 |
| R-WIN-01 | Bugs de Windows abertos | Should | M | A: o público inicial usa Windows (instalador NSIS, ADR 0001) | Corrigir #339, #341, #342, #343, #344, #346; CI com job Windows (#344) | #339, #341, #342, #343, #344, #346, existentes, sem alteração | — |
| R-UX-01 | i18n do restante do app, inclusive o texto de boas-vindas do chat | Should | M | M: o texto de boas-vindas está em inglês literal | Boas-vindas do chat pelo catálogo, en e pt-BR | #279, existente, ampliar: boas-vindas do chat | — |
| R-DOC-01 | Atualizar a matriz de paridade e o USAGE com as correções da seção 2 | Should | P | M: documentação desatualizada induz decisão errada | A matriz reflete D1, G1, G8 a G11, células DS, Flow e i18n; USAGE corrigido; termo antigo de permissão trocado por modos de permissão | nova | — |
| R-DX-01 | `oharness doctor` global | Could | M | M: Claude e Codex têm (CL19, CX20) | Relatório de versão, diretório de dados, sidecar, conexões e sandbox, sem segredos | nova | R-PRV-17 |

Contagem de 4: Must 2, Should 19, Could 20, total 41. Com os 27 de 3.4: Must 9, Should 35, Could 24, total 68.

## 5. O que não trazer

Alinhado a "tudo é harness" (`docs/GLOSSARY.md`) e à decisão da #244 (nada de agentes em nuvem nem execução hospedada).

| ID | Item | Por quê |
| --- | --- | --- |
| W-01 | Agentes na nuvem, execução hospedada, sessões remotas (PM:D4; Cloud Agents do Cursor, CU14) | Decisão da #244: tudo local ou em infraestrutura própria. |
| W-02 | Marketplace de plugins | Skills e MCP cobrem o caso; PM:E3. |
| W-03 | Funções de IDE: prévia do app, edição visual, terminal integrado, visualizador de artefatos | O OHarness não é um IDE; PM:F2, F3, F4. |
| W-04 | Computer use geral no chat | Só a verificação na fábrica (#273); PM:F1. |
| W-05 | Obter, guardar ou repassar credencial de assinatura: token OAuth, `setup-token`, ler ou copiar arquivos de sessão dos CLIs, login feito pelo app | Viola I1 e I2; é a base do "uso por assinatura". |
| W-06 | Medidor do uso ou limite do plano do vendor | Exigiria credencial ou API autenticada (I1); a doc dos concorrentes mostra isso só dentro do próprio produto (CL10, CU6). |
| W-07 | Assistente para Bedrock, Vertex, Azure e SSO corporativo de gateway | Fora do alpha; endpoint próprio genérico (R-PRV-14) cobre o caso simples. |
| W-08 | Importadores de configuração de outras ferramentas | Reavaliar depois de #316 e #317 (CL20, CU23). |
| W-09 | Copiar assets, textos, prompts ou nomes de marca de concorrentes | Os concorrentes são referência de comportamento; o desenho é próprio (a #244 já registra o mesmo para a Warp). |
| W-10 | BYOK com chave viajando por servidor de terceiro e roteador de modelo hospedado | A chave BYOK do Cursor viaja a cada requisição pelo backend dele (CU4, CU2) e o roteador de modelo é hospedado (CU3); aqui a chave não sai do cofre local. |

## 6. Riscos, segurança, licença e itens não verificáveis

### 6.1 Riscos

- **Mudança de CLI.** Os adapters dependem de flags e frases de status dos CLIs oficiais (ex.: o Codex responde o status em stderr). Uma atualização do vendor pode quebrar o probe; o contrato de R-PRV-00 e o teste `test_cli_details_and_free_text` são a defesa.
- **Termos de uso dos vendors sobre CLI chamado por terceiros: não verificada.** O desenho (invoca o CLI oficial, sem extrair nem repassar token) é o que reduz o risco; confirmar com os termos de cada vendor antes de divulgar.
- **Diagnóstico exportável** (R-PRV-07) é novo vetor de vazamento; exige teste canário e revisão de segurança independente.
- **Endpoints do usuário** (R-PRV-14): a chave vai para um host escolhido por quem usa; mostrar o host antes do envio, validar o formato e não seguir redirecionamento para outro host. Isso acompanha a prática do DeepSeek de recusar URL com credencial, query ou fragmento (DS5).
- **Lista de URLs permitidos do Tauri** (R-PRV-05): ampliar com URLs do catálogo, sempre por casamento exato; curinga reabriria o canal de exfiltração descrito no código.
- **Licença:** o repositório do DeepSeek é MIT (DS1), mas declara-se em preview, com releases só pré-lançamento e quebras esperadas; só o comportamento é referência, nunca texto, código ou prompts. Nenhum trecho de documentação foi copiado.
- **Guarda do cofre em modo arquivo** deriva a chave do caminho (ofuscação, não cofre): risco herdado, não tratado aqui.

### 6.2 Não verificada

Claude: telas e textos reais do Desktop e a versão instalada do Desktop; saída real de `/status`, `/model`, `/usage` e `/doctor` interativo (o login local está vencido, CL19); descoberta de modelos direto na API da Anthropic; local dos logs do Desktop; parte das páginas de erros, modelos, comandos, hooks, MCP, permissões, subagentes e Desktop foi lida só até o corte do leitor.

Codex: telas e textos do app; fluxo de primeira execução da CLI; janelas de limite de uso e aviso ao esgotar; páginas não lidas (sandbox do Windows, auto-review, regras, catálogos de modelos, SDK, permissões em beta); a referência de configuração foi lida só em parte; botão de teste de conexão no app não foi encontrado; custo em moeda por passo; códigos de saída do `exec` além de sucesso e falha; checkpoints (ausência não confirmada além do índice).

Cursor: o texto vem de resumo de página por modelo pequeno, logo é paráfrase; `--list-models`, `status` e `about` não foram executados; override de URL base no BYOK; precedência de configuração de MCP; detalhe de checkpoints e rewind; mensagens exatas de chave inválida e estados vazios de provedor; retries e rate limit; aviso antes do limite; custo por turno; como habilitar modelos ocultos; fluxo do subcomando `bedrock`; as páginas de uso e preços trouxeram nomes estranhos ao produto, então só a estrutura foi usada (reabrir no navegador antes de copiar qualquer UI).

DeepSeek: desktop instalado não inspecionado; custo em moeda por turno; revert de arquivos; teste de conexão (ausência inferida); JSON de resultado único no headless; a ordem exata das 4 fontes de credencial foi interpretada; os snapshots descrevem árvore de acessibilidade, não pixels.

OHarness: nada foi executado em runtime, só leitura de código, ADR e teste. Inferidos, a confirmar: F3 (links no app empacotado), F5 (efeitos do orçamento), F6 (Ollama Cloud), F8 (identificador do app e diretório de dados), atalho `.cmd` do `claude` no Windows, atualizador do app, limpeza e limite de worktrees, arquivos ignorados copiados para worktrees, e a cobertura de I5, I7, I12 e I13 por teste.

### 6.3 Divergências

- Versões da doc acima das instaladas: Claude (doc cita 2.1.290 a 2.1.305; instalada 2.1.289), Codex (0.166.0 e app 26.1029 mais novos que 0.154.0), DeepSeek (npm `latest` 0.2.1-rc.5 e master acima do 0.1.1-rc.2; as flags `--dump-config-schema` e `--from-default-profile` só aparecem no master). Recursos citados com "v2.1.2xx+" podem não existir na versão local.
- Cursor: o texto do `--help` diz que `-p` tem acesso a escrita e shell; a documentação de headless diz que, sem `--force`, só propõe mudanças. Divergência registrada, não resolvida.
- O login local do Claude está vencido; nenhum fluxo autenticado foi exercido ao vivo.
- Apps desktop não foram abertos; tudo que depende de UI real está marcado.

### 6.4 Decisões do dono

1. Aceitar conexões criadas pelo usuário no alpha (R-PRV-14, R-PRV-15) e chave de API da Anthropic/OpenAI (R-PRV-16).
2. Orçamento com assinatura: a proposta é mostrar só tokens e "desconhecido" (R-PRV-06). Mostrar um custo de assento informado pelo usuário só é possível com um ADR que altere I11, e a suíte de 3.5 muda no mesmo PR.
3. Sandbox de SO: priorizar o spike (R-SEC-01) no v0.0.2-alpha.
4. Auto-review por modelo (CL6, CX10, CU16) não está nos requisitos; decidir se interessa (conflita com política determinística fail-closed).
5. O que o modo "Auto" do OHarness faz hoje não foi inventariado; confirmar antes de comparar com o classificador dos concorrentes.
6. ADR 0047 segue "proposta, reversível"; confirmar (#291).
7. Rótulo "assinatura" do Ollama Cloud: manter ou trocar por "nuvem" (R-PRV-12).

## 7. Fontes

Data de leitura de todas: 2026-11-04 (a matriz de paridade, 2026-10-29).

| ID | Produto | URL ou comando | Data | Nota |
| --- | --- | --- | --- | --- |
| CL1 | Claude | https://code.claude.com/docs/en/authentication | 2026-11-04 | login, tipos de conta, precedência |
| CL2 | Claude | https://code.claude.com/docs/en/llm-gateway-connect | 2026-11-04 | gateway, teste manual, erros de gateway |
| CL3 | Claude | https://code.claude.com/docs/en/errors | 2026-11-04 | categorias de erro, retry |
| CL4 | Claude | https://code.claude.com/docs/en/model-config | 2026-11-04 | `/model`, aliases, fallback |
| CL5 | Claude | https://code.claude.com/docs/en/settings | 2026-11-04 | escopos e precedência |
| CL6 | Claude | https://code.claude.com/docs/en/permission-modes | 2026-11-04 | modos, auto mode, sandbox |
| CL7 | Claude | https://code.claude.com/docs/en/hooks | 2026-11-04 | eventos e tipos de hook |
| CL8 | Claude | https://code.claude.com/docs/en/sub-agents | 2026-11-04 | subagentes |
| CL9 | Claude | https://code.claude.com/docs/en/mcp | 2026-11-04 | MCP |
| CL10 | Claude | https://code.claude.com/docs/en/costs | 2026-11-04 | `/usage`, limites |
| CL11 | Claude | https://code.claude.com/docs/en/commands | 2026-11-04 | `/status`, `/doctor`, `/rewind` |
| CL12 | Claude | https://code.claude.com/docs/en/checkpointing | 2026-11-04 | checkpoints |
| CL13 | Claude | https://code.claude.com/docs/en/scheduled-tasks | 2026-11-04 | agendamento |
| CL14 | Claude | https://code.claude.com/docs/en/desktop | 2026-11-04 | app Desktop, terceiros |
| CL15 | Claude | https://code.claude.com/docs/en/desktop-quickstart | 2026-11-04 | onboarding, estados de erro |
| CL16 | Claude | https://code.claude.com/docs/en/setup | 2026-11-04 | instalação e atualização |
| CL17 | Claude | https://code.claude.com/docs/en/headless | 2026-11-04 | `-p`, JSON, `api_retry` |
| CL18 | Claude | https://code.claude.com/docs/en/third-party-integrations | 2026-11-04 | Bedrock, Vertex |
| CL19 | Claude | CLI: `claude --version`, `claude doctor`, `claude auth status` (2.1.289, 2026-11-04) | 2026-11-04 | login vencido nesta máquina |
| CL20 | Claude | CLI: `claude --help`, `claude auth --help`, `claude mcp --help` (2.1.289, 2026-11-04) | 2026-11-04 | flags e subcomandos |
| CX1 | Codex | https://learn.chatgpt.com/docs/auth | 2026-11-04 | login, credenciais |
| CX2 | Codex | https://learn.chatgpt.com/docs/quickstart.md | 2026-11-04 | onboarding do app |
| CX3 | Codex | https://learn.chatgpt.com/docs/config-file/config-reference.md | 2026-11-04 | lido em parte |
| CX4 | Codex | https://learn.chatgpt.com/docs/config-file/config-advanced | 2026-11-04 | provedores custom, camadas |
| CX5 | Codex | https://learn.chatgpt.com/docs/models.md | 2026-11-04 | modelos, API Responses |
| CX6 | Codex | https://learn.chatgpt.com/docs/developer-commands.md?surface=cli | 2026-11-04 | `/status`, `/usage`, `/init` |
| CX7 | Codex | https://learn.chatgpt.com/docs/reference/troubleshooting.md | 2026-11-04 | troubleshooting |
| CX8 | Codex | https://learn.chatgpt.com/docs/reference/settings.md | 2026-11-04 | configurações do app |
| CX9 | Codex | https://learn.chatgpt.com/docs/reference/commands.md | 2026-11-04 | atalhos |
| CX10 | Codex | https://learn.chatgpt.com/docs/agent-approvals-security.md | 2026-11-04 | sandbox, aprovação |
| CX11 | Codex | https://learn.chatgpt.com/docs/permission-modes.md | 2026-11-04 | modos no app |
| CX12 | Codex | https://learn.chatgpt.com/docs/hooks.md | 2026-11-04 | hooks |
| CX13 | Codex | https://learn.chatgpt.com/docs/agent-configuration/subagents.md | 2026-11-04 | subagentes |
| CX14 | Codex | https://learn.chatgpt.com/docs/extend/mcp.md | 2026-11-04 | MCP |
| CX15 | Codex | https://learn.chatgpt.com/docs/automations.md | 2026-11-04 | tarefas agendadas |
| CX16 | Codex | https://learn.chatgpt.com/docs/environments/git-worktrees.md | 2026-11-04 | worktrees, snapshot |
| CX17 | Codex | https://learn.chatgpt.com/docs/non-interactive-mode.md | 2026-11-04 | `codex exec` |
| CX18 | Codex | https://learn.chatgpt.com/docs/enterprise/usage-limits.md | 2026-11-04 | lacuna declarada |
| CX19 | Codex | https://learn.chatgpt.com/docs/llms.txt | 2026-11-04 | índice |
| CX20 | Codex | CLI: `codex --version`, `codex doctor`, `codex login status`, `codex features list` (0.154.0, 2026-11-04) | 2026-11-04 | diagnóstico local |
| CX21 | Codex | CLI: `codex --help`, `codex exec --help`, `codex sandbox --help`, `codex mcp --help` (0.154.0, 2026-11-04) | 2026-11-04 | flags |
| CU1 | Cursor | https://cursor.com/help/models-and-usage/available-models | 2026-11-04 | seletor, plano |
| CU2 | Cursor | https://cursor.com/docs/models-and-pricing | 2026-11-04 | preços e planos |
| CU3 | Cursor | https://cursor.com/docs/cursor-router | 2026-11-04 | Auto |
| CU4 | Cursor | https://cursor.com/docs/settings/api-keys | 2026-11-04 | BYOK |
| CU5 | Cursor | https://cursor.com/help/models-and-usage/api-keys | 2026-11-04 | BYOK, sem verificação |
| CU6 | Cursor | https://cursor.com/help/models-and-usage/usage-limits | 2026-11-04 | limites |
| CU7 | Cursor | https://cursor.com/help/troubleshooting/network | 2026-11-04 | diagnóstico de rede |
| CU8 | Cursor | https://cursor.com/help/troubleshooting/agent-issues | 2026-11-04 | erros do agente |
| CU9 | Cursor | https://cursor.com/docs/cli/reference/output-format | 2026-11-04 | formatos de saída |
| CU10 | Cursor | https://cursor.com/docs/cli/headless | 2026-11-04 | headless |
| CU11 | Cursor | https://cursor.com/docs/cli/reference/authentication | 2026-11-04 | login da CLI |
| CU12 | Cursor | https://cursor.com/docs/cli/reference/configuration | 2026-11-04 | config da CLI |
| CU13 | Cursor | https://cursor.com/docs/rules | 2026-11-04 | regras |
| CU14 | Cursor | https://cursor.com/docs/cli/using | 2026-11-04 | uso da CLI, AGENTS.md |
| CU15 | Cursor | https://cursor.com/docs/mcp | 2026-11-04 | MCP |
| CU16 | Cursor | https://cursor.com/docs/agent/security/run-modes | 2026-11-04 | modos e sandbox |
| CU17 | Cursor | https://cursor.com/docs/cli/reference/permissions | 2026-11-04 | permissões da CLI |
| CU18 | Cursor | https://cursor.com/docs/hooks | 2026-11-04 | hooks |
| CU19 | Cursor | https://cursor.com/docs/subagents | 2026-11-04 | subagentes |
| CU20 | Cursor | https://cursor.com/docs/configuration/worktrees | 2026-11-04 | worktrees |
| CU21 | Cursor | https://cursor.com/docs/get-started/quickstart | 2026-11-04 | primeiro uso |
| CU22 | Cursor | https://cursor.com/docs/cli/overview | 2026-11-04 | instalação da CLI |
| CU23 | Cursor | https://cursor.com/help/getting-started/migrate-vscode | 2026-11-04 | importar do VS Code |
| CU24 | Cursor | https://cursor.com/llms.txt | 2026-11-04 | índice |
| CU25 | Cursor | CLI: `cursor-agent --help`, `models --help`, `mcp --help`, `update --help` (2026.10.01, 2026-11-04) | 2026-11-04 | comandos e flags |
| DS1 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness (README.md, branch master) e https://deepseek.com/harness | 2026-11-04 | produto, licença MIT, preview |
| DS2 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md | 2026-11-04 | desktop |
| DS3 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md | 2026-11-04 | provedores |
| DS4 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek-api-key/README.md | 2026-11-04 | chave e listagem de modelos |
| DS5 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md | 2026-11-04 | endpoint, erros, raciocínio |
| DS6 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/web/tests/expected | 2026-11-04 | snapshots de UI |
| DS7 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md | 2026-11-04 | CLI e perfis |
| DS8 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md | 2026-11-04 | onboarding |
| DS9 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek-account/README.md | 2026-11-04 | login de conta |
| DS10 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/approval.md e SAFETY.md | 2026-11-04 | aprovação e aviso de segurança |
| DS11 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/hook-protocol/README.md | 2026-11-04 | hooks experimentais |
| DS12 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-subagent/README.md | 2026-11-04 | subagentes |
| DS13 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md | 2026-11-04 | MCP |
| DS14 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/README.md | 2026-11-04 | tokens, TTFT |
| DS15 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/deliverables/workspace-changes/README.md | 2026-11-04 | diff por turno, fork |
| DS16 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/tool-worktree/README.md | 2026-11-04 | worktrees experimentais |
| DS17 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/schedule.md | 2026-11-04 | automações |
| DS18 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plan/README.md | 2026-11-04 | modo plano |
| DS19 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md | 2026-11-04 | compactação, medidor |
| DS20 | DeepSeek | CLI: `dsh --version`, `dsh --help` (0.1.1-rc.2, 2026-11-04); `npm view @deepseek-ai/dsh` | 2026-11-04 | versões publicadas |
| DS21 | DeepSeek | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md | 2026-11-04 | SDK (existência) |
| PM | OHarness | `docs/product/parity-matrix.md` (base 72045e6) | 2026-10-29 | linhas A..G |

Fontes internas do OHarness (leitura de código na `main` @ 008472d):

| ID | Fonte | Uso |
| --- | --- | --- |
| IN1 | `backend/adapters/catalog.py`, `frontend/src/components/providers/catalog.ts`, `providerStore.ts` | catálogo, conexões, modelos |
| IN2 | `backend/providers/resolution.py`, `backend/providers/outcomes.py` | resolução sem chave, falhas |
| IN3 | `backend/adapters/cli_shared.py`, `cli_claude.py`, `cli_codex.py`, `cli_cursor.py` | invariantes I3 a I9, I12 |
| IN4 | `backend/usage_tracking.py`, `backend/engine.py` | ledger, orçamento, failover |
| IN5 | `src-tauri/src/lib.rs` | lista de URLs permitidos e variáveis do app |
| IN6 | `backend/tests/test_cli_adapters.py`, `test_probe_detail_contract.py`, `test_provider_resolution.py`, `test_budget_fixes.py` e demais listados em 3.5 | suíte de não-regressão |
| IN7 | ADR 0001, 0002, 0009, 0013 a 0019, 0021 a 0027, 0035, 0040 a 0047, 0053 a 0066 | decisões citadas nas células |
| IN8 | `docs/product/provider-harness-rule.md`, `docs/GLOSSARY.md`, `docs/process/backlog.md`, `docs/process/pre-pr-checklist.md` | regras de produto e de processo |
| IN9 | `backend/sandbox/exec.py`, `backend/sandbox/permission_modes.json` | modos de permissão, ausência de sandbox de SO |
