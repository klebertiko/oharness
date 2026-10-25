# ADR 0007 — Auto-layout em camadas do grafo no Studio: dagre

Status: Aceito (2026-10-10)

## Contexto

O exemplo "OHarness Agile" abria bagunçado no Studio. A causa não é o
Studio sobrescrever posições: `backend/oharness/fixtures/default-agile.ohm`
(e o `default-agile.legacy.json` que o teste de codec exige idêntico) **não
guarda posição alguma** em nenhum dos 9 nós. Sem `position`, `bundleGraphToCanvas`
(`frontend/src/lib/bundleGraph.ts`) cai num fallback de grade cega,
`x = 80 + (i % 4) * 180`, `y = 80 + ⌊i / 4⌋ * 100`, na ordem do arquivo. A
placa de um nó mede 212 px de largura (`PLATE_W` em `BaseNode.tsx`), então
colunas vizinhas se sobrepõem em 32 px, e a ordem do arquivo não tem relação
com as arestas (PO, SM, BE, FE, QA, ARCH, TW, SEC, HITL caem em 3 linhas que
ignoram o fluxo). Os exemplos DeepSeek e Matt Pocock já trazem posições
autoradas à mão e abrem limpos.

Faltava também uma forma de o usuário arrumar o próprio grafo: a spec do
redesign (PR #92, branch `design/studio-creation-redesign`, arquivo
`docs/design/studio-redesign/README.md`, slice S6, "Shift L tidy layout") pede um auto-layout e registra que não há biblioteca de layout nas
dependências e que a escolha exige ADR (dagre vs elkjs).

## Opções medidas

Mesmo grafo real (os três exemplos distribuídos), placas 212 × 120 px,
espaçamento 48 px entre nós e 96 px entre camadas nas duas, layout da esquerda
para a direita. Medido por `frontend/scripts/bench-graph-layout.mjs`
(reproduzível: `npm i --no-save elkjs@0.12.0 && node scripts/bench-graph-layout.mjs`):
bundle com esbuild `--minify` do import mínimo de cada biblioteca e gzip -9;
tempo em Node numa chamada (varia por execução e máquina, tome a ordem de
grandeza); qualidade com placas 212 × 120. Versões: `@dagrejs/dagre` 3.1.1 e `elkjs`
0.12.0.

| | dagre | elkjs |
|---|---|---|
| Bundle minificado | 47,1 KB (16,4 KB gzip) | 1 426 KB (430 KB gzip) com `elk.bundled.js`; 5,3 KB só com `elk-api`, mas então exige o worker `elk-worker.min.js` separado (1 595 KB, `wc -c` do arquivo; medido à parte, fora do script) |
| Licença | MIT | EPL-2.0 OR GPL-3.0-or-later |
| Dependências | `@dagrejs/graphlib` | nenhuma (GWT compilado) |
| Último release | 3.1.1, 2026-08-08 (repo com push em 2026-08-08, não arquivado) | 0.12.0, 2026-07-17 (repo com push em 2026-10-06, não arquivado) |
| Layout no Agile (9 nós) | 0 sobreposições, 0 cruzamentos, 0 arestas para trás | idêntico |
| Layout no DeepSeek (14) / Matt Pocock (15) | 0 / 0 / 0 em ambos | idêntico |
| Tempo (Agile / DeepSeek / Matt Pocock) | ~17 a 25 ms / ~8 a 17 ms / ~9 a 19 ms | ~63 a 290 ms (Agile ~290, DeepSeek ~80, Matt Pocock ~63) |
| API | síncrona | assíncrona (Promise, worker) |

Linha de base do que o usuário via no Agile (grade de fallback): 18 pares de placas sobrepostos
(placa 212 × 120), 1 cruzamento e 3 arestas apontando para trás.

Medido ad hoc em 2026-10-10, sem script (não fazem parte da decisão): a
comparação de largura/altura totais entre os layouts. Fontes: registro npm (`npm view` para versão, licença e datas de publicação) e
API do GitHub (`archived`, `pushed_at`, último release) de `dagrejs/dagre` e
`kieler/elkjs`, consultadas em 2026-10-10. Ambos os projetos estão mantidos.

## Evidência no app

Capturas do Studio (1131 × ~726 px) com o backend de desenvolvimento servindo os
fixtures:

- Antes: [`0007-assets/agile-before.jpg`](0007-assets/agile-before.jpg), as 9
  placas empilhadas em 3 linhas, uma sobre a outra.
- Depois: [`0007-assets/agile-after-fixture.jpg`](0007-assets/agile-after-fixture.jpg),
  o exemplo abre em camadas, status "Example · Not saved yet" (as posições
  gravadas são usadas e abrir não suja o documento).

Os exemplos DeepSeek e Matt Pocock já trazem posições boas (0 sobreposições,
0 cruzamentos de centro a centro, 0 arestas para trás nas métricas acima) e
**não foram alterados**.

## Decisão

Adotar **`@dagrejs/dagre`** (versão fixa, sem `^`) atrás de uma função pura
`layoutGraph(nodes, edges, opts) => positions` em `frontend/src/lib/graphLayout.ts`.

- Em grafos do tamanho dos que o Studio edita (dezenas de nós), os dois
  produzem layouts equivalentes nas métricas acima; o elkjs só ganharia em
  portas explícitas, ligações hierárquicas e roteamento de arestas, nada disso
  usado hoje (o roteamento é do `HarnessWire`).
- Custa 26 vezes menos no bundle (16,4 KB contra 430 KB gzip), é
  síncrona (um botão que arruma o grafo e desfaz num único passo) e é MIT.
- O seam isola a escolha: trocar por elkjs mais tarde muda um arquivo, sem
  tocar canvas, store ou fixtures.

## Contrato

1. `layoutGraph` recebe ids, tamanho medido de cada placa (ou 212 × 120 quando
   desconhecido; superestimar só adiciona respiro) e arestas; devolve a posição
   do canto superior esquerdo, inteira. Arestas para ids inexistentes,
   auto-laços e duplicatas são ignoradas; ciclos são quebrados internamente
   (`acyclicer: greedy`); nós sem arestas entram sem erro. Determinístico: só
   depende da ordem de entrada.
2. Direção padrão da esquerda para a direita; `TB` disponível.
3. O botão "Auto-arrange graph" do dock do canvas, o comando da paleta e o atalho
   `Shift+L` (fora de campos de texto) chamam `arrangeGraph()` do `canvasStore`.
   Isso aplica o layout como **um único passo de undo** (`applyGraphPatch`),
   só move nós (ids, dados e ligações intactos), não faz nada sem nós ou durante
   uma run, e enquadra a vista depois. O documento fica "unsaved" pelo mesmo
   caminho de qualquer outra edição (o autosave compara o conteúdo, posições
   incluídas).
4. As posições do exemplo Agile foram geradas uma vez com este `layoutGraph`
   (placas 212 × 120, sem script de regeneração commitado) e gravadas no
   fixture; DeepSeek e Matt Pocock mantêm as suas. Um teste de backend
   (`backend/tests/oharness/test_example_layout.py`) não gera nada: apenas
   falha se um exemplo distribuído ficar sem posição, com placas 212 × 120
   sobrepostas, ou com o fluxo majoritariamente para trás.
5. O atalho `Shift+L` é ignorado em campos de texto e dentro de widgets com
   typeahead (`[role=listbox]`, `[role=menu]`, `[role=combobox]`).

## Consequências

- Uma dependência de runtime nova (`@dagrejs/dagre` e sua dependência
  `@dagrejs/graphlib`, ambas MIT).
- Dagre não conhece portas: a ordem vertical dentro de uma camada não considera
  qual saída (`pass`/`fail`, `approve`/`reject`) alimenta qual nó, então um grafo
  muito ramificado pode ter cruzamentos que um layout com portas evitaria. Se
  isso aparecer em grafos reais, a troca é local ao seam.
- Reorganizar sobrescreve posições à mão; por isso é um passo de undo e nunca
  roda sozinho ao abrir um grafo que já tem posições.
