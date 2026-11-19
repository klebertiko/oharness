# ADR 0071 — Host Node de Cordis plugins

Status: proposta desta sessão (2026-11-12), spike da issue #466 (parte de #441). 0068 está no PR #444 e 0069 no PR #467; este documento é o 0071. Revisto em 2026-11-19 pela #508 (isolamento do plugin) e pela #486 (limites do host).

## Contexto

A Camada B precisa de um host Node, separado do sidecar FastAPI, no estilo do DeepSeek Harness (DSH): escuta só em `127.0.0.1`, porta e token efêmeros, compatibilidade de servidor para ferramentas, comandos, eventos e serviços, confirmação humana na instalação, e os avisos de segurança do DSH.

O DSH vende Cordis `4.0.0-rc.11` no commit `0b96d9fd517b998e44e2209560c9e5f0671ce933` e aplica 27 modificações locais (V1–V27). O `cordis.patch.yml` do DSH é uma sobreposição de configuração, não essas modificações. O pacote publicado `@deepseek-ai/cordis` é outra linha (4.1.0 na data deste pin). O DSH não tem permissão por plugin, deixa o agente aprovar scripts de build e é software de prévia.

## Decisão

1. O host mora em `cordis-host/`. Não entra no processo do FastAPI e não muda a via de assinatura (`credential.kind=cli`).
2. O processo escuta só em `127.0.0.1` com porta `0`. O token tem 32 bytes, vai no header `Authorization: Bearer`, e a comparação é o hash SHA-256 dos dois lados. Token na query não autentica. O header `Host` tem de ser `127.0.0.1` e a porta deste processo. Uma variável de ambiente de porta não move o bind.
3. A cópia do Cordis é o tarball npm `cordis@4.0.0-rc.11` (integridade no `package-lock.json`; `gitHead` do registro igual ao commit do `vendor/README.md` do DSH). O specifier `@deepseek-ai/cordis` resolve para esse mesmo módulo, para um plugin do DSH e o host compartilharem uma instância. Não instalamos `@deepseek-ai/cordis@4.1.0` e não aplicamos V1–V27.
4. Há dois runtimes. `isolated` é o padrão (omissão significa `isolated`): o plugin roda num processo Node próprio, descrito no item 10. `in-process` roda no processo do host com o alcance do usuário, e por isso o pacote só é aceito se declarar as quatro capacidades (`files`, `network`, `processes` e `credentials`); sem isso a prévia recusa com `runtime-not-supported`. Outro valor também é recusado. Omissão de `capabilities` não concede nada; antes, ela listava as quatro.
5. A instalação importa o módulo só depois de `accept: true` e de um digest que amarra a versão do aviso, o nome, a versão, o caminho real, o runtime, as capacidades e os scripts de lifecycle. O aviso (versão 3), em en e pt-BR, diz o que o processo isolado não alcança sem capacidade, o que cada capacidade concede (e que `files` alcança o código do próprio host), que a rede não é limitada e alcança os serviços do computador, inclusive este host, que `in-process` tem tudo de uma vez, e que sandbox e aprovação protegem as ações do agente e não o código do plugin além desses limites. Confirmar o digest é o que concede as capacidades declaradas.
6. Scripts `preinstall`, `install`, `postinstall` e `prepare` nunca são executados. O corpo `approvedBuilds` ou `allowBuilds` é recusado. Confirmar esses scripts é `scripts: "do-not-run"`.
7. O host oferece serviços de servidor: `tools` e `commands` como subconjuntos, eventos pelo `ctx.emit` do Cordis (nomes `internal/` recusados), e serviços Cordis. `sessionProjections` só guarda o registro; não dobra um log de sessão. Com o runtime `isolated`, do filho para o host só voltam **nomes**: de tools, de comandos, de projeções e de serviços. A instância de um serviço e os eventos que o plugin emite ficam no processo dele; não cruzam para o host nem para outro plugin. Um plugin isolado não consome o serviço de outro.
8. `defineTool` deste host não valida o schema dos argumentos. O pacote `@deepseek-ai/dsh-tools` não está instalado. Schemastery é o tarball npm `3.18.0` (`gitHead` `9e1f54f8`), não o commit `cf0b7e54` que o DSH vende. Patches de bundle (`dsh.bundle.patch`) são reconhecidos e não aplicados.

9. O pacote tem de estar, depois de resolver links, estritamente dentro de uma pasta de plugins que o app controla: `OH_CORDIS_PLUGINS_DIR` (caminho absoluto) ou, sem ela, `~/.oharness/plugins`. Só o processo pai escolhe essa pasta; a API HTTP não. Um link dentro do pacote é recusado.
10. O digest também amarra o arquivo de entrada (caminho relativo) e um sha256 de todos os arquivos do pacote (caminho e hash de cada um, em ordem). Na instalação, o host copia o pacote para uma pasta própria e privada a partir dos mesmos bytes que hasheia, recusa se o hash não é o confirmado, e roda a cópia: editar o original depois disso não muda o que roda. Um pacote já carregado só responde do cache se o hash dos arquivos for o mesmo; se mudou, a instalação é recusada com `confirmation-mismatch`.

    **Fronteira do runtime `isolated`.** Cada plugin roda num processo filho (`child_process.fork`) com o Permission Model do Node (`--permission`). Sem capacidade, esse processo:
    - só lê o snapshot do pacote e os módulos fixados do host (`src/`, `vendor/`, `node_modules/` e o `package.json` de `cordis-host/`), por `--allow-fs-read`. `test/` e `proofs/` ficam de fora;
    - não escreve em disco (sem `--allow-fs-write`);
    - não abre processo (sem `--allow-child-process`), nem worker, addon ou WASI (essas flags nunca são passadas);
    - não recebe as variáveis de ambiente que o host tem. No POSIX o ambiente do filho é vazio. No Windows o host passa só `SystemRoot`, que o Node exige para subir, e o libuv completa os padrões do usuário (HOMEPATH, USERNAME, USERPROFILE, TEMP, PATH e outras): o ambiente não fica vazio, mas nenhuma variável própria do host chega. `NODE_OPTIONS` nunca passa, porque poderia somar flags de permissão;
    - não escreve no stdout do host, onde vai o banner com o token: o stdout e o stderr dele vão, linha a linha, para o stderr do host, com o prefixo `[plugin <nome>]`, sem sequências de controle de terminal e com teto de 8 KiB por linha;
    - não alcança o inspector do host. O Permission Model não cobre `process._debugProcess(pid)` (que abre o inspector de outro processo Node, por SIGUSR1 no POSIX e por thread remota no Windows) nem `process.kill`/`process._kill`. O primeiro módulo do filho (`src/child-guard.ts`) troca os três, antes de qualquer código do plugin, por guardas não graváveis e não configuráveis: o plugin só sinaliza o próprio pid e, com `processes`, qualquer pid menos o do host. O host roda com `--disable-sigusr1` (scripts `start` e `test`) e ignora SIGUSR1, o que cobre também um processo que o plugin abre com `processes`;
    - tem o heap limitado a 512 MiB (`--max-old-space-size=512`).

    Cada capacidade confirmada tira um limite: `files` passa `--allow-fs-read=*` e `--allow-fs-write=*`; `processes` passa `--allow-child-process`; `credentials` passa o ambiente do host. O hook de resolve continua dentro do filho e recusa o `import` que sai da cópia, dos built-ins e dos módulos fixados antes de o arquivo rodar.

    `files` equivale a controlar o host: com leitura e escrita em `*`, o plugin pode sobrescrever `cordis-host/src`, que o host e os outros plugins carregam no próximo arranque. `files` é o alcance total do usuário em disco, não uma pasta.

    **Canal.** Não há canal IPC do Node, que faz o parse da mensagem inteira antes de alguém medi-la. O host passa um pipe no fd 3 e o filho escreve nele NDJSON (uma mensagem JSON por linha); o host conta os bytes da linha **antes** do parse (`src/lines.ts`) e corta no teto de 1 MiB, então o teto é real. O filho avisa `ready`, recebe `load`, e devolve `loaded` com o estado do fiber e os nomes de tools, comandos, projeções e serviços. Depois, `invoke` e `command` voltam como `result`. `exec.agent.session.append` volta como `session-append`, e `emit` e `abort` vão para o filho. O host não confia no filho, que divide o processo com o código do plugin: toda linha é lida por um schema estrito (`src/ipc.ts`, zod). Uma linha acima do teto, malformada ou fora de ordem mata o processo e marca o plugin como `failed`. Um filho que morre falha as chamadas pendentes, e o host segue de pé. Um nome de tool ou comando que outro plugin já usa recusa a instalação.

    `session-append` só aceita os eventos da allowlist `SESSION_EVENTS` (hoje só `todo/write`), com até 64 KiB de dados por evento e 100 eventos por chamada; fora disso, a chamada falha. Quando uma chamada passa do prazo (item 13), o host manda um `ping`: se o `pong` não volta em 2 s, o filho travado é morto e o plugin fica `failed`.

    `emit` vai, sem filtro, para todos os plugins isolados carregados, como o `ctx.emit` do Cordis faz no mesmo processo. Um plugin isolado recebe todo evento que a UI ou o sidecar emitem, mesmo os que ele não declarou ouvir. Filtrar por eventos declarados fica para quando o manifesto tiver esse campo.

    **Limites dessa fronteira**, com as docs do Node (`nodejs.org/docs/latest-v22.x/api/permissions.html`) como fonte:
    - O Node usado é o do `.nvmrc` e do CI, `22.20.0`, e o `engines` exige `>=22.20.0`. Hoje nem o sidecar nem o app sobem este host (ver "Pendente: empacotamento"). No 22, o Permission Model é "Stability: 2 - Stable" desde a v22.13.0. `--allow-child-process`, `--allow-worker`, `--allow-addons` e `--allow-wasi` são "1.1 - Active development". Os testes rodam no 22.20 do CI e no 24 local.
    - **Rede não é limitada.** O Node 22 e o 24 não têm permissão de rede. `--allow-net` só aparece na v25.0.0, e ainda como "1.1". A capacidade `network` é declaração, e o aviso diz isso. Sem ela, o filho ainda alcança a internet e os serviços de loopback da máquina, inclusive este host (que exige o token do item 2, que o filho não recebe) e o sidecar. Quando o Node do host for 25 ou mais novo, `network` passa a ter flag própria.
    - O Node segue links simbólicos para fora das pastas liberadas. O snapshot recusa qualquer link (item 9), e por isso essa brecha não se aplica à cópia.
    - Um descriptor de arquivo herdado passa por fora do modelo. O filho recebe só pipes do host: stdin, stdout, stderr e o canal no fd 3.
    - `node:sqlite` não é coberto pelo modelo para arquivos. O plugin que o usar pode ler bancos SQLite que o usuário alcança.
    - `processes` é o alcance do usuário: um programa iniciado pelo plugin roda fora do modelo, e o aviso diz isso.
    - `in-process` não tem fronteira nenhuma; só o hook de resolve evita acidentes. Ele existe para código nosso ou vendorizado que precisa dividir a instância Cordis com o host, como a prova 2.
    - Não há limite de CPU por plugin, e o de memória é só o heap do V8 (buffers fora do heap não contam). Um laço infinito trava só o filho: o host responde por prazo (item 13) e mata o filho que não responde ao ping.

    Por isso o PR e o aviso falam em processo separado com limites de arquivo, de processo e de ambiente, e não em isolamento completo: a rede, a CPU e os serviços de loopback continuam ao alcance do plugin.
11. O token fica só com a UI e o sidecar, nunca com o agente. Quem tem o token consegue fazer prévia e instalação sozinho (o digest volta na resposta 409), então entregar o token ao agente equivale a deixar o agente instalar código.
12. O pai segura o stdin do host. Quando o stdin fecha, inclusive porque o pai morreu sem mandar sinal, o host para de escutar e sai. Subir o host com stdin em `/dev/null` faz ele sair na hora. Se o `close` não termina em 5 s (um `dispose` que nunca acaba), o host mata os filhos, apaga os snapshots de forma síncrona e sai com 1, para nada sobrar na pasta temporária (`src/shutdown.ts`). O prazo segura o event loop de propósito: um `dispose` preso numa promise que não segura handle nenhum deixaria o loop esvaziar e o host sair com 0 sem limpar. `test/lifecycle.test.ts` sobe o host real com um plugin assim e exige saída 1 em cerca de 5 s e o snapshot apagado. O filho roda fora da pasta do snapshot, porque no Windows um processo com o cwd lá impede apagá-la. Um SIGKILL no host (ou encerrar o processo pelo Gerenciador de Tarefas no Windows) não passa por nada disso: os snapshots `oharness-cordis-snap-*` ficam órfãos na pasta temporária.
13. `tools/invoke` e `commands/execute` têm prazo (30 s por padrão): depois dele a resposta é de erro e o sinal aborta. No máximo 16 chamadas rodam ao mesmo tempo; a 17ª recebe 429 `busy`. O servidor aceita até 64 conexões. O abort por desconexão escuta o `close` da resposta e só dispara se ela não terminou. O listener de `connection` é registrado antes do `listen`. A `message` de erro de um plugin volta em `/v1/plugins` só para quem tem o token, que é a UI ou o sidecar (item 11): isso fica aceito, sem redação.

## Pendente: empacotamento

Nada aqui decide como o host entra no instalador NSIS. Rodá-lo exige Node 22.20 ou mais novo, a flag `--experimental-transform-types` (as fontes do DSH usam propriedades de parâmetro) e o `node_modules` de `cordis-host/`. Embutir o Node, exigir um Node do sistema ou compilar as fontes para JS é uma decisão em aberto, a tomar antes de ligar o host no app.

## Consequências

As três provas desta fatia estão em `cordis-host/test/proofs.test.ts`: a prova 1 roda isolada (pid diferente do host), a prova 2 roda `in-process`, e a prova 3 roda o `tool-todo` do DSH isolado, com `session.append` atravessando o canal do fd 3. As recusas do item 10 estão em `cordis-host/test/isolation.test.ts`, uma por limite (inclusive a prova direta de que o Permission Model está ligado no filho: `process.permission.has('fs.write')` é `false`), as do canal em `test/channel.test.ts` e a do inspector em `test/lifecycle.test.ts`. Rodam no job `cordis host` do CI, em Linux. O que elas não fecham: o pipeline de ferramentas do DSH, o log de sessão, a dobra de projeções, os patches V1–V27, a sobreposição de bundle, e a rede no runtime isolado. A tela "Cordis Plugins", o creator-mode e o compartilhamento ficam fora.

## Alternativas rejeitadas

- Depender de `@deepseek-ai/cordis`: traz a linha republicada, não o rc.11 que o DSH registra.
- Copiar as 27 modificações locais: o próprio DSH as trata como prévia, e quebram o pin auditável.
- Deixar o agente aprovar scripts de instalação: é a fraqueza que esta fatia não repete.
- Afirmar que capacidades isolam o plugin sem fronteira por trás: o aviso do DSH diz o contrário. Agora `files`, `processes` e `credentials` têm uma fronteira de processo; `network` continua só declarada, e o aviso diz isso.
- Bloquear `node:module`, `fs` ou `child_process` por hook no mesmo processo: `createRequire`, `process.binding` e o próprio `process` contornam, e isso daria uma falsa sensação de sandbox.
- Worker threads com `--permission`: o modelo do Node não herda para worker threads ("The model does not inherit to a worker thread").
- Isolamento de SO (job object, seccomp, contêiner), como o da #420 para as tools do broker: cobriria a rede, mas exige um mecanismo por sistema operacional. O processo filho com `--permission` funciona igual nos três e não fecha essa porta.
