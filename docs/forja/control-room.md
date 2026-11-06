# Sala de controle da Forja

A destinação **Forja** do app (barra lateral, `Alt+4`) junta o que a Forja local faz e o que espera uma pessoa. Tudo roda na sua máquina; nada sai dela. O desenho está no [ADR 0058](../adr/0058-factory-control-room-and-metrics.md).

## Seções

- **Itens de trabalho.** O quadro por colunas (Novos, Triados, Planejados, Em implementação, Em revisão, Em verificação, Prontos para revisar, Em monitoramento, Assumidos, Precisam de você, Estacionados, Concluídos; os cancelados e com falha ficam atrás de um filtro). Cada cartão é um botão: o teclado alcança tudo. **Não se arrasta cartão:** mover um item é uma ação com checkpoint. Abrir o cartão mostra a especificação (com a revisão a aprovar), o texto original (que veio de fora e aparece como dado), as branches e links, as runs vinculadas, o histórico e as ações possíveis. Não existe ação de merge: a Forja nunca faz merge; "Já fiz o merge" é a sua confirmação.
- **Caixa de entrada.** O que espera por você: pergunta, especificação para revisar, trabalho pronto para revisar, bloqueado e falhou. Cada entrada sai sozinha quando deixa de valer; "Marcar como feito" esconde à mão e dá para desfazer.
- **Configuração.** As versões da definição (`.oharness/forja`): verificar a pasta de um projeto, ativar, testar em uma parte do trabalho novo (canary), tornar o teste a versão ativa, parar o teste e voltar à versão anterior; os segredos (só nomes, nunca valores) e a memória de cada agente.
- **Métricas.** Vazão, custo, qualidade, autonomia e tempo de ciclo em 7, 30 ou 90 dias. O que os dados não dizem aparece como indisponível, com o motivo.

## Decisões são de uma pessoa

Aprovar uma especificação, responder, confirmar o merge, ativar uma versão e mexer em segredos e memória pedem a credencial da pessoa, que o app de desktop entrega à tela (`window.__OH_HUMAN__`, ADR 0055). Sem ela, a tela explica em uma frase que a decisão é de uma pessoa, em vez de mostrar um erro.

## Ainda não está nesta tela

Runs ao vivo e automações têm hoje a sua própria visão fora da Forja (o painel de runs do chat e `oharness forja automation`); o cartão do item lista as runs vinculadas, e abrir uma run ao vivo a partir dele fica para uma entrega própria.
