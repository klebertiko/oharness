# Verificação da revisão — 22/10/2026 (0.0.1-alpha)

Esta seção substitui os números das verificações de setembro abaixo, que descrevem uma versão anterior (duas capturas, sem seção Baixar).

## Atualização pós-#141/#144 (22/10/2026)

As dez capturas foram refeitas na UI redesenhada (main em 944a5bb) e a marca virou OHarness: nomes de arquivo `OHarness-*`, `--repo klebertiko/oharness`, links do Pages com `/oharness/` (repositório já renomeado no GitHub). A seção Baixar e os alts foram atualizados. Os resultados medidos abaixo foram repetidos depois da fusão; ver a lista no relatório da revisão.

## O que mudou

- Tour do produto com cinco capturas reais, nos dois temas: Chats, Studio, Canvas, Execução e Provedores. Legenda padrão: captura real do app 0.0.1-alpha, perfil isolado, sem provedor conectado, execução simulada (mock), interface em inglês. A captura de setembro foi removida.
- Seção Baixar com o link da etiqueta `v0.0.1-alpha`, arquivos reais da matriz de `release.yml`, aviso de instaladores sem assinatura, comandos de verificação e limites conhecidos.
- Auditoria das afirmações das três páginas: tabela em `CONTENT-NOTES.md`.

## Resultados medidos

Comandos executados em `website/` com Playwright 1.63 e o canal Edge (`PLAYWRIGHT_MODULE` apontando para o Playwright do `frontend`), servidor `npm run dev` em 127.0.0.1:4174:

- `npm run build`: "Generated three en-US pages, localized downloads, language links, and metadata."
- `npm run test:i18n`: "PASS: bilingual pages, 32 local URLs, runtime text, downloads, no-JS content." (seis páginas, dois temas, cinco larguras: 320, 375, 414, 768 e 1280 px; sem overflow nem colisão no cabeçalho; as cinco abas do tour carregam a imagem do tema).
- `npm run test:publication`: "PASS: stale output rejected unchanged; fresh public inventory and security metadata verified." (inventário de 39 arquivos públicos).
- `npm run test:security`: "PASS: CSP enforcement on all six pages; malformed Nilo data fallback and retry in both languages."
- `npm run test:playback`: "PASS: direct #nilo entry, pause/continue/replay, frozen camera, scroll, keyboard, mobile and reduced motion."
- Inspeção visual (capturas locais, fora do repositório): index em 1280 px e 360 px, seções Produto e Baixar, nos dois temas. Sem overflow horizontal na página inicial em 320, 360, 375, 414, 761, 768, 900, 1024 e 1280 px.

Correções feitas durante a verificação: com cinco abas, o tour estourava a largura entre 761 e 1050 px; as abas ficaram mais compactas nessa faixa. A coluna da seção Baixar ganhou `min-width: 0` para os nomes de arquivo não alargarem a página.

## Não verificado

- Nenhum link de download foi seguido: a release ainda é rascunho, então a página da etiqueta responde 404 até a publicação.
- Contraste e acessibilidade da seção Baixar foram vistos, não medidos com ferramenta.
- O site publicado (GitHub Pages) não foi reexaminado: esta revisão está só na branch.

# Verificação da página — 11/09/2026 (histórico, superado pela revisão acima)

Os números e as listas desta seção descrevem a versão de setembro (duas capturas, sem seção Baixar, marca anterior) e foram superados. Ficam só como registro.


Implementação independente do desktop. Não houve chamadas de escrita ao backend, execução de providers, criação de chats ou persistência de automações. As capturas do produto foram feitas em contexto isolado com gravações de API bloqueadas.

## Resultados medidos

- Landing, referência OHM e manifesto verificados nos dois temas em 320, 375, 414, 768, 900, 1024, 1100, 1120, 1280, 1440 e 1920 px: 66 combinações sem scroll horizontal ou colisões no cabeçalho e no diagrama.
- Diagrama sem interseção entre botões em 320, 375, 414, 768, 900, 1024, 1100, 1120, 1280, 1440 e 1920 px.
- Seleção de peças, tabs por clique/setas/Home/End, ampliação via dialog/Escape, menu móvel e fechamento na mudança de breakpoint: passaram.
- Downloads locais e links: passaram. O arquivo `.ohm` é servido como `application/yaml`.
- Código YAML copiado equivale ao download após parsing; exemplo passou no JSON Schema estrutural atual depois de leitura com PyYAML. Isso NÃO valida suporte do leitor desktop a YAML, ainda pendente.
- Movimento reduzido e leitura principal com JavaScript desabilitado: passaram.
- Sem erros JavaScript ou respostas HTTP >= 400 durante os fluxos verificados.
- Contraste de textos e controles amostrados, incluindo hover do CTA: mínimo 4,92:1 no tema claro e 8,12:1 no escuro. A verificação percorreu as três páginas; não é uma certificação completa de acessibilidade.

Ferramentas: Playwright com Edge headless; fontes locais; capturas e scripts de reprodução desta sessão em `artifacts/` (ignorado no Git). `verify.cjs` cobre navegação; `theme-qa.cjs` cobre temas, geometria, pt-BR e contraste; `tests/playback.cjs` cobre a regressão de reprodução; a verificação anterior de referências ficou registrada em `artifacts/nilo-qa.json`. Dependências de teste vêm dos runtimes locais registrados nesses scripts.

Uma revisão independente identificou menu móvel permanecendo aberto ao ampliar a janela: corrigido e coberto na verificação. A revisão visual detectou sobreposição de nós nas larguras intermediárias: corrigida e verificada nas onze larguras acima. Não foi atribuída nota numérica de design.

## Pendências externas à página

- Implementação YAML no desktop e fidelidade do roundtrip: plano em `../docs/product/ohm-yaml-migration.md`.
- Contrato de ciclos no motor: entrega separada no mesmo plano.
- Publicado no GitHub Pages em 11/09/2026: `https://klebertiko.github.io/oharness/`, com inglês em `/en/`, HTTPS e canonical/hreflang. Uma imagem social dedicada e um domínio próprio continuam opcionais.

O produto é mostrado em desenvolvimento, sem alegações de release, licença geral, métricas de adoção ou compatibilidade universal.

## Verificações desta revisão

- Tema inicial do sistema, atualização da preferência do sistema, persistência entre páginas/reload e alternância por teclado: passaram.
- Capturas de quatro telas nos dois temas, ampliação correta e abas por teclado: passaram.
- Textos visíveis a partir de 12 px; títulos “Da conversa ao sistema” e “Parte de uma conversa maior” mantêm espaços no celular.
- A assinatura do Nilo permanece acima da nota do manifesto ao percorrer a seção em passos de 100 px.
- Nilo: quadros canônicos, cena automática de 8 segundos, controle único por clique/Enter, pausa/continuação/repetição e poses estáticas com movimento reduzido. A seleção separada de expressões foi substituída pelo controle único.
- Cena cinematográfica: aproximação e transição para trabalho verificadas. A pausa anterior cancelava a sequência; essa falha foi reproduzida e corrigida com um relógio comum a sprite, câmera e progresso.
- Ordem das seis referências conferida pelo DOM. Fontes novas conferidas em documentação oficial em 11/09/2026.
- As oito capturas atuais do produto foram obtidas em contexto isolado: zero tentativas de escrita, zero rotas inesperadas e zero erros de página.

Relatórios reproduzíveis da sessão: `artifacts/theme-qa.json`, `artifacts/nilo-qa.json` e `artifacts/product-refresh/capture-report.json`.

## Correção dos controles de reprodução

Reprodução anterior: cena em `close`; pausar mudava para `wide`; reproduzir mantinha a cena cancelada (`data-playing=false`). O teste falhou antes da correção. Testes novos de navegador (`tests/playback.cjs`) passaram após a correção, em desktop e celular, inclusive acesso direto por hash, congelamento da câmera, pausa preservada ao rolar, continuação por Enter, repetição e movimento reduzido. O teste antigo verificava apenas mudança de sprite e cancelamento, insuficientes para detectar a perda da sequência.

## Publicação bilíngue — 11/09/2026

As três páginas têm conteúdo estático em pt-BR e en-US, incluindo títulos, metadados, descrições de imagens, rótulos acessíveis, downloads e mensagens dinâmicas. O catálogo inglês é verificado durante a geração; texto novo sem tradução interrompe o build. As imagens continuam sendo capturas reais do produto, compartilhadas pelos dois idiomas.

`tests/i18n.cjs` passou localmente: seis páginas × dois temas × cinco larguras (320, 375, 414, 768 e 1280 px), sem overflow nem colisões no cabeçalho. Foram verificados 30 URLs locais, troca de idioma mantendo página/hash/tema, assets dinâmicos, exemplo YAML consistente com o download, copiar e conteúdo sem JavaScript. A inspeção visual revelou que o link PT encostava na marca a 320 px; a marca agora não encolhe e o espaçamento dos controles se ajusta à largura. A verificação passou a conferir também se o ponto permanece dentro da caixa da marca.

`tests/playback.cjs` passou em português e inglês, em desktop e celular. Capturas locais da versão inglesa: `artifacts/i18n-en-1280.png` e `artifacts/i18n-en-320.png`.

O commit `86e5008` na branch `gh-pages` publica somente 37 arquivos públicos. O deploy `34630897227` concluiu com sucesso; as duas páginas iniciais responderam HTTP 200 e declararam os idiomas corretos. A `main` publicada é o commit inicial `9965518`. As alterações pendentes do aplicativo permanecem na branch de trabalho do Claude.

A verificação final também passou no endereço público: `test:i18n` conferiu as seis páginas, 32 URLs do site, imagens, troca de idioma/tema, conteúdo sem JavaScript e cópia real do YAML. O teste aguarda a operação assíncrona da área de transferência e normaliza CRLF do Windows ao comparar o conteúdo. `test:playback` passou novamente em inglês no GitHub Pages, em desktop e celular.
