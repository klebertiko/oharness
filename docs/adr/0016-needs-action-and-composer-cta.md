# ADR 0016 — "Needs action" no combo e o CTA do composer: uma ação por conexão, com as mesmas palavras em todo lugar

Status: Aceito (reversível) · 2026-10-28 · Issue #90 (mapa #82) · Código: `frontend/src/components/providers/nextStep.ts`, `composerAction.ts`, `agent/chatCombo.ts`

## Contexto
A lista do Providers e o dossiê já mostram uma ação por estado (`nextStep`, #87). O combo do chat (#89) só listava o que pode responder; o composer, sem nada pronto, dizia "Connect a provider to send" mesmo quando uma conexão estava a um passo de funcionar.

## Decisão
- **Um texto por estado**: o rótulo de `nextStep` (Turn on, Replace key, Copy `ollama serve`, Open billing, Paste an X key…) é o texto na lista, no dossiê, no combo e no composer. Onde a linha não traz o nome da conexão (composer), `stepText` acrescenta ` · {conexão}`, salvo quando o rótulo já a nomeia.
- **Grupo "Needs action" no combo**: até três conexões que ainda não respondem, da mais próxima de pronta para a mais distante (0 escolher modelo, 1 ligar, 2 consertar uma falha, 3 obter algo: instalar o CLI, conseguir uma chave), em empate vale a ordem da lista. Um contador diz quantas ficaram de fora. Escolher uma linha abre a conexão no Providers; não a seleciona e não há formulário no combo.
- **CTA do composer**: com Auto e nada pronto, a ação da conexão mais próxima de pronta; com escolha explícita, a ação dela. O clique faz o que o rótulo diz quando isso não exige formulário (copiar o comando, abrir a página de cobrança ou de instalação) e abre a conexão no Providers, onde está o Test again.

## Por quê
Três lugares com três redações para o mesmo conserto faziam a pessoa reler a tela para reconhecer que era a mesma coisa. A ordem por distância põe primeiro o que se resolve em um clique.

## Consequências
- Sob Auto o CTA passou a carregar o id da conexão mais próxima (antes abria só o combo); o copilot lê o mesmo `missing`.
- `missingProviderAction` mora em `providers/composerAction.ts` para não criar ciclo com `chatProvider`.
- A escala de distância é uma decisão de produto simples; reordenar é mudar `distanceToReady`.
