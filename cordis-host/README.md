# Host Node de Cordis plugins

Processo Node separado do sidecar FastAPI. Escuta sÃ³ em `127.0.0.1`, com porta escolhida pelo sistema e um token novo a cada arranque. Cada plugin roda num processo Node prÃ³prio, com o Permission Model do Node (`runtime: isolated`, o padrÃ£o).

```bash
cd cordis-host
npm ci --ignore-scripts
npm test
npm start
```

`npm start` escreve uma linha JSON em stdout: `host`, `port`, `token`, `cordis`, `runtime` e `node` (o `process.version`, que o sidecar usa para recusar Node abaixo de 22.20). O token nÃ£o sai em outro canal. As rotas exigem `Authorization: Bearer <token>` e `Host: 127.0.0.1:<porta>`.

## InstalaÃ§Ã£o

`POST /v1/plugins/preview` lÃª o pacote e devolve o aviso, sem importar o cÃ³digo. `POST /v1/plugins/install` sÃ³ importa depois de `confirmation.accept: true` e do `digest` dessa prÃ©via.

O aviso, em inglÃªs e pt-BR, diz o que o processo do plugin nÃ£o alcanÃ§a sem capacidade e o que cada capacidade concede. `oharness.capabilities` Ã© a lista que a pessoa confirma, e confirmar concede. A omissÃ£o nÃ£o concede nada.

Scripts `preinstall`, `install`, `postinstall` e `prepare` nÃ£o rodam. Se existirem, a confirmaÃ§Ã£o leva `scripts: "do-not-run"`. `approvedBuilds` e `allowBuilds` sÃ£o recusados.

O pacote tem de estar dentro da pasta de plugins: `OH_CORDIS_PLUGINS_DIR` (absoluta) ou `~/.oharness/plugins`. O digest cobre o arquivo de entrada e o hash de todos os arquivos do pacote, entÃ£o editar o pacote depois da prÃ©via exige uma prÃ©via nova. O token Ã© da UI e do sidecar, nunca do agente.

`POST /v1/plugins/unload {name}` para o plugin (`name` é o nome do pacote, como em `GET /v1/plugins`) e o esquece: um plugin isolado tem o processo parado, um `in-process` tem o fiber descartado, e a cópia privada é apagada. Depois disso outra versão pode ser instalada sem reiniciar o host. Nome desconhecido responde 404 `plugin-not-found`.

## Isolamento

Com `runtime: isolated`, sem capacidade, o processo do plugin sÃ³ lÃª o snapshot do pacote e os mÃ³dulos fixados do host. Ele nÃ£o escreve em disco, nÃ£o abre processo, nÃ£o sinaliza o host nem abre o inspector dele, e nÃ£o recebe as variÃ¡veis de ambiente do host (no Windows, o Node completa as variÃ¡veis padrÃ£o do usuÃ¡rio, como USERPROFILE, TEMP e PATH). A rede nÃ£o Ã© limitada: o plugin alcanÃ§a a internet e os serviÃ§os de loopback, inclusive este host, que exige o token. Isso Ã© um processo separado com limites, nÃ£o isolamento completo. Cada capacidade tira um limite:

| Capacidade | Concede |
|---|---|
| `files` | ler e escrever qualquer arquivo que o usuÃ¡rio alcanÃ§a, inclusive o cÃ³digo deste host: equivale a controlÃ¡-lo |
| `processes` | abrir processos, que rodam fora desses limites |
| `credentials` | o ambiente do host |
| `network` | nada a mais: no Node 22 e no 24 a rede nÃ£o Ã© limitada |

O filho fala com o host por NDJSON no fd 3, com teto de 1 MiB por linha medido antes do parse, e o host valida cada mensagem. Do filho sÃ³ voltam nomes de tools, comandos, projeÃ§Ãµes e serviÃ§os; serviÃ§os e eventos nÃ£o cruzam entre plugins. `emit` vai para todos os plugins isolados, sem filtro. `runtime: in-process` roda no processo do host e sÃ³ Ã© aceito com as quatro capacidades declaradas. Os limites e as fontes estÃ£o no ADR 0071, item 10. Os testes de cada recusa estÃ£o em `test/isolation.test.ts`.

O processo pai segura o stdin do host. Quando ele fecha, o host sai. Por isso `npm start` num terminal funciona, e `npm start < /dev/null` sai logo.

## Cordis

O pacote Ã© `cordis@4.0.0-rc.11`, o mesmo commit que o DeepSeek Harness registra em `vendor/README.md` (`0b96d9fd517b998e44e2209560c9e5f0671ce933`). A integridade estÃ¡ no `package-lock.json` e em `src/pin.ts`. As modificaÃ§Ãµes locais V1â€“V27 do DSH nÃ£o entram. `@deepseek-ai/cordis` nÃ£o Ã© instalado; um hook de carregamento aponta esse specifier para o tarball acima, para haver uma sÃ³ instÃ¢ncia do mÃ³dulo.

Schemastery Ã© o tarball npm `3.18.0` (`gitHead` `9e1f54f8`). O DSH vende outro commit (`cf0b7e54`) com o mesmo nÃºmero de versÃ£o. O teste de pin registra essa diferenÃ§a.

Duas fontes de plugin do DSH estÃ£o em `vendor/dsh/` (`directory-picker` e `tool-todo`), com blob SHA em `vendor/dsh/PIN.json`, commit `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`, licenÃ§a MIT.

O Node 22 precisa de `--experimental-transform-types` para carregar essas fontes: o apagador de tipos estÃ¡vel recusa propriedades de parÃ¢metro, e o `DirectoryPickerError` do DSH usa esse recurso. Os scripts deste pacote jÃ¡ passam a flag.

## O que as provas mostram

1. Um plugin nosso sÃ³ Ã© avaliado depois da confirmaÃ§Ã£o. Ferramenta, comando, evento e serviÃ§o rodam no processo isolado dele (o pid Ã© outro) e atravessam pelo canal do fd 3.
2. O serviÃ§o `DirectoryPicker` do DSH, carregado `in-process`, cujo Ãºnico import de biblioteca Ã© Cordis, registra `directoryPicker` e a instÃ¢ncia viva estende a classe vendorizada.
3. O `tool-todo` do DSH, isolado, registra `todo_write` no serviÃ§o `tools`. Sem sessÃ£o de agente, o corpo do plugin recusa a chamada. Com um objeto de sessÃ£o mÃ­nimo, cujo `append` atravessa o canal, ele grava `todo/write` e devolve as contagens. A projeÃ§Ã£o `todos` fica sÃ³ registrada: `apply` nÃ£o Ã© chamado.

O que nÃ£o fecha, de propÃ³sito: o `defineTool` daqui nÃ£o valida o schema (um campo extra passa, e o teste mostra isso); nÃ£o hÃ¡ pipeline, prompt de sistema nem guarda do DSH; nÃ£o hÃ¡ log de sessÃ£o; patches de bundle sÃ£o ignorados; a rede nÃ£o Ã© limitada no runtime isolado.

A decisÃ£o estÃ¡ no ADR 0071.
