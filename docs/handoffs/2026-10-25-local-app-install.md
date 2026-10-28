# Handoff: sessão local → montar e instalar o app OHarness (Windows)

Data: 2026-10-25. Repositório: `klebertiko/oharness`, branch `main`. Para a sessão **local** (no computador do usuário). A nuvem não alcança a máquina dele; tudo aqui precisa rodar localmente. Contexto geral: [`2026-10-24-alpha-to-maestro.md`](2026-10-24-alpha-to-maestro.md).

## Objetivo

Montar o instalador a partir da **última `main`**, instalar o app **somente na máquina local** (cópia por usuário) e confirmar que ele roda com o rebranding OHarness e as telas novas. **Não** crie tag, release nem publique nada: `v0.0.1-alpha` só com decisão do usuário.

## Antes de começar

1. `git fetch origin && git checkout main && git pull --ff-only`. Anote `git log -1 --oneline` no relatório final.
2. Feche qualquer processo antigo (`OpenHarness`/`OHarness`): o app é single-instance e o smoke recusa rodar com outro aberto.
3. **Desinstale o OpenHarness antigo** (Configurações → Aplicativos). O identificador do Tauri mudou de `dev.openharness.app` para `dev.oharness.app`; para o Windows é outro app, então o antigo não é substituído sozinho. **Não apague** a pasta de dados antiga nem `~/.openharness/secrets` sem o usuário pedir: segredos antigos continuam sendo lidos de lá (a chave deriva do caminho) e o keychain migra o serviço legado no primeiro acesso.
4. Pré-requisitos (README, "Quick start"): Rust (`rustup`) com MSVC Build Tools, WebView2, **Node 22** (`.nvmrc`), **Python 3.12+**.

## Montar e instalar

```powershell
npm ci
node scripts/build-sidecar.mjs      # precisa de backend/.venv ou python do sistema; gera src-tauri/binaries/oharness-sidecar-<triple>.exe
npm run tauri:build                 # gera src-tauri/target/release/bundle/nsis/OHarness_*_x64-setup.exe
powershell -File scripts/install-desktop.ps1
```

`install-desktop.ps1` instala em `%LOCALAPPDATA%\Programs\OHarness`, atualiza o cache de ícones e roda o `smoke-desktop.ps1`. O smoke falha se: nenhum sidecar escuta em loopback; `/health` não é `ok`; a WebView não renderiza; a janela principal não fecha; sobra processo de sidecar após sair; ou o app grava `harness.db`/`secrets` dentro da pasta de instalação. Se houver mais de um `OHarness_*_x64-setup.exe` na pasta `nsis`, apague os antigos ou passe `-InstallerPath`.

## Verificação manual (depois do smoke)

Abra o app instalado e confira, nos dois temas (Graphite e Ivory):

- Título da janela e menu mostram **OHarness**; ícone novo (Nilo) na barra de tarefas. Nenhum texto "OpenHarness" visível.
- Três destinos: **Chats** (`Alt+1`), **Studio** (`Alt+2`), **Providers** (`Alt+3`). Paleta de comandos abre e navega por teclado.
- Studio: "Open harness" abre o Agile Harness, o canvas arruma o grafo, Validar/Importar `.ohm` funciona, mensagem "Imported · id" aparece.
- Providers: adicionar uma credencial grava e lê de volta (`secretRef` novo usa `oharness/<id>`); se existir credencial antiga `openharness/<id>`, ela ainda resolve.
- Fontes (Sora e IBM Plex Mono) carregam sem pedir rede; foco visível ao navegar com Tab.
- Fechar a janela encerra o sidecar (nenhum `oharness-sidecar.exe` no Gerenciador de Tarefas).

## Problemas conhecidos

- A suíte completa do backend trava em `tests/test_sandbox_git_config_allowlist.py` com git < 2.45 (o caso `remote.*.promisor` exige 2.45). É do ambiente de nuvem; localmente, atualize o git antes de rodar `pytest`.
- Builds são atestados (proveniência), mas **não** assinados para produção; o SmartScreen pode avisar.
- Pages/`website/` pode estar atrás do app (PR do site em andamento); não afeta o instalador.

## O que reportar

Commit da `main` usado, saída JSON do `install-desktop.ps1` (inclui o resultado do smoke), versão do git/Node/Python/Rust, lista do que passou ou falhou na verificação manual, e prints das telas nos dois temas se algo estiver visualmente errado. Abra issue (não PR) para defeitos; não corrija código sem pedido do usuário. Nunca cole segredos ou caminhos pessoais em issues.
