# Handoff final: trabalho restante e fechamento local (tag, release e app)

Data: 2026-10-28. Repositório: `klebertiko/oharness`, branch `main`. Para o **agente local** (computador do usuário, Windows). Complementa [`2026-10-25-local-app-install.md`](2026-10-25-local-app-install.md) e [`2026-10-24-alpha-to-maestro.md`](2026-10-24-alpha-to-maestro.md). Tracking só no GitHub (issues e PRs). Sem segredos, e-mails nem caminhos pessoais em issues, PRs ou commits.

## 0. Estado

- Tudo o que foi pedido até aqui está na `main`: design system, rebranding OHarness, redesign das telas, docs, site, correções de segurança e qualidade, Workspace Manager e os Dependabot.
- **Commit para a tag `v0.0.1-alpha`: `f6ec5fea221ad2097a06f94a348dbfcb57cb90c8`** (inclui o header/hero do site corrigidos, #187, e a higiene do Gitleaks, #190). As cinco versões do projeto já são `0.0.1-alpha`, então o "version gate" do workflow passa.
- **Não existe tag nem release ainda.** A nuvem não consegue criar tags (o proxy do ambiente devolve 403 em API de refs e em `git push` de tag); por isso é tarefa local.
- O roadmap das próximas versões foi entregue por sessões de nuvem em PRs separados, já na `main` (seção 4). Eles **não** entram na `v0.0.1-alpha`: a tag é fixada no commit acima.

## 1. Tag e release `v0.0.1-alpha` (você, agente local)

1. `git fetch origin` e confirme que o commit existe: `git cat-file -t f6ec5fea221ad2097a06f94a348dbfcb57cb90c8`.
2. **Confirme que o CI desse commit está verde** antes de tagear:
   `gh api repos/klebertiko/oharness/commits/f6ec5fea221ad2097a06f94a348dbfcb57cb90c8/check-runs --jq '[.check_runs[]|(.conclusion//.status)]|group_by(.)|map("\(.[0]):\(length)")|join(" ")'`
   Esperado: só `success` e `skipped`. Se algo estiver `failure`, pare e abra issue; não tagueie.
3. Crie e empurre a tag **anotada**:
   ```powershell
   git tag -a v0.0.1-alpha f6ec5fea221ad2097a06f94a348dbfcb57cb90c8 -m "OHarness v0.0.1-alpha (pre-release)"
   git push origin v0.0.1-alpha
   ```
4. O workflow `Release` dispara: gates de qualidade e segurança → version gate → build das 3 plataformas dentro do ambiente protegido **`release`** (revisor: o dono do repositório) → **release em rascunho** marcada como pré-lançamento, com `SHA256SUMS`, SBOM e atestações. **Peça ao usuário para aprovar o ambiente** (Actions → o run da tag → Review deployments); sem isso nada é construído.
5. Com o rascunho pronto, **confira antes de publicar**:
   ```powershell
   gh release view v0.0.1-alpha --repo klebertiko/oharness --json isDraft,isPrerelease,assets --jq '{isDraft,isPrerelease,assets:[.assets[].name]}'
   gh release download v0.0.1-alpha --repo klebertiko/oharness --dir dist-check
   ```
   Esperado: `OHarness-windows-x64-setup.exe`, `OHarness-linux-x86_64.AppImage`, `OHarness-linux-amd64.deb`, `OHarness-macos-arm64.dmg`, `OHarness-macos-x64.dmg`, `SHA256SUMS`, `OHarness-sbom.cdx.json`. Verifique as somas (`Get-FileHash -Algorithm SHA256` contra `SHA256SUMS`) e as atestações: `gh attestation verify <arquivo> --repo klebertiko/oharness`.
6. **Publicar é público e irreversível na prática.** Mostre ao usuário o resultado da conferência e publique só com o "sim" dele: `gh release edit v0.0.1-alpha --repo klebertiko/oharness --draft=false` (mantém pré-lançamento). Depois o link `releases/tag/v0.0.1-alpha`, que o site e o README já usam, passa a abrir.
7. Não crie nenhuma outra tag. Instaladores não são assinados para produção (SmartScreen e Gatekeeper avisam); está dito nas notas da release.

## 2. App local (você, agente local)

Duas opções; o usuário pediu o app mais recente:

- **A. Da `main` mais nova** (inclui o que as sessões de nuvem já tiverem mergeado): siga [`2026-10-25-local-app-install.md`](2026-10-25-local-app-install.md): `git pull --ff-only`, desinstalar o OpenHarness antigo (identificador Tauri mudou para `dev.oharness.app`), `npm ci`, `node scripts/build-sidecar.mjs`, `npm run tauri:build`, `powershell -File scripts/install-desktop.ps1`, depois a verificação manual nos dois temas.
- **B. Do instalador da release** (conteúdo exato da `v0.0.1-alpha`): baixe `OHarness-windows-x64-setup.exe` do rascunho/release já conferido e instale.

Relate: commit usado, saída JSON do `install-desktop.ps1` (smoke), versões de git/Node/Python/Rust e o que passou ou falhou na verificação manual. Defeitos viram **issue**, não PR, salvo pedido do usuário.

## 3. Ações que só o dono do repositório pode fazer (lembre o usuário)

- Dispensar o alerta `Opengrep OSS` do #139 em Security → Code scanning (`backend/workspaces/gitrun.py`): falso positivo revisado (ADR 0008), justificativa na thread do PR.
- Colocar uma chave de API do NVD nos segredos do repositório: o OWASP agendado falha em "Update NVD database" sem ela.
- Ativar *Automatically delete head branches* em Settings → General (o Gitleaks agendado lê todas as branches remotas; branches de PRs mortos acumulam achados).
- Revisar as decisões de design registradas como ADR "proposta, reversível" em `docs/adr/` (Studio agentic, seletor de harness, combo de modelos).
- O histórico do git ainda contém o nome de usuário do Windows em caminhos antigos de evidências (removido da árvore no #184). Reescrever histórico é decisão sua; não faça sem pedido explícito.

## 4. Roadmap (entregue na `main` em 2026-10-28; sessões de nuvem)

| Área / tela | Issues | Sessão |
| --- | --- | --- |
| Providers e combo do chat | #82 (mapa), #83 #84 #85 #86 #87 #88 #89 #90 | Alpha Design |
| Studio agentic e seletor de harness no chat | #70 (mapa), #71 #72 #73 #74 | sessão Studio |
| Controle do chat (fila, presets de permissão, modo plano) | #160 #161 #162 | sessão Chat |
| Turno e subagentes (diff por turno, teto de custo/tokens, hooks, árvore de subagentes) | #163 #164 #165 #166 | sessão Turno |
| Runs, CLI e Workspaces (retomar/bifurcar, `oharness run --json`, worktree por run, P3 do #139, nomes reservados Windows) | #157 #158 #159 #154 #109 | sessão Runs |

Todos os PRs dessas sessões estão mesclados e as issues fechadas. Pendentes abertos: #199 (contraste do toolbar Run no Ivory) e #209 (pytest intermitente). Se surgir outro PR aberto, **termine a fila**: para cada PR, confirme CI obrigatório verde (`Quality / required`, `Security scan / required`), nenhuma thread aberta (`gh api repos/klebertiko/oharness/pulls/<n>/ccr/review_threads`) e `update-branch` feito; depois `gh api -X PUT repos/klebertiko/oharness/pulls/<n>/merge -f merge_method=squash`. Faça um PR por vez: cada merge deixa os outros atrás da `main`. PRs empilhados (ex.: #192 sobre #188) entram na ordem da pilha. Issue vira "fechada" só com o PR mergeado e os critérios de aceite atendidos.

## 5. Regras que valem para tudo

- GraphQL é bloqueado no ambiente de nuvem; localmente pode usar `gh pr` normalmente.
- Gitleaks examina **cada commit** do PR: se uma fixture parecer segredo (ex.: `"secretRef": "oharness/anthropic"`, entropia 3,503), ponha `# gitleaks:allow` inline **no commit que a introduz**; corrigir depois não limpa o commit antigo.
- `nosemgrep` só com justificativa e com **os dois ids** da regra (com e sem o prefixo `opengrep-rules.`); o job `Opengrep OSS` usa o id sem prefixo.
- Textos "tudo é harness"; o assistente é o **Nilo** (nunca "Copilot"); tokens do design system; dois temas; acessibilidade (teclado, foco, axe 0).
- Compatibilidade do rebranding é intencional: salt `openharness.file-secrets.v1:`, pasta `~/.openharness/secrets`, serviço legado do keychain e `OPENHARNESS_*`. Não "limpe" isso.
- Nunca reescreva histórico, apague branches, nem force-push em `main` sem pedido explícito do usuário.
