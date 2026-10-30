# ADR 0014 — Escolher modelo no combo do chat: `Enter` salva o padrão da conexão, `Shift+Enter` vale só para a conversa

Status: Aceito (reversível, teclas corrigidas) · 2026-10-28 · Issue #83 (mapa #82, P1) · Código: `frontend/src/store/chatModelStore.ts`

## Contexto
O combo do chat passa a listar os modelos de cada conexão (#89). Escolher um modelo pode gravar o padrão da conexão (`setDefaultModel`, o mesmo que o
Providers usa) ou valer só para a conversa atual. O backend não muda: `defaultModel` já é o único modelo que um run lê sem pin no nó
(`backend/providers/resolution.py`), e o chat já manda `model` por turno (`AgentStage`, "Model for next turn").

Referências: Claude Code `/model` (`Enter` troca e salva o padrão, `s` só a sessão — [model-config](https://code.claude.com/docs/en/model-config));
DeepSeek Harness v0.2 (escolher vira padrão de sessões novas; sessões antigas mantêm o modelo do log — [providers.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)).

## O que não foi feito
O issue pedia dois mocks clicáveis e três tarefas cronometradas com pessoas. Isso **não foi executado**: não há participantes nesta sessão. A decisão
abaixo vem da comparação com as duas referências e do que o código já faz, não de medição. Se a medição contradisser, a mudança é só a tecla padrão
do combo (nenhum dado migra).

## Decisão
Híbrido, na linha do Claude Code (`Enter` salva o padrão, outra tecla vale só para a sessão):
- **`Enter`** num modelo: grava o padrão da conexão (`setDefaultModel`), vale para conversas novas e para as que seguem o padrão, e apaga qualquer
  override desta conversa naquela conexão.
- **`Shift+Enter`** (e o botão "Só esta conversa" na linha focada, para toque e mouse): vale só para a conversa atual. Não é `s` como no Claude Code:
  o combo tem busca, e com o campo de busca em foco `s` é texto digitado. O override fica no front, em
  `chatModelStore` (`threadId → connectionId → modelo`, persistido em `oh.chat.model.v1`); sem entrada, a conversa segue o padrão.
- O combo mostra qual dos dois está valendo no chip (`{conexão} · {modelo}`; um marcador "só esta conversa" quando é override) e a resposta registra
  o modelo que respondeu, o que responde "qual modelo respondeu a conversa anterior" sem medir nada.

## Por quê
- Troca de uma pergunta só e troca de vez são os dois casos reais; uma variante única força o usuário a desfazer o outro caso.
- Sem backend novo: o padrão usa o PUT existente; o override é estado local, como o `modelChoices` que o `AgentStage` já guarda em memória (que ele
  perde ao trocar de conversa ou recarregar).
- Sessões antigas não mudam de modelo quando o padrão muda: o modelo de cada resposta já vem do run (`segment.model`).

## Consequências
- `AgentStage` passa a ler o override de `chatModelStore` em vez do estado local; isso entra com o combo (#89), para não mexer no composer agora.
- Apagar uma conversa deve chamar `clearThread`; `prune` limpa as que sobraram.
- Reverter para "sempre o padrão" é remover o `Shift+Enter`, o botão e o store; nada no backend depende dele.
