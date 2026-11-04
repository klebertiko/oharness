# Flow global: spec de UX do co-flow

Status: proposta (fase 1) · Decisão e mapa: [ADR 0066](../../adr/0066-flow-global.md) · Medição: [plano](../../research/flow-global-measurement.md).
Segue o [design system](../../design-system/README.md) e [`experience.md`](../../design-system/experience.md); o assistente é **Nilo**; vocabulário do [`CONTEXT.md`](../../../CONTEXT.md) (nunca as palavras aposentadas pelo Copy standard em texto visível).

## Princípio
Ligar o Flow põe você e as IAs que você usa no mesmo estado: a interface ajuda **você** a entrar em foco (as pré-condições e o análogo da hipofrontalidade transitória do ADR 0066) enquanto as LLMs recebem o condicionamento. **Nada é removido**: nenhum passo, evento, log ou verificação some; muda só o que a interface põe em primeiro plano e quando. O que é reflexo (Parar, teto de tokens, aprovações, erros, Gates) fica exatamente como está. O estado nunca se comunica só por cor ou só por movimento.

## 1. Interruptor e indicador do estado compartilhado
- **Controle**: `button role="switch"` com `aria-checked`, rótulo "Flow" + estado em texto, na barra de título (visível em toda tela e em janela estreita), absorvendo o `FlowToggle` do #336. Também: célula na barra de status e comando na paleta ("Ligar Flow" / "Desligar Flow"). Atalho proposto `Mod+Shift+F` (sem conflito no keymap atual; confirmar no teclado real; entra no `KeymapSheet`).
- **Indicador do estado compartilhado**: ligado, o controle mostra "Flow · você e N runs" (N = runs vivas sob Flow; "você" sozinho quando não há run). É a representação de que o estado é de todos. Na run ativa, uma marca discreta de mesma família visual do interruptor liga o humano à run.
- **Estados**: desligado · ligado · alternando (≤ `duration-enter`) · indisponível (motor local fora do ar: desabilitado, com motivo em texto). O ícone muda de **forma** entre ligado e desligado.
- **Anúncio**: `aria-live="polite"` anuncia "Flow ligado" / "Flow desligado". O foco não se move; nada modal.
- **Honestidade**: o detalhe diz "vale na próxima chamada de cada run"; uma chamada de modelo já em curso termina como começou.

## 2. Aparência e ritmo quando ligado
Atributo `data-flow="on"` na raiz do shell; o visual sai de tokens e variáveis CSS.

| Pré-condição / efeito | Na interface |
| --- | --- |
| **Meta clara** | Linha fixa no topo com o objetivo da run/turno |
| **Feedback imediato** | Passo atual e resultado de Gate em tempo real, sempre visíveis; nunca adiados nem recolhidos |
| **Calma visual** (análogo de menos automonitoramento) | Cromo secundário (trilho de atividade, painéis laterais, inspetor, barra de status exceto a célula do Flow) recolhido ao trilho/ícone ou com contraste reduzido **dentro de AA** (tokens como `ink-mute` já validados; **nunca `opacity` em texto**). Reabre com clique ou pelo atalho de sempre |
| **Foco na run ativa** | Contorno com token de acento + título e meta; as outras ficam numa lista compacta |
| **Menos competição por atenção** | Sem contador de tempo ao segundo, sem ETA, sem medidores que se mexem; "em andamento" enquanto roda e duração arredondada em minutos ao concluir (o relógio detalhado segue no histórico). O medidor do teto de tokens fica **estático e visível** |
| **Ritmo calmo** | Nenhum elemento pulsa, pisca ou gira; mudanças de estado simultâneas são agrupadas; o texto transmitido pelo modelo aparece na velocidade em que chega |
| **Ruído** | Avisos **não bloqueantes** da interface (ex.: confirmações de salvar, chips de fila, dicas) são apresentados num resumo "N avisos adiados" depois, não descartados. **Som**: o app hoje não tem som nem notificação do sistema; o Flow não adiciona nenhum, e qualquer som ou notificação futura tem de respeitar o Flow (regra no design system). Inventariar os avisos existentes é a primeira entrega da sub-issue S6 |
| **Críticos** (erro, aprovação pendente, orçamento perto do teto, parada) | Sempre imediatos, mesmo lugar e peso de hoje (`role="alert"` onde já é). Nunca entram no resumo |
| Raciocínio / narração (`node_reason`) | Recolhido por padrão (pergunta 7 do ADR), um clique abre; o log guarda tudo |
| Parar, aprovações, teto | **Inalterados**, visíveis e alcançáveis por teclado |

## 3. Transição
- Entrada/saída do modo: só **opacidade** com `duration-enter` / `ease-enter` e, no máximo, o deslocamento de 8px do design system. **Sem animar largura/altura/margem** (regra do DS): painéis recolhem num passo, com fade do conteúdo. Suave e curta; sem efeito de "tela cheia".
- `prefers-reduced-motion: reduce`: tudo instantâneo, sem laço, uma pose estática; o estado segue legível por texto, ícone e anúncio.
- Nenhuma animação contínua enquanto o Flow está ligado.

## 4. Acessibilidade e testes
- WCAG AA nos dois temas, ligado e desligado; **axe sem exceção nova**, rodando **depois** que a transição assenta (lição do #347/#351).
- Teclado: ordem de foco igual à do modo normal; foco visível no interruptor; "avisos adiados" abre por teclado; Esc fecha. Janela estreita (ADR 0048): o interruptor não some.
- Estado nunca só por cor; ícones com nome acessível; sem rolagem horizontal.
- Testes: store e componente (estados, anúncio, atalho, "você e N runs"); shell com `data-flow` nos dois temas; e2e com axe ligado/desligado e `reducedMotion`; críticos nunca entram no resumo; nenhum evento do motor muda por causa da UI (a UI só apresenta).

## 5. Textos (catálogo `src/i18n`, pt-BR e en, namespace `flow.*`)
Nenhum acento fora do catálogo.

| Chave | pt-BR | en |
| --- | --- | --- |
| `flow.switch.label` | Flow | Flow |
| `flow.state.on` / `off` | ligado / desligado | on / off |
| `flow.shared` | você e {n} runs / você / você e 1 run | you and {n} runs / you / you and 1 run |
| `flow.announce.on` / `off` | Flow ligado. Vale na próxima chamada de cada run. / Flow desligado. | Flow on. Applies from each run's next model call. / Flow off. |
| `flow.deferred.chip` | {n} aviso adiado / {n} avisos adiados | {n} notice deferred / {n} notices deferred |
| `flow.deferred.note` | Erros e pedidos de aprovação nunca ficam aqui. | Errors and approval requests never wait here. |
| `flow.time.running` | em andamento | running |
| `flow.unavailable` | Flow indisponível: o motor local não responde. | Flow unavailable: the local engine is not responding. |

Um teste de cópia confere que nenhuma chave `flow.*` contém as palavras do Copy standard e que pt-BR e en têm as mesmas chaves. (Plural da chave `flow.shared` pelo `plural` do catálogo.)

## 6. O que a UI não faz
Não alega que a IA "está em flow" nem mede desafio–habilidade (o app não tem essa escada); não promete ganho de qualidade, foco ou economia (só a medição pode); não esconde nem apaga log ou evento; não muda permissões; não aparece como gate.
