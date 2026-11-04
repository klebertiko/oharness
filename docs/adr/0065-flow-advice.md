# ADR 0065 — Flow de regras: conselho como evidência, com liga/desliga

Status: aceita (primeira fatia, #333) · Prior art: estudo de Flow em `src/laya-playground/tools/flow_policy/` (função `advise`) e o handoff `2026-10-30-flow-to-openharness`.
Relacionada: [ADR 0005](0005-laya-decision-node.md) (resultado de modelo é evidência, nunca gate).

## Contexto

O estudo trata Flow como análogo da hipofrontalidade transitória: um estado em que o agente entra e sai conforme sinais da run. A política do estudo é uma função de regras, `advise`, que recebe uma percepção e devolve uma ação (`act`, `plan_once`, `raise`, `close`, `block`, `abstain`, `request_neighbor`). Laya e Clef só preenchiam a percepção a partir de texto e não melhoraram a política; ficam de fora.

O motor (`backend/engine.py`, `execute_harness`) já olha `RunControl.stop` antes de cada nó. A resolução de arestas condicionais vem depois e é o que o Flow não pode comandar.

## Decisão

1. **`backend/flow/policy.py`** é o módulo puro do estudo, copiado sem mudança de lógica (sem torch, sem modelo), com os 13 testes portados em `backend/tests/flow/`.
2. **Percepção só com fatos estruturados** (`backend/flow/advice.py`), lidos no checkpoint de `control.stop`:
   - `stop`: o operador pediu parada (`control.stop`);
   - `unsafe`: o nó traz `data.unsafe === true` (passo marcado como inseguro por quem desenhou o harness);
   - `goal_met`: o nó traz `data.goal` (texto) e o último resultado da run o contém (sem diferenciar caixa ou espaços; o motivo exibido, "public checks passed", vem da política e aqui significa só isso: o texto da meta apareceu);
   - repetição: o último resultado é igual ao que o próprio nó produziu da vez anterior (por exemplo, depois de um retry de Gate; dois nós diferentes repassando o mesmo texto não contam; não vazio) → faixa `no_signal`; caso contrário `matched`.
   Nenhum texto passa por modelo. Se montar o evento falhar, ele é descartado e a run segue igual: o conselho nunca custa a run. Só o último resultado e o seu antecessor ficam na memória. `has_easier`/`has_harder` seguem no padrão da política, mas **`request_neighbor` não tem para onde ir** (não há escada de habilidades) e nenhuma skill ou aresta é inventada: as faixas `too_easy`/`too_hard` nunca são produzidas pelos fatos acima, então `raise`/`plan_once`/`request_neighbor` não aparecem.
3. **Evento SSE `flow_advice`** `{node_id, action, reason, takes_step, authority: "advisory", facts}`, emitido uma vez por nó no checkpoint, antes da checagem de parada (assim a parada do operador também fica registrada). Vai para o log da run como qualquer outro evento.
4. **Liga/desliga, desligado por padrão.** `execute_harness(flow_advice=False)`; por run em `ExecuteRequest.flow` (`true`/`false`; ausente = padrão global); padrão global em `GET/PUT /flow/config` (tabela singleton `flow_config`). Desligado: nenhum cálculo e nenhum evento. Ligado: só evidência. A UI tem uma chave mínima (`FlowToggle`, na barra de ajustes da run quando há harness) que altera o padrão global.
5. **O conselho nunca é gate.** Nada em `execute_harness` lê o evento de volta. Contrato testado (`backend/tests/test_engine_flow_advice.py`): com o Flow desligado, ligado e com um conselheiro que responde qualquer uma das sete ações, gates (`node_done`, `node_skipped`, `gate_retry`) e status terminal são idênticos; `act` + parada do operador ainda para a run; **abstenção é só registrada e o grafo segue**.

## Fora desta fatia

Laya e Clef; `request_neighbor`, skills e arestas novas; GPU; recalibrar pisos; `GATES.md`; `triage.py`; UI para ver o conselho na transcrição (o evento já chega no fluxo e no log); UI para marcar `unsafe`/`goal` no inspector (hoje vêm do JSON do harness).

## Decisão que continua sendo do usuário

No laboratório, abster encerra o episódio. Numa run real, abster ou cortar o grafo muda o produto sem medição que autorize. Promover abstenção, subida ou descida a desvio de aresta exige um sim por escrito do usuário e continua sujeito ao ADR 0005: o resultado do conselho não vira gate.
