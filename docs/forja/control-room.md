# Sala de controle da Forja

A destinação **Forja** do app (barra lateral, `Alt+4`) junta o que a Forja local faz e o que espera uma pessoa. Tudo roda na sua máquina; nada sai dela. O desenho está no [ADR 0058](../adr/0058-factory-control-room-and-metrics.md).

## Seções

- **Itens de trabalho.** O quadro por colunas (Novos, Triados, Planejados, Em implementação, Em revisão, Em verificação, Prontos para revisar, Em monitoramento, Assumidos, Precisam de você, Estacionados, Concluídos; os cancelados e com falha ficam atrás de um filtro). Cada cartão é um botão: o teclado alcança tudo. **Não se arrasta cartão:** mover um item é uma ação com checkpoint. Abrir o cartão mostra a especificação (com a revisão a aprovar), o texto original (que veio de fora e aparece como dado), as branches e links, as runs vinculadas, o histórico e as ações possíveis. Não existe ação de merge: a Forja nunca faz merge; "Já fiz o merge" é a sua confirmação.
- **Caixa de entrada.** O que espera por você: pergunta, especificação para revisar, trabalho pronto para revisar, bloqueado e falhou. Cada entrada sai sozinha quando deixa de valer; "Marcar como feito" esconde à mão e dá para desfazer. O histórico do item guarda quem marcou como feito, quem desfez, e quando. A pergunta continua aberta até ser respondida.
- **Configuração.** As versões da definição (`.oharness/forja`): verificar a pasta de um projeto, ativar, testar em uma parte do trabalho novo (canary), tornar o teste a versão ativa, parar o teste e voltar à versão anterior; os segredos (só nomes, nunca valores) e a memória de cada agente.
- **Métricas.** Vazão, custo, qualidade, autonomia e tempo de ciclo em 7, 30 ou 90 dias. O que os dados não dizem aparece como indisponível, com o motivo.

## Decisões são de uma pessoa

Aprovar ou editar uma especificação, responder, pedir mudanças, avançar um estágio, confirmar o merge, verificar o pouso, resolver ou desfazer na caixa de entrada (ler a caixa não pede), ativar uma versão, gravar ou apagar segredos e editar ou apagar memória (acrescentar uma nota de memória não pede) pedem a credencial da pessoa. Cancelar, estacionar, retomar e assumir um item não pedem (se devem pedir é decisão pendente do dono, #442). **No app de desktop** o shell a gera a cada abertura, entrega ao sidecar (`OH_HUMAN_TOKEN`) e à janela principal (`window.__OH_HUMAN__`), só em memória: ela não aparece em URL, armazenamento do navegador, log nem evento, e não é o token que agentes, a CLI e o MCP usam (ADR 0055). Pelo desenho, essas decisões funcionam na tela do app e só nela: um agente, o MCP ou a CLI recebem 403 `human_only`. **Ainda não verificado no app instalado (#445):** isso está provado em teste de unidade (script, ambiente e guarda de origem), não no instalador NSIS.

Onde não há o shell do app, nada define a credencial e a tela explica em uma frase que a decisão é de uma pessoa, em vez de mostrar um erro. Isso vale para abrir o frontend num navegador ou rodar só o backend; para desenvolver, `OH_FACTORY_DEV_HUMAN=1` no backend é a ponte explícita (mais fraca: qualquer cliente local passa por pessoa).

## Ainda não está nesta tela

Runs ao vivo e automações têm hoje a sua própria visão fora da Forja (o painel de runs do chat e `oharness forja automation`); o cartão do item lista as runs vinculadas, e abrir uma run ao vivo a partir dele fica para uma entrega própria.
