# Flow global: spec de UX

Status: proposta (fase 1) · Decisão e mapa: [ADR 0066](../../adr/0066-flow-global.md) · Medição: [plano](../../research/flow-global-measurement.md).
Segue o [design system](../../design-system/README.md) e [`experience.md`](../../design-system/experience.md); o assistente é **Nilo**; vocabulário do [`CONTEXT.md`](../../../CONTEXT.md) (nunca as palavras aposentadas pelo Copy standard em texto visível).

## Princípio
O Flow reduz o que é *explícito e autorreferente* na interface (cromo, avisos comuns, contadores de tempo) e mantém o que é *reflexo* (Parar, teto de tokens, aprovações, erros, Gates). O estado nunca se comunica só por cor ou só por movimento.

## 1. Interruptor e indicador de estado
- **Controle**: um `button role="switch"` com `aria-checked`, rótulo "Flow" + estado em texto ("ligado"/"desligado"), na barra de título (visível em toda tela e em janela estreita), absorvendo o `FlowToggle` do #336. Também: célula na barra de status e comando na paleta ("Ligar Flow" / "Desligar Flow"). Atalho proposto `Mod+Shift+F` (sem conflito no keymap atual; confirmar no teclado real; entra no `KeymapSheet`).
- **Estados**: desligado · ligado · alternando (≤ `duration-enter`) · indisponível (motor local fora do ar: desabilitado, com o motivo em texto). O ícone muda de forma (não só de cor) entre ligado e desligado.
- **Anúncio**: região `aria-live="polite"` anuncia "Flow ligado" / "Flow desligado". O foco não se move; nada modal.
- **Contagem honesta**: o indicador mostra "N runs em Flow" quando houver runs vivas e, no detalhe, "vale na próxima chamada de cada run", porque uma chamada de modelo já em curso termina como começou (ADR 0066).

## 2. Modo visual de foco (quando ligado)
Atributo `data-flow="on"` na raiz do shell; todo o visual sai de tokens e variáveis CSS, sem lógica nos componentes.

| Elemento | Com Flow ligado |
| --- | --- |
| Cromo secundário (trilho de atividade, painéis laterais, inspetor, barra de status exceto a célula do Flow) | Recolhido para o trilho/ícone, ou com contraste reduzido **dentro do mínimo AA** (usar `ink-mute` já validado; **nunca `opacity` em texto**). Reabre com um clique ou pelo atalho de sempre. |
| Run ativa | Destaque por contorno com token de acento + título e meta fixos no topo; as demais ficam numa lista compacta |
| **Meta** (precondição "meta clara") | Linha fixa com o objetivo da run/turno |
| **Feedback imediato** (precondição) | Passo atual e resultado de Gate continuam em tempo real e **não** são adiados nem recolhidos |
| Avisos comuns (`ordinary`) | Adiados; chip discreto "N avisos adiados" abre a lista. Nilo e a run seguem usáveis |
| Avisos críticos (erro, aprovação pendente, orçamento perto do teto, parada) | Sempre imediatos, no mesmo lugar e com o mesmo peso de hoje (`role="alert"` onde já é) |
| Raciocínio / narração (`node_reason`) | Recolhido por padrão, um clique abre; o log guarda tudo |
| Tempo | Sóbrio: sem contador ao segundo nem ETA; "em andamento" enquanto roda e duração arredondada em minutos ao concluir; o relógio detalhado continua no histórico/detalhe da run |
| Parar, teto de tokens, aprovações | **Inalterados**, sempre visíveis e alcançáveis por teclado |

## 3. Transição
- Entrada/saída do modo: só **opacidade** com `duration-enter` / `ease-enter` e, no máximo, o deslocamento de 8px do design system. **Sem animar largura/altura/margem** (regra do DS): painéis recolhem num passo, com fade do conteúdo.
- `prefers-reduced-motion: reduce`: tudo instantâneo, sem laço, uma pose estática do indicador (como a regra de marca); o estado continua legível por texto, ícone e anúncio.
- Nenhuma animação contínua enquanto o Flow está ligado.

## 4. Acessibilidade e testes
- WCAG AA nos dois temas, ligado e desligado; **axe sem exceção nova**; o e2e de axe roda **depois** que a transição assenta (lição do #347/#351).
- Teclado: ordem de foco igual à do modo normal; o interruptor tem foco visível; abrir "avisos adiados" por teclado; Esc fecha. Janela estreita (ADR 0048): o interruptor não some.
- Estado nunca só por cor; ícones com nome acessível; sem rolagem horizontal.
- Testes: unitário do store e do componente (estados, anúncio, atalho); componente com `data-flow` nos dois temas; e2e do shell com axe ligado/desligado e com `reducedMotion`; teste de que críticos nunca entram no resumo de adiados.

## 5. Textos (catálogo `src/i18n`, pt-BR e en, namespace `flow.*`)
Nenhum acento fora do catálogo.

| Chave | pt-BR | en |
| --- | --- | --- |
| `flow.switch.label` | Flow | Flow |
| `flow.state.on` / `off` | ligado / desligado | on / off |
| `flow.announce.on` / `off` | Flow ligado. Vale na próxima chamada de cada run. / Flow desligado. | Flow on. Applies from each run's next model call. / Flow off. |
| `flow.deferred.chip` | {n} aviso adiado / {n} avisos adiados | {n} notice deferred / {n} notices deferred |
| `flow.deferred.note` | Erros e pedidos de aprovação nunca ficam aqui. | Errors and approval requests never wait here. |
| `flow.time.running` | em andamento | running |
| `flow.unavailable` | Flow indisponível: o motor local não responde. | Flow unavailable: the local engine is not responding. |

Um teste de cópia confere que nenhuma chave `flow.*` contém as palavras do Copy standard e que pt-BR e en têm as mesmas chaves.

## 6. O que a UI não faz
Não alega medir "desafio–habilidade" (o app não tem essa escada); não promete ganho de qualidade ou economia (só a medição pode); não esconde nem apaga log; não muda permissões; não aparece como gate.
