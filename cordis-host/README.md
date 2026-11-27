# Host Node de Cordis plugins

Processo Node separado do sidecar FastAPI. Escuta só em `127.0.0.1`, com porta escolhida pelo sistema e um token novo a cada arranque. Cada plugin roda num processo Node próprio, com o Permission Model do Node (`runtime: isolated`, o padrão).

```bash
cd cordis-host
npm ci --ignore-scripts
npm test
npm start
```

`npm start` escreve uma linha JSON em stdout: `host`, `port`, `token`, `cordis`, `runtime` e `node` (o `process.version`, que o sidecar usa para recusar Node abaixo de 22.20). O token não sai em outro canal. As rotas exigem `Authorization: Bearer <token>` e `Host: 127.0.0.1:<porta>`.

## Instalação

`POST /v1/plugins/preview` lê o pacote e devolve o aviso, sem importar o código. `POST /v1/plugins/install` só importa depois de `confirmation.accept: true` e do `digest` dessa prévia.

O aviso, em inglês e pt-BR, diz o que o processo do plugin não alcança sem capacidade e o que cada capacidade concede. `oharness.capabilities` é a lista que a pessoa confirma, e confirmar concede. A omissão não concede nada.

Scripts `preinstall`, `install`, `postinstall` e `prepare` não rodam. Se existirem, a confirmação leva `scripts: "do-not-run"`. `approvedBuilds` e `allowBuilds` são recusados.

O pacote tem de estar dentro da pasta de plugins: `OH_CORDIS_PLUGINS_DIR` (absoluta) ou `~/.oharness/plugins`. O digest cobre o arquivo de entrada e o hash de todos os arquivos do pacote, então editar o pacote depois da prévia exige uma prévia nova. O token é da UI e do sidecar, nunca do agente.

`POST /v1/plugins/unload {name}` para o plugin (`name` é o nome do pacote, como em `GET /v1/plugins`) e o esquece: um plugin isolado tem o processo parado, um `in-process` tem o fiber descartado, e a cópia privada é apagada. Depois disso outra versão pode ser instalada sem reiniciar o host. Nome desconhecido responde 404 `plugin-not-found`.

## Isolamento

Com `runtime: isolated`, sem capacidade, o processo do plugin só lê o snapshot do pacote e os módulos fixados do host. Ele não escreve em disco, não abre processo, não sinaliza o host nem abre o inspector dele, e não recebe as variáveis de ambiente do host (no Windows, o Node completa as variáveis padrão do usuário, como USERPROFILE, TEMP e PATH). A rede não é limitada: o plugin alcança a internet e os serviços de loopback, inclusive este host, que exige o token. Isso é um processo separado com limites, não isolamento completo. Cada capacidade tira um limite:

| Capacidade | Concede |
|---|---|
| `files` | ler e escrever qualquer arquivo que o usuário alcança, inclusive o código deste host: equivale a controlá-lo |
| `processes` | abrir processos, que rodam fora desses limites |
| `credentials` | o ambiente do host |
| `network` | nada a mais: no Node 22 e no 24 a rede não é limitada |

O filho fala com o host por NDJSON no fd 3, com teto de 1 MiB por linha medido antes do parse, e o host valida cada mensagem. Do filho só voltam nomes de tools, comandos, projeções e serviços; serviços e eventos não cruzam entre plugins. `emit` vai para todos os plugins isolados, sem filtro. `runtime: in-process` roda no processo do host e só é aceito com as quatro capacidades declaradas. Os limites e as fontes estão no ADR 0071, item 10. Os testes de cada recusa estão em `test/isolation.test.ts`.

O processo pai segura o stdin do host. Quando ele fecha, o host sai. Por isso `npm start` num terminal funciona, e `npm start < /dev/null` sai logo.

## Cordis

O pacote é `cordis@4.0.0-rc.11`, o mesmo commit que o DeepSeek Harness registra em `vendor/README.md` (`0b96d9fd517b998e44e2209560c9e5f0671ce933`). A integridade está no `package-lock.json` e em `src/pin.ts`. O tarball entra como publicado, sem modificação local. `@deepseek-ai/cordis` não é instalado; um hook de carregamento aponta esse specifier para o tarball acima, para haver uma só instância do módulo.

Schemastery é o tarball npm `3.18.0` (`gitHead` `9e1f54f8`). O DSH vende outro commit (`cf0b7e54`) com o mesmo número de versão. O teste de pin registra essa diferença.

Duas fontes de plugin do DSH estão em `vendor/dsh/` (`directory-picker` e `tool-todo`), com blob SHA em `vendor/dsh/PIN.json`, commit `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`, licença MIT.

O Node 22 precisa de `--experimental-transform-types` para carregar essas fontes: o apagador de tipos estável recusa propriedades de parâmetro, e o `DirectoryPickerError` do DSH usa esse recurso. Os scripts deste pacote já passam a flag.

## O que as provas mostram

1. Um plugin nosso só é avaliado depois da confirmação. Ferramenta, comando, evento e serviço rodam no processo isolado dele (o pid é outro) e atravessam pelo canal do fd 3.
2. O serviço `DirectoryPicker` do DSH, carregado `in-process`, cujo único import de biblioteca é Cordis, registra `directoryPicker` e a instância viva estende a classe vendorizada.
3. O `tool-todo` do DSH, isolado, registra `todo_write` no serviço `tools`. Sem sessão de agente, o corpo do plugin recusa a chamada. Com um objeto de sessão mínimo, cujo `append` atravessa o canal, ele grava `todo/write` e devolve as contagens. A projeção `todos` fica só registrada: `apply` não é chamado.

O que não fecha, de propósito: o `defineTool` daqui não valida o schema (um campo extra passa, e o teste mostra isso); este host não tem pipeline de ferramentas, prompt de sistema nem guarda próprios; não há log de sessão; patches de bundle são ignorados; a rede não é limitada no runtime isolado.

A decisão está no ADR 0071.
