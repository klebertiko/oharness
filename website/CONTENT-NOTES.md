# Revisão de conteúdo com evidências — 22/10/2026 (v0.0.1-alpha)

Escopo: `index.html`, `model.html`, `manifesto.html`, `MANIFESTO.md` e `locales/en-US.json`. Base: branch `docs/site-real-screenshots` com `origin/main` mesclada (c8f4d3a: inclui o redesenho das telas #141, a renomeação da marca para OHarness #144, o Biome #119 e as correções #142, #143 e #146; as capturas seguem sendo da main em 944a5bb). Nada aqui certifica uma release: nenhuma tag rodou `release.yml` de ponta a ponta, e a página `releases/tag/v0.0.1-alpha` só abre depois que a release rascunho for publicada. Regra de cópia: `CONTEXT.md` ("Copy standard"). As notas anteriores, mais abaixo, ficam como histórico; onde divergem desta seção, vale esta.

## Afirmações e fontes

| Onde | Afirmação | Fonte | Estado |
| --- | --- | --- | --- |
| index, hero | O app tem Chats, Studio e Providers; o Nilo rascunha harnesses no Studio e responde nos Chats | `README.md` "Product surfaces", "Nilo in Studio"; capturas `chats-*`, `studio-*`, `providers-*` | Verificado |
| index, hero e Baixar | Versão 0.0.1-alpha | `website/package.json`, `src-tauri/tauri.conf.json`, `package.json` (job `validate-version` em `release.yml`) | Verificado |
| index, diagrama | Agente (papel, instruções, provedores opcionais), Skill, Gate (checkpoint com critérios, PASS/FAIL), HITL (autoridade humana) | `CONTEXT.md` Language; `frontend/src/lib/templates.ts` (NODE_TEMPLATES) | Verificado |
| index, capturas | Chats: modos Ask/Auto/Plan, seletor de harness, aviso "Connect a provider to send" | Captura `chats-*`; `docs/release-notes/v0.0.1-alpha.md` (modos por chat); commit c95e8f | Verificado |
| index, capturas | Studio: "Describe the harness you want", New harness, Open .ohm, Draft with Nilo, Your harnesses, Starting points com 4 harnesses incluídos | Captura `studio-*`; `frontend/src/components/studio/StudioOverview.tsx` | Verificado |
| index, capturas | Canvas: Agile Harness com 9 nós e 9 conexões, organizado com Shift+L, selo "1 not wired" com a linha "TW dead end" (a UI redesenhada trocou "1 unwired") | Captura `canvas-*` (barra de estado "graph 9n · 9e"); `frontend/src/components/canvas/arrangeChord.test.ts` (Shift+L); ADR 0007 | Verificado |
| index, capturas | Execução: harness "Agent + review" em mock, Implementer e Review Gate concluídos, HITL retido (approve/reject), nenhum provedor chamado | Captura `run-*`; `backend/engine.py` (`awaiting_human`, `reject`) | Verificado |
| index, capturas | Providers: 6 conexões, nenhuma conectada; gasto estimado; chave do OpenRouter não é mostrada de novo | Captura `providers-*` ("never shown again", "costs are estimates, not invoices") | Verificado |
| index, legenda | As capturas vêm do app 0.0.1-alpha (main em 944a5bb), em perfil isolado, sem provedor, execução simulada, interface em inglês | Informado por quem fez as capturas (commits ed61e9b e c1999fd); visível nas imagens (marca OHarness, modos Mock/Connected, rodapé "Engine connected") | Verificado nas imagens |
| index, harnesses | Quatro harnesses incluídos: Agent + review e os três do backend | `frontend/src/lib/templates.ts`; `backend/oharness/examples.py` (3 itens); captura `studio-*` | Verificado. O texto anterior dizia "três" |
| index, harnesses | Abrir um harness incluído cria cópia editável; o original não muda | `CONTEXT.md` "Bundled harness"; `README.md` "Studio files" | Verificado |
| index, harnesses | Nenhum traz provedor definido nem credenciais | `README.md` (DeepSeek e Matt Pocock "set no provider and ship no secrets"); capturas (nós "no provider call"; Agent + review "configured for mock runs") | Verificado |
| index, harnesses | Descrições do DeepSeek Harness e do Matt Pocock skills | `manifest.description` em `backend/oharness/fixtures/deepseek-harness.ohm` e `mattpocock-skills.ohm` | Verificado, texto traduzido |
| index, harnesses | Provedores: Anthropic e OpenAI por CLI local, OpenRouter por chave, Ollama local/nuvem, Cursor só para agentes | `README.md` "Providers" | Verificado |
| index, modelo | Estrutura `manifest + graph`, `content`, `runtime + validation` | `backend/oharness/schema/oharness.schema.json`; `examples/hello.ohm` | Verificado |
| index e model | YAML 1.2 é decisão adotada; o Studio ainda lê e grava JSON; harnesses incluídos, codec e CLI usam YAML | ADR 0003; `frontend/src/lib/studio.ts` (`JSON.parse` na importação); `frontend/src/lib/bundlesApi.ts` (`JSON.stringify(bundle, null, 2)` na exportação); `backend/oharness/validate.py` (`validate_path` via codec); `docs/product/ohm-yaml-migration.md` | Verificado. Migração NÃO implementada no desktop |
| model | Validação: JSON Schema, depois ids de nó não vazios e únicos e arestas apontando para nós existentes, depois modelo Pydantic | `backend/oharness/validate.py` (`validate_dict`, `_graph_errors`) | Verificado |
| model | A simulação ordena o grafo topologicamente e não chama modelos; ciclo pode passar na validação e falhar na simulação; grafos com ciclo não são executáveis | `backend/oharness/mock_run.py`; `backend/engine.py`; `docs/product/ohm-yaml-migration.md` P2 | Verificado |
| model | HITL pausa a execução; rejeitar interrompe | `backend/engine.py` (`control.phase = "awaiting_human"`, `decision == "reject"`) | Verificado (recurso do motor do app) |
| model | CLI: `python -m oharness validate <arquivo>` aceita YAML e JSON | `README.md` "OHarness Model"; docstring de `validate_path` | Verificado |
| model | Laya: classificador local experimental, processo separado em loopback, consultivo; 0,80 de confiança; nó de decisão é só evidência; modo shadow na CI | `README.md` "Providers" (Experimental: Laya); ADR 0005 e 0006; `docs/ci-security.md` (`ENABLE_LAYA_SHADOW`) | Verificado (experimental) |
| model | OHM é proposta do projeto, sem padrão independente, sem governança formal nem adoção externa | Ausência de evidência em contrário; `CONTEXT.md`; notas anteriores desta pasta | Declaração de limite |
| Baixar | Link da etiqueta `releases/tag/v0.0.1-alpha`; pré-lançamentos nunca aparecem em `/releases/latest` | `docs/ci-security.md` (seção Releases); `release.yml` (`gh release create --prerelease`) | Verificado. O link abre só após a publicação |
| Baixar | Nomes dos arquivos: `OHarness-windows-x64-setup.exe`, `OHarness-macos-arm64.dmg`, `OHarness-macos-x64.dmg`, `OHarness-linux-x86_64.AppImage`, `OHarness-linux-amd64.deb`, `SHA256SUMS` | `release.yml` (job `attest-and-release`, lista `expected`) | Verificado no workflow; nenhum foi publicado |
| Baixar | Instaladores sem assinatura; SmartScreen "Windows protected your PC", More info, Run anyway | `release.yml` (linha de status do Windows); `docs/ci-security.md` "What users see while a platform is unsigned" | Verificado. Assina só se os segredos do ambiente `release` (existe, protegido: revisor klebertiko, só tags `v*`) existirem |
| Baixar | macOS: só assinatura ad hoc, sem notarização; Gatekeeper bloqueia; Open Anyway | `release.yml` (build macOS sem segredos usa `signingIdentity: "-"`) | Verificado |
| Baixar | Linux: AppImage com assinatura GPG só se configurada; .deb sem assinatura própria; glibc 2.35+ (Ubuntu 22.04+, Debian 12+) | `release.yml` (matriz `ubuntu-22.04`, passo de status do Linux); `docs/ci-security.md` Code signing | Verificado |
| Baixar | Comandos `sha256sum --check --ignore-missing SHA256SUMS` e `gh attestation verify <arquivo> --repo klebertiko/oharness` | `release.yml` ("Write release notes"); `docs/ci-security.md` | Verificado |
| Baixar | A atestação prova a origem e não substitui assinatura de editor | `docs/ci-security.md` ("GitHub attestations prove where an artifact came from") | Verificado |
| Baixar, limites | Só o Windows tem smoke da janela; Linux e macOS só têm smoke do sidecar | `release.yml` ("Smoke desktop app" só em `build-windows`; "Smoke packaged sidecar" nos dois jobs) | Verificado |
| Baixar, limites | O app não verifica a versão do WebView ao abrir e o instalador não impõe mínimo (declaração macOS/.deb no PR #167); renderização varia por plataforma | `docs/adr/0001-desktop-packaging.md` ("Rendering varies by platform", "Follow-up"); nenhum mínimo em `src-tauri/tauri.conf.json` (bloco `bundle` só tem `windows.nsis`, sem `macOS` nem `linux`); PR klebertiko/oharness#167 (aberto em 24/10/2026, `gh pr view 167`) | V (ausência hoje); #167 aberto |
| Requisitos, aviso | Tailwind CSS 4 exige Chrome 111, Safari 16.4, Firefox 128; motivo `@property` e `color-mix()`; abaixo disso "will not work in older browsers" | https://tailwindcss.com/docs/compatibility ; https://tailwindcss.com/docs/upgrade-guide (Browser requirements) | V |
| Requisitos, aviso | Piso por navegador: Chrome 111 vem de `color-mix()`; Safari 16.4 e Firefox 128 vêm de `@property` | MDN browser-compat-data `css/at-rules/property.json` (chrome 85, firefox 128, safari 16.4) e `css/types/color.json` (`color-mix`: chrome 111, firefox 113, safari 16.2) | V (derivação; Edge herdado do Chromium) |
| Requisitos, aviso | O app usa Tailwind 4 (migração no PR #120) | `frontend/package.json` ainda tem `tailwindcss ^3.4.17` e `globals.css` usa `@tailwind base` neste worktree; `gh pr view 120`: OPEN em 24/10/2026 | Pendente: o texto vale quando o #120 entrar; revisar antes da tag |
| Requisitos, aviso | Sem aviso no app abaixo do mínimo (macOS/Linux usam o WebView do sistema) | Ausência de checagem em `src-tauri/`; https://v2.tauri.app/reference/webview-versions/ (WebKit é componente do sistema) | V (ausência) / efeito visual exato da interface quebrada não foi capturado em WebView antigo: NV |
| Requisitos, Windows | Windows 10 (1803+) e 11 já trazem WebView2; Windows 11 inclui o Evergreen | https://v2.tauri.app/start/prerequisites/ ; https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution | V |
| Requisitos, Windows | Instalador NSIS baixa o bootstrapper do WebView2 se faltar; precisa de internet nesse caso | `src-tauri/tauri.conf.json:38,52-57` (sem `webviewInstallMode`, padrão `downloadBootstrapper`); https://v2.tauri.app/distribute/windows-installer/ | V |
| Requisitos, Windows | Só x64; sem ARM | `.github/workflows/release.yml:113-118,171-175,305` (`OHarness-windows-x64-setup.exe`, alvo `x86_64-pc-windows-msvc`) | V |
| Requisitos, Windows | Windows 7/8/8.1 ficam abaixo do piso: suporte do Edge/WebView2 acabou na versão 109 | https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems ("Recent changes") | V |
| Requisitos, macOS | macOS 13.3+ é o piso defensável; 13.0 a 13.2 trazem Safari 16.1 a 16.3, sem `@property` | Derivação: `@property` entra no Safari 16.4 (BCD); "13.3 traz o Safari 16.4" vem de https://eclecticlight.co/2023/03/27/apple-has-released-updates-to-ventura-13-3-monterey-12-6-4-and-big-sur-11-7-5/ | P (a Apple não afirma literalmente 13.3 = Safari 16.4) |
| Requisitos, macOS | Dois instaladores nativos (arm64 e x64), não universal | `release.yml:353-360,552-559,619-620` (`macos-15` aarch64, `macos-15-intel` x86_64; bundles `app,dmg`) | V |
| Requisitos, macOS | Hoje o instalador declara `LSMinimumSystemVersion` 10.13 (padrão do Tauri); a declaração de 13.3 está no PR #167 e só vale depois dele | `src-tauri/tauri.conf.json` sem `bundle.macOS.minimumSystemVersion`; https://v2.tauri.app/reference/config/ (padrão `10.13`); `gh pr view 167` | V (padrão); #167 aberto |
| Requisitos, macOS | Comportamento do WKWebView em macOS 12 com Safari 16.4 instalado à mão; `minos` real dos binários (sidecar PyInstaller); comportamento exato do macOS abaixo de `LSMinimumSystemVersion` | Pesquisa em `C:Users<user>AppDataLocalTempohcapequirements-research.md` (seções 3 e "NÃO foi possível verificar"); `release.yml:436-452` não fixa `MACOSX_DEPLOYMENT_TARGET` | NV (declarado como não verificado) |
| Requisitos, Linux | Tauri v2 usa WebKitGTK 4.1; `.deb` depende de `libwebkit2gtk-4.1-0` sem versão (antes do #167) | https://v2.tauri.app/start/prerequisites/ ; https://v2.tauri.app/distribute/debian/ ; `src-tauri/tauri.conf.json` sem `bundle.linux` | V |
| Requisitos, Linux | glibc 2.35+ (Ubuntu 22.04+, Debian 12+, Fedora 36+); só x86_64 | `release.yml:336-346,368-374,534-535` (runner `ubuntu-22.04`; comentário do arquivo) | V (o comentário do workflow); versão de WebKitGTK do Fedora 36: NV |
| Requisitos, Linux | WebKitGTK 2.40+ como piso | 2.40.0 saiu em 17/03/2023 e o código da tag já contém `CSSPropertyRule.h` (https://webkitgtk.org/2023/03/17/webkitgtk2.40.0-released.html; GitHub WebKit tag e095884e); não há tabela oficial 2.40 = Safari 16.4 | NV (piso plausível; equivalência e flag `@property` por padrão não provadas) |
| Requisitos, Linux | Ubuntu 22.04 sem atualizações: 2.36; com atualizações: 2.50.4; Ubuntu 24.04: 2.44 (2.52.6 com atualizações); Debian 12: 2.50.6; Fedora 42: 2.52.3 | https://launchpad.net/ubuntu/+source/webkit2gtk ; https://tracker.debian.org/pkg/webkit2gtk ; https://bodhi.fedoraproject.org/updates/?packages=webkitgtk (consultados em 24/10/2026) | V (instantâneo de 24/10/2026) |
| Requisitos, Linux | `.deb` depois do #167 terá `(>= 2.40)`; AppImage leva o WebKit do runner de build | `gh pr view 167`; https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/linux/appimage/mod.rs (linhas ~135-141) | NV (efeito no `.deb` gerado e conteúdo do AppImage não inspecionados; AppImage P pelo código do bundler) |
| Requisitos, verificação | Link da tag (nunca `/latest`) e comandos `sha256sum --check --ignore-missing SHA256SUMS` e `gh attestation verify <arquivo> --repo klebertiko/oharness` | Mesmas fontes das linhas de Baixar (`release.yml` "Write release notes"; `docs/ci-security.md`) | V |
| Baixar, limites | App instalado: banco e segredos na pasta de dados local do app, nomeada com o identificador (`%LOCALAPPDATA%\dev.oharness.app` no Windows; macOS e Linux usam a pasta equivalente, sem caminho citado) | `src-tauri/src/lib.rs` (`spawn_sidecar`: `OH_DATA_DIR` = `app_local_data_dir()`); `src-tauri/tauri.conf.json` (`identifier`); `backend/sidecar_entry.py` (`_data_dir`, `OH_SECRETS_DIR`) | Verificado no código. `%LOCALAPPDATA%\OHarness` e `~/OHarness` só valem para o sidecar executado sozinho, sem `OH_DATA_DIR` |
| Baixar, limites | Comandos do chat passam por um broker com contenção de caminho e aprovação por ação; NÃO é isolamento de SO | ADR 0004 ("Exec não é sandbox de SO") | Verificado. A palavra "sandbox" não é usada como promessa |
| Baixar, limites | Sem atualização automática; sem matriz de testes com provedores reais por SO | `docs/release-notes/v0.0.1-alpha.md` ("What is NOT in 0.0.1-alpha") | Verificado no rascunho de notas |
| Baixar, limites | Licença: pré-visualização pública, código disponível para avaliação, termos de redistribuição não definidos | `README.md` "License" | Verificado |
| index, Nilo | Estados do Nilo: idle, thinking, working, waiting, success, error, sleeping | `frontend/src/components/brand/NiloSprite.tsx` (`NiloState`) | Verificado. A cena do site é demonstrativa |
| manifesto | Os seis princípios e o parágrafo sobre YAML | Texto original do manifesto; o parágrafo técnico foi atualizado para o estado real (JSON no Studio, ciclos não executáveis) | Princípios são aspirações, e a página diz isso |

## Removido ou reescrito, e por quê

- **Marca**: OpenHarness virou OHarness (#144). Nomes de instaladores `OHarness-*`, repositório `klebertiko/oharness`, dados do app instalado em `%LOCALAPPDATA%\dev.oharness.app` (identificador Tauri novo; a pasta antiga `%LOCALAPPDATA%\dev.openharness.app` não é migrada e a chave do arquivo de segredos deriva do caminho, então chaves antigas precisam ser digitadas de novo), "Open Harness Model" virou "OHarness Model", e o seletor de tema usa `oharness-website-theme`. Fontes: `git show 4cdc868`, `CONTEXT.md`, `.github/workflows/release.yml`, `backend/sidecar_entry.py`. O repositório já foi renomeado no GitHub para `klebertiko/oharness` e o Pages está em `https://klebertiko.github.io/oharness/`; só o link da etiqueta `v0.0.1-alpha` segue em 404 até a release ser publicada.
- **Captura de setembro** e as capturas Automate e Pull requests: essas seções não existem mais (`README.md` "Removed", PR #31). Substituídas por cinco capturas reais.
- **"Três harnesses"**: o app lista quatro (Agent + review é definido no frontend).
- **"Desktop em desenvolvimento / Modelo aberto por princípio"** e **"O desktop está em desenvolvimento. Por enquanto, explore o modelo"**: trocados por pré-lançamento 0.0.1-alpha e Baixar. "Aberto" não tem respaldo de licença (`README.md` "License": código disponível para avaliação).
- **"Agente tem um provedor"**: o vínculo é opcional (`CONTEXT.md`). **"checkpoints"**: trocado por "gates" e "pontos de verificação"; não há recurso de checkpoints no app.
- **Quatro níveis de validação; gates determinísticos de assinaturas, budgets e release; treinamento da Laya; promoção futura da Laya; campo `system_one_evaluator`**: sem evidência no app (política de CI ou conceito interno). Substituídos pelo que `validate.py`, `mock_run.py` e `engine.py` fazem.
- **"Governança aberta e independente"**: virou declaração explícita de que não há padrão independente, governança formal nem adoção externa.
- **"O desktop está migrando de JSON"** e **"a mudança preservará a leitura de documentos anteriores"**: reescritos para o estado real; a promessa de futuro saiu.
- **"Documentação inicial · setembro de 2026"** e a data no manifesto: trocadas pela versão. **"Exemplo"**: trocado por "documento mínimo" nas páginas e em `examples/hello.ohm` (`description`), para não confundir com "example harness".
- **Nome do projeto skills-framework**: omitido do texto público do Agile Harness (a palavra "framework" não aparece); mantido "adaptado da skill engineering/harness".

## Pendências conhecidas

- Os links de download só funcionam após a publicação da release. Nenhuma tag rodou `release.yml` de ponta a ponta: confira nomes de arquivo e estado de assinatura no rascunho antes de publicar.
- O `README.md` raiz tinha badges desatualizados (Windows apenas; `.ohm` YAML, enquanto o Studio usa JSON); as referências às capturas foram atualizadas para `canvas-light.webp` e `chats-light.webp`. Os badges não foram alterados.
- O gerador (`scripts/build-locales.mjs`) continua emitindo comentários `nosemgrep` de integridade nos metadados canonical e hreflang (comportamento anterior, não novo).

---

# Atualização após a decisão YAML — 11/09/2026

O usuário aprovou YAML 1.2 como sintaxe dos arquivos `.ohm`, mantendo JSON nas APIs e importação dos documentos JSON anteriores. A página e o exemplo foram atualizados com indicação explícita de suporte desktop em migração. Os achados abaixo registram a implementação JSON consultada antes dessa decisão; não foram convertidos em alegações de suporte YAML já entregue. A validação do exemplo YAML é feita após parsing contra o schema atual, separada do leitor de arquivos do desktop.

Decisão: `../docs/adr/0003-ohm-yaml.md`. Plano: `../docs/product/ohm-yaml-migration.md`.

# Notas de conteúdo — OHarness Model

Base editorial verificada no checkout local em 11/09/2026, com alterações em andamento. Estas notas descrevem o código consultado; não certificam uma versão publicada. O [manifesto](D:/Development/src/OHarness/website/MANIFESTO.md) distingue princípios desejados das funções existentes.

## Nome, propósito e estado da documentação

**OHarness Model (OHM)** é o nome do modelo; **`.ohm`** é a extensão canônica. O vocabulário do produto reúne Agent, Gate, HITL, Skill e Signal. McpServer e Tool são Connections; os vínculos com Providers pertencem à composição. Essa descrição conceitual não equivale a um contrato completo de execução ou a campos próprios no schema atual.

Fontes: [CONTEXT.md](D:/Development/src/OHarness/CONTEXT.md) e [ADR 0002](D:/Development/src/OHarness/docs/adr/0002-ohm-model.md).

A migração de nomenclatura está incompleta. [README da especificação](D:/Development/src/OHarness/docs/harness-spec/README.md) e [HELLO.md](D:/Development/src/OHarness/docs/harness-spec/HELLO.md) ainda descrevem `.oharness` e apontam para a antiga fixture. A rota de modelo padrão já lê [default-agile.ohm](D:/Development/src/OHarness/backend/oharness/fixtures/default-agile.ohm), conforme [bundles.py](D:/Development/src/OHarness/backend/routers/bundles.py). Usar `.ohm` na página e tratar `.oharness` como legado legível durante a migração.

## Arquivo e schema reais

O arquivo é **um único documento JSON UTF-8**. “Bundle” designa esse documento com conteúdo incorporado. No caminho de leitura/exportação consultado, não há contêiner ZIP, diretório interno ou arquivo `manifest.json` separado: `manifest` é um objeto do próprio JSON.

Evidências: `validate_path` lê texto e usa `json.loads` em [validate.py](D:/Development/src/OHarness/backend/oharness/validate.py); `downloadOHarness` serializa JSON indentado como `application/json` e usa `.ohm` por padrão em [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts). A [biblioteca de harnesses](D:/Development/src/OHarness/frontend/src/components/harnesses/HarnessLibrary.tsx) aceita `.ohm`, `.oharness` e JSON, faz parse e chama a validação antes de importar. A extensão, sozinha, não atesta validade.

O contrato estrutural está em [oharness.schema.json](D:/Development/src/OHarness/backend/oharness/schema/oharness.schema.json), usando JSON Schema Draft 2020-12. [models.py](D:/Development/src/OHarness/backend/oharness/models.py) define os modelos Pydantic e `SCHEMA_VERSION = "1.0.0"`.

| Campo obrigatório na raiz | Estrutura exigida pelo JSON Schema |
| --- | --- |
| `schemaVersion` | String. |
| `manifest` | `id`, `name`, `version`, `description`, `license`: strings; `tags`: lista de strings. |
| `graph` | Listas `nodes` e `edges`; ambas podem estar vazias. |
| `content` | Mapas `prompts`, `agents`, `skills`, `hooks`, `commands`, `scripts`; podem estar vazios. |
| `runtime` | `preferred`: string; `cli`: string ou null; `env` e `secrets`: listas. |
| `validation` | `mockProfile`: string. |

A raiz e esses objetos estruturais rejeitam propriedades adicionais. O interior dos nós, arestas, mapas de conteúdo e listas de runtime permanece amplamente livre: os modelos usam `Any`, e o schema não descreve uma estrutura detalhada para esses elementos. Não há campos de raiz `connectors` ou `providers`; não inventar um exemplo que os acrescente.

Os modelos Pydantic oferecem valores padrão para vários campos que o JSON Schema exige explicitamente. A validação pública aplica primeiro o JSON Schema, depois as regras do grafo e o modelo Pydantic. Conseguir construir um objeto Pydantic não substitui esse caminho de validação.

## Validação e limites

Em [validate.py](D:/Development/src/OHarness/backend/oharness/validate.py), a validação adicional exige nós com IDs textuais não vazios e únicos e arestas cujas origens e destinos existam. Ela não verifica integralmente tipos do catálogo, Signals, permissões, disponibilidade de Providers ou comportamento dos conteúdos incorporados.

`schemaVersion` e `manifest.version` não têm restrição semântica de versão no schema. O validador não compara `schemaVersion` à constante do backend. Há ainda uma divergência concreta: `composeBundleFromCanvas`, em [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts), cria uma base com `schemaVersion: "1.1.0"` quando não recebe modelo base, enquanto backend e fixture usam `1.0.0`. Isso não comprova a existência de um segundo schema implementado.

O [mock](D:/Development/src/OHarness/backend/oharness/mock_run.py) ordena o grafo topologicamente, marca etapas planejadas e sinaliza como ignoradas as que não entram nessa ordem. Não chama modelos nem executa o conteúdo incorporado; `mockProfile` não seleciona comportamentos nessa função. Um ciclo pode passar na validação estrutural e falhar no mock.

Verificações realizadas em memória, sem alterar as fontes: a fixture `.ohm` e o exemplo legado [valid-hello.oharness](D:/Development/src/OHarness/backend/tests/oharness/fixtures/valid-hello.oharness) passaram na validação; uma versão arbitrária também passou; um grafo cíclico passou no validador e retornou `ok: false` no mock. Não foi realizada uma homologação completa do produto.

## Portabilidade e autoridade humana

A exportação de arquivo está implementada. Porém, `composeBundleFromCanvas` reduz nós a `id`, `role`, `label` e arestas a `id`, `source`, `target`. Nessa conversão, dados adicionais do canvas, como vínculos de Providers, configuração de nós e Signals nas arestas, não são preservados. Portanto, não anunciar fidelidade integral de ida e volta nem execução equivalente em qualquer ambiente. Fonte: [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts).

Há pausa para nós `hitl` no [engine.py](D:/Development/src/OHarness/backend/engine.py): o estado passa a `awaiting_human`, o motor aguarda liberação e uma decisão `reject` interrompe a execução. O endpoint de [controle da execução](D:/Development/src/OHarness/backend/routers/execution.py) permite parar e retomar. Contudo, a retomada sem decisão explícita assume `approve` no motor. Descrever como ponto de intervenção implementado; não prometer aprovação humana explícita obrigatória para toda ação ou autoridade garantida por qualquer consumidor do arquivo.

A fixture atual inclui HITL. Já o [compilador do harness](D:/Development/src/OHarness/backend/oharness/compile_skills_harness.py) ainda o omite do grafo que gera, mantendo os oito papéis de agentes. Os dois artefatos não estão totalmente alinhados.

## Critérios para a página

- **Fato sustentado:** representação JSON, conteúdo incorporado, importação/exportação nos caminhos descritos, validação estrutural, planejamento simulado e pausa HITL com os limites acima.
- **Valor ou aspiração:** abertura à inspeção e evolução, legibilidade, portabilidade entre ambientes, clareza das conexões e autoridade humana. Usar “defendemos”, “queremos” ou “nosso horizonte”.
- **Sem respaldo para anúncio:** licença open source do produto, governança formal, adoção, métricas, compatibilidade universal, lançamento ou disponibilidade de instalador. O campo `manifest.license`, inclusive o valor `MIT` presente na fixture e no código de composição, é metadado do documento e não comprova a licença do projeto. Exportar um `.ohm` não equivale a oferecer download de instalador.
- Não apresentar MCP como compatibilidade certificada ou endosso. O vocabulário arquitetural e a inspiração no protocolo, isoladamente, não comprovam conexões operacionais em qualquer ambiente.

## Inspirações, sem reprodução

A ideia de dar ao contexto um lugar legível foi inspirada em [AGENTS.md](https://agents.md/). A atenção às conexões entre aplicações de IA, ferramentas e fontes de dados vem da [introdução ao MCP](https://modelcontextprotocol.io/docs/getting-started/intro). A escolha de uma declaração curta de valores foi inspirada no [Manifesto Ágil em português](https://agilemanifesto.org/iso/ptbr/manifesto.html).

Essas referências orientam princípios e forma editorial. O manifesto tem redação original; não transfere licenças, governança, adoção, garantias ou vínculos institucionais dessas iniciativas para o OHM.

## Complemento editorial — ecossistema e Nilo (11/09/2026)

A seção pública agora inclui [Agent Skills](https://agentskills.io/home), formato de conhecimento/instruções reutilizáveis; [engenharia de prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview), com instruções e critérios de avaliação; e [A2A](https://a2a-protocol.org/latest/), comunicação entre agentes. Textos foram redigidos em pt-BR a partir das fontes oficiais, sem transcrição e sem alegar integração implementada.

A ordem parte da orientação do agente e chega aos princípios de organização do trabalho. Nilo tem apresentação própria e utiliza quadros gerados diretamente por `niloFrame` e `statePose` do desktop. Sua animação nesta página é demonstrativa; não indica uma execução real de agentes. A fonte original de identidade permanece preservada.
