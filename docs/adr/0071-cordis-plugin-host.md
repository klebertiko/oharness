# ADR 0071 — Host Node de Cordis plugins

Status: proposta desta sessão (2026-11-12), spike da issue #466 (parte de #441). 0068 está no PR #444 e 0069 no PR #467; este documento é o 0071.

## Contexto

A Camada B precisa de um host Node, separado do sidecar FastAPI, no estilo do DeepSeek Harness (DSH): escuta só em `127.0.0.1`, porta e token efêmeros, plugin no mesmo processo, compatibilidade de servidor para ferramentas, comandos, eventos e serviços, confirmação humana na instalação, e os avisos de segurança do DSH.

O DSH vende Cordis `4.0.0-rc.11` no commit `0b96d9fd517b998e44e2209560c9e5f0671ce933` e aplica 27 modificações locais (V1–V27). O `cordis.patch.yml` do DSH é uma sobreposição de configuração, não essas modificações. O pacote publicado `@deepseek-ai/cordis` é outra linha (4.1.0 na data deste pin). O DSH não tem permissão por plugin, deixa o agente aprovar scripts de build e é software de prévia.

## Decisão

1. O host mora em `cordis-host/`. Não entra no processo do FastAPI e não muda a via de assinatura (`credential.kind=cli`).
2. O processo escuta só em `127.0.0.1` com porta `0`. O token tem 32 bytes, vai no header `Authorization: Bearer`, e a comparação é o hash SHA-256 dos dois lados. Token na query não autentica. O header `Host` tem de ser `127.0.0.1` e a porta deste processo. Uma variável de ambiente de porta não move o bind.
3. A cópia do Cordis é o tarball npm `cordis@4.0.0-rc.11` (integridade no `package-lock.json`; `gitHead` do registro igual ao commit do `vendor/README.md` do DSH). O specifier `@deepseek-ai/cordis` resolve para esse mesmo módulo, para um plugin do DSH e o host compartilharem uma instância. Não instalamos `@deepseek-ai/cordis@4.1.0` e não aplicamos V1–V27.
4. Só `runtime: in-process`. `isolated` é recusado antes de importar o módulo. Omissão significa `in-process`.
5. A instalação importa o módulo só depois de `accept: true` e de um digest que amarra a versão do aviso, o nome, a versão, o caminho real, o runtime, as capacidades e os scripts de lifecycle. O aviso, em en e pt-BR, diz que um plugin de terceiros pode alcançar arquivos, rede, processos e credenciais, e que sandbox e aprovação protegem as ações do agente, não o código do plugin. A lista de capacidades é declaração, não sandbox.
6. Scripts `preinstall`, `install`, `postinstall` e `prepare` nunca são executados. O corpo `approvedBuilds` ou `allowBuilds` é recusado. Confirmar esses scripts é `scripts: "do-not-run"`.
7. O host oferece serviços de servidor em processo: `tools` e `commands` como subconjuntos, eventos pelo `ctx.emit` do Cordis (nomes `internal/` recusados), e serviços Cordis. `sessionProjections` só guarda o registro; não dobra um log de sessão.
8. `defineTool` deste host não valida o schema dos argumentos. O pacote `@deepseek-ai/dsh-tools` não está instalado. Schemastery é o tarball npm `3.18.0` (`gitHead` `9e1f54f8`), não o commit `cf0b7e54` que o DSH vende. Patches de bundle (`dsh.bundle.patch`) são reconhecidos e não aplicados.

## Consequências

As três provas desta fatia estão em `cordis-host/test/proofs.test.ts`. O que elas não fecham: o pipeline de ferramentas do DSH, o log de sessão, a dobra de projeções, os patches V1–V27, a sobreposição de bundle, e qualquer runtime que não seja o mesmo processo. A tela "Cordis Plugins", o creator-mode e o compartilhamento ficam fora.

## Alternativas rejeitadas

- Depender de `@deepseek-ai/cordis`: traz a linha republicada, não o rc.11 que o DSH registra.
- Copiar as 27 modificações locais: o próprio DSH as trata como prévia, e quebram o pin auditável.
- Deixar o agente aprovar scripts de instalação: é a fraqueza que esta fatia não repete.
- Afirmar que capacidades isolam o plugin: o aviso do DSH diz o contrário, e o código não finge um sandbox.
