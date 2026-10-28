# ADR 0010 — Ciclo de vida da proposta de Nilo: pré-visualizar, aplicar parcialmente, manter ou desfazer

Status: **Proposta, reversível** · 2026-10-28 · Issue #72 (wayfinder #70) · Depende do ADR 0009 · Código: `lib/copilot/rules.ts`, `lib/copilot/preview.ts`, `store/copilotStore.ts`, `components/copilot/ProposalCard.tsx`, `components/canvas/useProposalGhosts.ts`

## Contexto
Hoje a proposta de Nilo é **aplicada ao canvas antes da revisão** (`applyGraphPatch` no recebimento) e só então oferece Keep/Undo; os nós novos podem cair fora da tela (achado A1 do audit #92). "Você revisa cada mudança" era falso.

## Decisão
Uma única máquina de estados e uma única tabela (`rules.ts`) lidas pelo **validador** (forma de cada op) e pela **UI** (preview, controles por estado).

| Estado | Toca o canvas vivo? | Controles | Próximos |
|---|---|---|---|
| `pending` (proposta) | **Não.** Só fantasmas tracejados, marcas "edited"/"removal" e enquadramento da câmera | Apply N, Discard (Esc), Refine, caixa por mudança | `applied`, `rejected`, `replaced` (novo prompt), `stale` |
| `stale` (conflito) | Não | Discard, Refine | `rejected`, `replaced` |
| `applied` | **Sim**, um único passo de undo | Keep, Undo (enquanto for o topo do histórico) | `kept`, `undone`, `kept` (novo prompt) |
| `kept` / `undone` / `rejected` / `replaced` | — | nenhum (terminais) | — |

Regras que a tabela fixa:
- **O que é pré-visualizado:** `addNode` → nó fantasma; `connect` → fio tracejado; `updateNode` → marca "edited"; `removeNode` → nó atenuado "removal"; `disconnect` → sem fantasma (aparece na lista). Nada disso entra no store do canvas nem no histórico.
- **Refinar só uma parte:** cada mudança tem caixa de seleção. Desmarcar um `addNode` desmarca o que depende dele (fios, edições); remarcar uma dependente remarca o nó de que precisa. O refino por texto ("Refine") foca o campo; o próximo prompt carrega ao Nilo o que foi proposto, mantido ou descartado (`historyText`).
- **Keep / Undo / Reject entre prompts:** novo prompt **mantém** o que já foi aplicado (Undo some, Ctrl+Z continua) e **substitui** a proposta ainda pendente (nada a desfazer). Reject nunca toca o canvas.
- **Conflito:** a proposta inteira é revalidada contra o grafo vivo a cada mudança *estrutural* (nós/fios); se não cabe mais, vira `stale` com explicação. Se só a **seleção** da pessoa não cabe (p.ex. estoura o limite de nós), Apply fica bloqueado com o motivo do validador e a proposta segue `pending`. Nada é aplicado parcialmente. Run em andamento desabilita Apply, com o motivo escrito.
- **Falha:** erro do modelo/rede continua sendo um turno de erro com "Try again"; nenhuma proposta nasce, e uma proposta pendente de antes **permanece** (só é substituída quando a resposta nova chega).
- **Segurança:** Nilo só emite ops da tabela; campos fora de `EDITABLE` e a lista `NILO_FORBIDDEN_FIELDS` (credenciais, providers, campos executáveis, cwd) são recusados pelo validador e nunca saem do navegador.
- **Acessibilidade:** a chegada é anunciada (`role=status`), o foco vai para Apply, Esc descarta, fantasmas têm `aria-label="Proposed: …"` e o estado nunca é só cor (tracejado + texto "proposed").

## Consequências
- Mudança de comportamento: antes "mover-se adiante aceitava"; agora mover-se adiante **substitui** a pendente. É a leitura honesta de "você revisa cada mudança".
- Trocar a regra (p.ex. auto-aplicar quando não há dependentes) é editar uma linha da tabela, sem tocar UI nem validador.
