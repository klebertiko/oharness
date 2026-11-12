# Host Node de Cordis plugins

Processo Node separado do sidecar FastAPI. Escuta só em `127.0.0.1`, com porta escolhida pelo sistema e um token novo a cada arranque. O plugin roda no mesmo processo (`runtime: in-process`).

```bash
cd cordis-host
npm ci --ignore-scripts
npm test
npm start
```

`npm start` escreve uma linha JSON em stdout: `host`, `port`, `token`, `cordis`, `runtime`. O token não sai em outro canal. As rotas exigem `Authorization: Bearer <token>` e `Host: 127.0.0.1:<porta>`.

## Instalação

`POST /v1/plugins/preview` lê o pacote e devolve o aviso, sem importar o código. `POST /v1/plugins/install` só importa depois de `confirmation.accept: true` e do `digest` dessa prévia.

O aviso, em inglês e pt-BR, diz que um plugin de terceiros pode alcançar arquivos, rede, processos e credenciais, e que sandbox e aprovação protegem as ações do agente, não o código do plugin. `oharness.capabilities` é uma declaração confirmada pela pessoa. Não é um sandbox.

Scripts `preinstall`, `install`, `postinstall` e `prepare` não rodam. Se existirem, a confirmação leva `scripts: "do-not-run"`. `approvedBuilds` e `allowBuilds` são recusados. `oharness.runtime: "isolated"` é recusado.

## Cordis

O pacote é `cordis@4.0.0-rc.11`, o mesmo commit que o DeepSeek Harness registra em `vendor/README.md` (`0b96d9fd517b998e44e2209560c9e5f0671ce933`). A integridade está no `package-lock.json` e em `src/pin.ts`. As modificações locais V1–V27 do DSH não entram. `@deepseek-ai/cordis` não é instalado; um hook de carregamento aponta esse specifier para o tarball acima, para haver uma só instância do módulo.

Schemastery é o tarball npm `3.18.0` (`gitHead` `9e1f54f8`). O DSH vende outro commit (`cf0b7e54`) com o mesmo número de versão. O teste de pin registra essa diferença.

Duas fontes de plugin do DSH estão em `vendor/dsh/` (`directory-picker` e `tool-todo`), com blob SHA em `vendor/dsh/PIN.json`, commit `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb`, licença MIT.

O Node 22 precisa de `--experimental-transform-types` para carregar essas fontes: o apagador de tipos estável recusa propriedades de parâmetro, e o `DirectoryPickerError` do DSH usa esse recurso. Os scripts deste pacote já passam a flag.

## O que as provas mostram

1. Um plugin nosso só é avaliado depois da confirmação. Ferramenta, comando, evento e serviço rodam neste processo (o pid coincide).
2. O serviço `DirectoryPicker` do DSH, cujo único import de biblioteca é Cordis, registra `directoryPicker` e a instância viva estende a classe vendorizada.
3. O `tool-todo` do DSH registra `todo_write` no serviço `tools` deste host. Sem sessão de agente, o corpo do plugin recusa a chamada. Com um objeto de sessão mínimo, ele grava `todo/write` e devolve as contagens. A projeção `todos` fica só registrada: `apply` não é chamado.

O que não fecha, de propósito: o `defineTool` daqui não valida o schema (um campo extra passa, e o teste mostra isso); não há pipeline, prompt de sistema nem guarda do DSH; não há log de sessão; patches de bundle são ignorados; não há runtime isolado.

A decisão está no ADR 0069.
