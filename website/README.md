# OHarness website

Página de produto independente do desktop, em português brasileiro (pt-BR). HTML, CSS e JavaScript nativos, sem dependências de execução ou build.

```powershell
cd D:\Development\src\OHarness\website
npm run dev
```

Prévia: http://127.0.0.1:4174. O servidor escuta apenas no loopback; `PORT` permite trocar a porta.

## Idiomas e GitHub Pages

- pt-BR: https://klebertiko.github.io/OHarness/
- en-US: https://klebertiko.github.io/OHarness/en/

As três páginas possuem versões estáticas nos dois idiomas, inclusive sem JavaScript. O seletor EN/PT mantém a página e, com JavaScript, sua seção atual. A navegação mantém o idioma escolhido pela URL; não há redirecionamento automático pelo idioma do navegador. A preferência de tema é compartilhada entre idiomas.

Edite o conteúdo português nas páginas da raiz e as traduções em `locales/en-US.json`. Execute `npm run build` para regenerar `en/`, os downloads traduzidos, os seletores e os metadados canônicos/hreflang. O gerador recusa texto novo sem tradução; não edite as páginas inglesas geradas diretamente. Os textos dinâmicos ficam em `i18n.js`; os rótulos de tema em `theme.js` carregam antes da pintura da página.

`npm run build:pages` gera somente os arquivos públicos em um diretório novo `artifacts/pages-<id>/` e informa o caminho. Para escolher o destino, use `npm run build:pages -- <diretorio-ainda-inexistente>`. Destinos existentes são recusados sem alteração; o gerador verifica o inventário final. O workflow `.github/workflows/pages.yml` executa `build:pages` a cada push na `main` que altere `website/**` e publica o artefato com GitHub Actions (detalhes e cut-over em `docs/ci-security.md`). Não edite a branch `gh-pages` à mão; ela fica só como fallback até o primeiro deploy pelo workflow ser verificado. Não publique a pasta inteira de desenvolvimento: notas, testes, servidor local e artefatos internos ficam fora da lista de arquivos públicos. O aplicativo e seus PRs continuam na `main` e nas branches de trabalho.

Antes de publicar, siga `SECURITY.md`: testes, revisão independente e ausência de achados conhecidos não resolvidos ou não aceitos explicitamente pelo responsável. `npm run test:publication` verifica isolamento do artefato; `npm run test:security` verifica a aplicação real da CSP e a recuperação do Nilo nos dois idiomas. Esses testes são internos e não entram na publicação.

`npm run test:i18n` verifica os dois idiomas, páginas, temas, cinco larguras de tela, navegação, caminhos de assets, downloads e conteúdo sem JavaScript. Para testar Nilo em inglês, execute `npm run test:playback` com `WEBSITE_URL=http://127.0.0.1:4174/en` e `WEBSITE_LOCALE=en-US`. Os testes usam o mesmo `PLAYWRIGHT_MODULE` e `BROWSER_CHANNEL` descritos abaixo.

## Conteúdo

- `index.html`: produto, diagrama interativo, capturas, introdução OHM e manifesto.
- `model.html`: estrutura do formato, exemplo copiável, schema e limites atuais.
- `manifesto.html` e `MANIFESTO.md`: declaração original de princípios, em leitura web e Markdown.
- `CONTENT-NOTES.md`: conferência editorial interna, com fontes locais.
- `examples/hello.ohm`: exemplo YAML do formato adotado, com prompt multilinha. Suporte do desktop em migração.
- `examples/hello-legacy.json`: fixture JSON original, preservada como exemplo legado.
- `examples/ohm.schema.json`: cópia do schema do backend. Atualizar junto da referência quando ele mudar.
- `theme.js`: tema do sistema na primeira visita e escolha persistida entre as três páginas.
- `nilo.js` e `motion.css`/`motion.js`: demonstração do mascote, cena com enquadramentos e entradas suaves.
- `assets`: fontes Sora/IBM Plex Mono e marca já usadas pelo app; capturas reais de uma sessão isolada de demonstração. Só Studio e Chats são publicadas; as capturas Automate e Pull requests ficam no repositório, fora da lista pública, desde 10/10/2026.

O site não acessa o backend, não executa agentes, não coleta dados e não anuncia instalador disponível. Links são relativos para funcionar também sob subdiretórios. As URLs canônicas apontam para o GitHub Pages acima.

## Direção visual

Sistema herdado de `../design.md`: Sora + IBM Plex Mono, papel marfim, grafite, teal mineral e Nilo original. Estrutura Map / Diagram com navegação N1b e rodapé Ft2. Interações: seleção de peças do harness; abas de produto com navegação por teclado; ampliação nativa via dialog; cópia de YAML. Respeita movimento reduzido e mantém leitura sem JavaScript.

Referências consultadas: Awwwards, Behance, Savee, Cosmos, Dribbble e CSS Design Awards, além da página local NightwolfRGB. A página da comunidade Figma indicada não pôde ser carregada. Referências usadas para hierarquia, espaço e apresentação, sem copiar composição ou assets.

Os valores do manifesto se inspiram no contexto legível de [AGENTS.md](https://agents.md/), nas conexões do [MCP](https://modelcontextprotocol.io/docs/getting-started/intro) e na declaração de princípios do [Manifesto Ágil](https://agilemanifesto.org/iso/ptbr/manifesto.html). Não representam afiliação.

## Decisão de formato

YAML 1.2 é a sintaxe adotada para `.ohm`; o desktop ainda precisa implementar a migração. A página informa esse estado. Ver `../docs/adr/0003-ohm-yaml.md` e `../docs/product/ohm-yaml-migration.md`. JSON permanece nas APIs e como importação legada. A troca de sintaxe não implementa ciclos no motor.

## Temas, leitura e movimento

O seletor no cabeçalho alterna claro/escuro. A preferência fica em `oharness-website-theme`; sem escolha, acompanha o sistema. As capturas reais de Studio e Chats acompanham o tema. Os dados das capturas são de demonstração, sem gravações no backend.

Textos de leitura usam 15–17 px, com referências e controles menores a partir de 12 px. Os títulos preservam espaços quando uma quebra de linha deixa de aparecer no celular. O manifesto acompanha o fluxo da página para não invadir a nota seguinte.

Nilo é apresentado na seção `#nilo`. Suas poses vêm das funções canônicas do desktop. Para atualizar os quadros após uma alteração no app, a partir da raiz do repositório:

```powershell
node website/scripts/build-nilo.cjs
```

A geração usa o TypeScript já instalado no frontend; a página publicada não depende dele. O arquivo gerado possui aproximadamente 20 kB e carrega quando o mascote entra em cena. Nilo anima somente enquanto está visível, oferece pausa e mantém poses estáticas com movimento reduzido. Uma cena de 8 segundos percorre cumprimento, pensamento e trabalho com luz e aproximações de câmera. Um único botão alterna entre “Pausar cena”, “Continuar cena” e “Ver novamente”. A pausa preserva quadros, câmera e progresso; sair da tela suspende o relógio sem reiniciar. Clicar no Nilo tem o mesmo efeito do botão. Com movimento reduzido, o controle passa a “Próxima expressão” e mostra poses estáticas. As entradas de seções não escondem conteúdo quando JavaScript está indisponível.

As referências seguem uma ordem didática: engenharia de prompts, AGENTS.md, Agent Skills, MCP, A2A e Manifesto Ágil. São fontes do ecossistema, não uma lista de integrações homologadas.

## Teste de reprodução do Nilo

Com a prévia em execução, use `npm run test:playback`. O teste usa Playwright de desenvolvimento (disponível no ambiente ou indicado por `PLAYWRIGHT_MODULE`) e o canal Edge instalado; `BROWSER_CHANNEL` permite outro canal. Não adiciona dependências à página publicada. `WEBSITE_URL` permite testar outro endereço local.

A regressão cobre entrada direta em `#nilo`, pausa de sprite/câmera/progresso, continuação após rolagem, fim e repetição, teclado, celular e movimento reduzido. A falha anterior era o cancelamento da sequência por `stopFilm()` durante a pausa; agora todos os elementos usam o mesmo tempo de reprodução.
