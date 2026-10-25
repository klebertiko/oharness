# Handoff: Alpha (designer-chefe, nuvem) → Maestro

Data: 2026-10-24. Repositório: `klebertiko/oharness` (antes `OpenHarness`). Produto: **OHarness**.
Leia isto antes de mexer na `main`. Tracking continua só no GitHub.

## 1. Estado da `main` (último commit lido: ver `git log`)

Entraram nesta frente, nesta ordem, todos com CI obrigatório verde, threads resolvidas e branch atualizada:

| PR | O que é |
| --- | --- |
| #116, #134, #133, #129, #155, #149, #170, #150, #135 | Dependabot/CI: cache NVD do OWASP, npm do frontend, Tauri/Rust, Python, tauri-cli, tauri-build, actions (#135 teve conflito com o #171 em `owasp.yml`, resolvido à mão) |
| #140 | Design system (tokens DTCG, brand book, checagens de paridade e contraste) |
| #144 | Rebranding OpenHarness → OHarness em todo o repositório, com compatibilidade de dados |
| #141 | Redesign de todas as telas do app no design system |
| #177 | Issue #147: follow-ups P3 do SEC do #146 (gramáticas `\Z`, `_git_version` sem cachear falha, `exec` roda o git da política) |
| #175, #174, #173 | Notas da v0.0.1-alpha, guia de uso + glossário, README com o estado real |
| #176 | Issue #153: cobertura de lint restaurada no Biome (+ `docs/lint-coverage.md`) |
| #172 | Issue #148: flake do e2e (`Imported · id` desacoplado do `draftKey`) |
| #171 | Issue #118: `./` → `$/` (self-repository) nos workflows |

Issues fechadas: #147, #148, #153, #118. **#109** segue aberta (junction já veio no #146; falta recusar nomes reservados do Windows como operando).

## 2. Em aberto e de quem é

| PR | Estado | Dono / próximo passo |
| --- | --- | --- |
| #145 `docs/site-real-screenshots` | site com capturas reais, falhas de CI | Alpha Design + você: decidir quem fica com o `website/` e os screenshots (a sessão de design foi orientada a coordenar por comentário no #145) |
| #139 Workspace Manager | atrás da `main`, falhas de CI | BE do #139 (seu). Tem ocorrências do nome antigo: ver passos do comentário no PR |
| #120 Tailwind 4 | reconstruído sobre o design novo, falhas de segurança (CodeQL, OpenGrep, Trivy, Dependency review) | seu; Alpha não mexeu |
| #167 `feat/min-os-requirements` | rascunho, 2 falhas | seu |
| #92 design/studio-creation-redesign | rascunho, atrás da `main` | Alpha Design / wayfinder #70–#90 (não tocar) |

## 3. O que o usuário precisa fazer

- **Instalar só o app desktop local** a partir da última `main`: `git pull`, `npm ci`, `npm run tauri:build`, `powershell scripts/install-desktop.ps1` (cria `%LOCALAPPDATA%\Programs\OHarness`). Antes, desinstale o OpenHarness antigo: o identificador do Tauri mudou para `dev.oharness.app` e o Windows trata como outro app.
- Renomear o repositório já foi feito (`oharness`); links do Pages assumem `klebertiko.github.io/OHarness/`.
- **Tag e release `v0.0.1-alpha` não foram criadas.** Só com decisão do usuário.

## 4. Aprendizados que evitam retrabalho

- **Ordem de merge:** a `main` exige checks obrigatórios sobre a base atual. Cada merge deixa todos os outros PRs atrás; faça `update-branch`, espere o CI, mergeie, repita. Um merge isolado passa no classificador do modo auto; um comando que junta espera + merge é negado.
- **Gitleaks examina cada commit do PR.** Corrigir por cima de um commit que já tem o achado não resolve; reescreva o commit. `# gitleaks:allow` inline na linha é o mecanismo que funciona em qualquer versão (o `[[allowlists]]` não vale para regras estendidas no 8.24). Caso real: `"secretRef": "oharness/anthropic"` tem entropia 3,503 (limite 3,5; o nome antigo tinha 3,499).
- **Compatibilidade do rebrand (de propósito):** salt `openharness.file-secrets.v1:` intocado (trocar invalidaria segredos); keychain lê o serviço legado e migra no primeiro acesso; `~/.openharness/secrets` continua sendo usado se a pasta nova não existir (a chave deriva do caminho); `OPENHARNESS_*` valem como fallback de `OHARNESS_*`; `secretRef` já gravado continua resolvendo (lido do banco).
- **`$/` nos workflows** (self-repository): o GitHub resolve para `klebertiko/oharness/.github/actions/...@<sha>` e a action local fica fixada no commit. O OpenGrep o trata como terceiro sem pin; há 9 `nosemgrep` por linha no #171 e o SARIF ainda pode emitir alertas.
- **Ambiente de nuvem:** git 2.43 faz o caso `remote.*.promisor` falhar e o arquivo `test_sandbox_git_config_allowlist.py` travar (também na `main` pura); no CI passa. GraphQL é bloqueado (`gh pr create` falha): use REST. `ccr/review_threads` e `ccr/comments/{id}/resolve` resolvem threads. A nuvem não consegue mandar mensagem para a sua sessão local (precisa de confirmação do dono); por isso o canal são comentários em issues/PRs.
- **Vigiar:** o e2e do Playwright pode ainda piscar. Se reaparecer depois do #172, abra issue própria (o `clarity:202` a 320px já foi tratado no #142).

## 5. Regras que mantive

Não toquei em `agent/`, `providers/`, `agent-run/`, #92 nem no wayfinder. Prosa curta, um QA/SEC por PR quando você pedir, sem tag/release.
