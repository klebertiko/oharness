# ADR 0015 — Combo com centenas de modelos: lista única agrupada por conexão, com busca

Status: Aceito (reversível) · 2026-10-28 · Issue #85 (mapa #82, P3) · Código: `frontend/src/components/providers/modelSearch.ts`

## Contexto
Com OpenRouter conectado o endpoint devolve centenas de ids (`vendor/modelo[:variante]`). O combo do chat (#89) lista as conexões prontas com os
modelos de cada uma. Duas formas: **lista única agrupada por conexão com busca**, ou **dois níveis** (conexão, depois modelos).

## O que não foi feito
- O sandbox desta sessão não alcança a internet, então **não há a lista real de `GET /models` do OpenRouter**. O teste usa uma lista sintética de
  mais de 400 ids no mesmo formato (vendors, famílias, sufixos `:free`, variantes datadas), mais uma conexão Ollama com 3 modelos.
- Não houve tarefa cronometrada com pessoas. O "tempo para achar um modelo conhecido" abaixo é contagem de teclas e custo de filtragem, não segundos
  de usuário.

## Medido (teste `modelSearch.test.ts`)
| | Lista única agrupada com busca | Dois níveis |
|---|---|---|
| Teclas para `openai/gpt-4o` (abrir o combo já foca a busca) | 6 digitos + Enter | abrir conexão (1) + 6 digitos + Enter, e só dentro de uma conexão |
| Achar um modelo sem saber a conexão | 1 busca, todas as conexões | impossível sem abrir cada nível |
| Custo de filtrar ~500 ids | menos de 0,5 ms por tecla (200 filtragens em menos de 100 ms, incluindo setup do teste) | igual |
| Primeira linha após a busca | o modelo esperado para `gpt-4o`, `opus`, `r1`, `qwen3` | n/a |

## Decisão
**Lista única agrupada com busca.**
- Cada grupo mostra uma fatia curta sem consulta (8) e mais com consulta (25), e diz quantos esconde ("+N modelos, refine a busca"); grupos sem
  resultado somem enquanto se digita.
- Ranking: id exato, prefixo, início de palavra, trecho; todos os termos precisam casar; empate vai para o id mais curto.
- Teclado (implementado no combo, #89): digitar filtra; ↑/↓ percorrem as linhas atravessando os grupos; Enter escolhe (salva o padrão, ADR 0014);
  `Shift+Enter` escolhe só para a conversa; Esc limpa a busca e, vazia, fecha e devolve o foco ao chip.

## Por quê
Quem sabe o modelo digita o nome; quem não sabe vê as conexões prontas com poucas linhas cada. Dois níveis custam um passo a mais em todos os
casos e não permitem buscar entre conexões. A lista longa só existe dentro de um grupo e nunca é renderizada inteira.

## Consequências
- O combo (#89) usa `filterModelGroups` e não renderiza mais que `IDLE_CAP`/`QUERY_CAP` linhas por grupo.
- Se a lista real do OpenRouter tiver padrões que o ranking trate mal, ajustar `scoreModel` e acrescentar o caso ao teste; nenhum dado depende disso.
- Reverter para dois níveis é trocar o componente do combo; `filterModelGroups` serve aos dois.
