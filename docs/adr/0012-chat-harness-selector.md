# ADR 0012 — Seletor compacto de harness no chat: lista em popover, identidade e propósito, uma rota para o Studio

Status: **Proposta, reversível** · 2026-10-28 · Issue #74 (wayfinder #70) · Depende do ADR 0011 · Protótipo: `docs/design/harness-selector/index.html` · Código: `lib/harnessOptions.ts`, `store/harnessRecentStore.ts`, `components/agent/HarnessSwitch.tsx`

## Alternativas (ambas operáveis só pelo teclado, no protótipo)
| | A. Popover com lista (listbox) | B. Chips em linha (radiogroup) |
|---|---|---|
| Escala | Qualquer número; grupos, filtro, recentes | Quebra e lota a barra com 5+ |
| Propósito de cada harness | Linha de descrição por opção | Não cabe |
| Estados vazio / carregando / erro / indisponível | Têm lugar natural | Precisam virar A |
| Consistência | Mesmo contrato dos seletores de provider e modelo (`Combobox`) | Padrão novo |
| Custo | Um clique a mais para ver as opções | — |

## Decisão (A)
- **Gatilho:** ícone + nome do harness (ou "No harness"), truncado; nome acessível `Harness: <nome>`. Harness indisponível: "<nome> (unavailable)" em cor de aviso; carregando: "Loading…".
- **Hierarquia:** "No harness" fixo no topo ("Talk to the model directly") → *Unavailable* (só se a conversa aponta para um harness que sumiu, desabilitado e explicado) → *Recent* (até 3, só a partir de 6 harnesses) → *Your harnesses* → *Bundled harnesses*. Cada opção mostra nome e **propósito** (primeira frase da descrição; sem descrição: "Bundled harness"/"Imported harness"). **Nunca** mostra provider, modelo ou conexão.
- **Limiar de busca:** o filtro aparece a partir de **8 opções** (contando "No harness"); abaixo disso a lista cabe numa olhada.
- **Selecionado / recente / bundled:** o selecionado leva o check do `Combobox` (`aria-selected`); recentes são *movidos* para o grupo Recent (sem duplicar); bundled ficam sob o próprio título, depois dos do usuário (que são o que ele mais provavelmente procura).
- **Estados:** carregando ("Loading harnesses…", "No harness" continua disponível); erro ("Couldn't load harnesses." + "Try again" dentro da lista); vazio ("No harnesses yet. Create one in Studio." + "Open Studio").
- **Única rota ao Studio:** um botão no rodapé da lista — "Edit in Studio" (harness em uso, carrega o grafo dele) ou "Open Studio" (sem harness/indisponível). Nenhuma outra saída, e **gerência de providers nunca aparece** neste controle (teste e e2e verificam o texto).
- **Teclado/a11y:** Enter/Seta abre; setas movem (`aria-activedescendant`), Enter escolhe, Esc fecha e devolve o foco ao gatilho; a lista é uma região nomeada ("Harness picker").

## Consequências
- Um harness vindo do Studio ("Use in chat") aparece em *Your harnesses* com "From Studio" enquanto estiver ativo.
- Os limiares (`SEARCH_FROM = 8`, `RECENT_FROM = 6`) são constantes em `harnessOptions.ts`.
