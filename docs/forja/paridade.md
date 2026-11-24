# Forja — lista interna de capacidades

Lista de capacidades da fábrica local, marcada contra o que já está na base, o que este PR entrega e o que fica para uma fatia seguinte. Os nomes são os da Forja: item, foreman, agente, blueprint, gate, definição em `.oharness/forja`. Nada aqui descreve um produto de fora.

Legenda:

- **Já na base** — existe na `main` e este PR não refaz.
- **Neste PR** — entra agora, com teste.
- **Fatia 2** — próxima entrega da Forja, ainda neste pacote, sem depender do laço de execução.
- **Feito** — coberto por teste. O laço de execução já dispara o estágio, com worktree, pool, parar e orientar.
- **Fatia 3** — o que ainda falta: trials executados, branch de código no repositório, forge genérico, conectores e o restante desta lista.
- **Não se aplica** — o motivo está na linha.

## Núcleo

| # | Capacidade | Situação |
|---|---|---|
| W1 | Item de trabalho com o contexto da origem até a entrega | Já na base |
| W2 | Foreman coordena e continua a conversa nos follow-ups | Já na base. Reabrir a mesma sessão do agente: Fatia 3 |
| W3 | Nome do foreman alcançável por menção numa origem conectada | Fatia 2 — o setup pede o nome e uma menção cria ou continua o item |
| W4 | Agentes padrão por papel | Já na base |
| W5 | Skills embutidas, globais e do próprio agente | Já na base |
| W6 | Modelo, harness e instruções por agente | Neste PR o campo opcional `engine` (id de um harness do Studio) no agente, validado pelo schema e recusado em agente que escreve. A tela não mostra o formato do arquivo. O editor que grava uma versão em teste: Fatia 2 |
| W7 | Agente novo pela tela ou pela definição | Fatia 2 — "Novo agente", atribuir a um estágio, aparecer no blueprint |
| W8 | Override de runner e de perfil de setup por tarefa | Feito — a tarefa nomeia o runner; os comandos de setup desse runner rodam antes do estágio |
| W9 | Quem pode disparar cada agente | Fatia 2 — o validador recusa um disparo de papel não autorizado |
| W10 | O mesmo agente em dois estágios | Fatia 2 |

## Blueprint, transições e gates

| # | Capacidade | Situação |
|---|---|---|
| W11 | Blueprint com estágios, agentes, transições e gates | Fatia 2, neste PR — editar grava um teste; o item que já corre fica na versão antiga; remover o gate de revisão é recusado |
| W12 | Entrada condicional (a primeira transição que a condição aceita) | Fatia 2, neste PR — um item com o rótulo `docs` entra em implementação |
| W13 | Devolver a revisão para implementação, com teto | Já na base o retorno da política. Neste PR (fatia 2) o teto por transição manda o item para uma pessoa |
| W14 | Rota condicional que encerra o item com um motivo | Fatia 2, neste PR |
| W15 | Simular o caminho com um payload de exemplo | Fatia 2, neste PR |
| W16 | Gate de aprovação da especificação | Já na base |
| W17 | Gate condicional: perguntar quando uma condição em prosa for verdadeira | Fatia 2, neste PR — o gate pausa com a pergunta declarada |
| W18 | Mudança de definição não altera o que já está em execução | Já na base. Neste PR o teste de canário confirma que o item antigo fica na versão em que nasceu |
| W19 | Merge só de pessoa; o validador recusa uma ação de merge | Já na base a regra de merge. Neste PR o validador de proposta recusa merge, com motivo, antes de chegar à pessoa |

## Entrada de trabalho

| # | Capacidade | Situação |
|---|---|---|
| W20 | Automação com gatilho, filtros e alvo | Já na base. Alvo "estágio" (o item já nasce no estágio): Fatia 2 |
| W21 | Filtros: todos precisam bater; lista vazia não restringe | Já na base |
| W22 | Filtro de payload em webhook | Já na base |
| W23 | Agenda | Já na base. A tela mostra a próxima execução no horário local: Fatia 2 |
| W24 | Evento interno quando o item muda de estágio, para encadear outra automação | Fatia 2, neste PR — chegar a concluído dispara a automação de resumo |
| W25 | "Dispararia?" contra um payload de exemplo, dizendo qual filtro falhou | Fatia 2, neste PR |
| W26 | Aviso quando duas automações disparam o mesmo evento e o mesmo alvo | Fatia 2 |
| W27 | Webhooks autenticados | Já na base no servidor. Tela com URL, copiar segredo, rotação e as últimas entregas: Fatia 2 |
| W28 | Limite de tamanho, retentativa e idempotência | Já na base |
| W29 | API local de criação e consulta | Já na base, com a CLI. Descrição publicada da API: Fatia 3 |
| W30 | MCP local: enviar, assumir e devolver trabalho | Já na base. Ferramentas de conversa com o foreman, validar e schema: Fatia 3 |
| W31 | Aviso pelo MCP quando um item espera uma pessoa | Fatia 3 |
| W32 | Novo run pela tela, com agente, pedido e repositório | Fatia 2 na forma; a execução de verdade é Fatia 3 |
| W33 | GitHub como origem | Já na base. Checagem da definição no fluxo de integração contínua: Fatia 3 |
| W34 | Outras origens (os conectores que hoje são esqueleto) | Fatia 3 — uma origem de cada vez, marcada como experimental até haver instalação real |
| W35 | Resumo agendado postado num canal | Fatia 3 |
| W36 | Resposta no mesmo thread resolve a pergunta pendente | Já na base no GitHub, parcial. Teste de fixture: Fatia 3 |
| W37 | A tela da integração lista os escopos antes de gravar o token | Fatia 2 |
| W38 | Forge de git genérico, com URL e segredo só pelo nome | Fatia 3 |

## Execução

| # | Capacidade | Situação |
|---|---|---|
| W39 | Worktree por run e teto de runs simultâneas | Feito — `factory.loop.start` chama `dispatch.run_stage` em produção: um worktree por run e o pool de `maxConcurrentRuns` |
| W40 | Precedência do runner: tarefa, automação, agente, padrão | Feito — a tarefa vence, depois a automação, o agente e o primeiro runner |
| W41 | Comandos de setup na worktree antes do primeiro estágio | Feito — cada comando do runner roda na worktree antes da nota do estágio |
| W42 | Erro de setup diz qual comando falhou, com a saída redigida | Feito — a mensagem cita o comando e o valor do segredo não aparece |
| W43 | Segredos por nome, sem mostrar o valor | Já na base. Rotação que mantém o nome: Fatia 2 |
| W44 | Política de rede por agente | Feito — um host negado não chega a executar; a negação vence uma permissão do mesmo host |
| W45 | MCP por agente, com cliente de verdade | Feito — o cliente fala JSON-RPC com um processo e com um servidor no mesmo processo: initialize e depois a lista de ferramentas |
| W46 | Cada agente escolhe o harness | Feito — o `engine` tem de ser um harness que já existe no Studio. A escolha de conexão de provider fica no pacote de providers |
| W47 | Um item usa um harness na especificação e outro na implementação | Feito — cada agente resolve o seu id; a run usa o do agente daquele estágio |
| W48 | Hospedagem gerenciada, orquestrador externo, cluster | Não se aplica — a Forja já é local |
| W49 | Política de retenção do provider na linha da conexão | Não se aplica neste pacote — fica no pacote de providers |

## Operação

| # | Capacidade | Situação |
|---|---|---|
| W50 | Caixa "Aguardando você", itens saem sozinhos | Já na base. Neste PR a lista agrupa por item |
| W51 | Tipos: pergunta, especificação, pronto para revisar, bloqueado, falhou | Já na base. Neste PR a melhoria entra como mais um tipo |
| W52 | Resolver e desfazer; abrir não resolve | Já na base. Neste PR desfazer fica oferecido por alguns segundos |
| W53 | Filtros Ativos, Concluídos, Bloqueados, Falhos; busca; Hoje, Semana, Tudo | Neste PR |
| W54 | Runs com filhos, linha do tempo, custo e sessão | Feito — a tela Execuções lista a run, a run aninhada e quantas cabem no pool. O custo da run é o que o driver gastou. A divisão máquina/inferência continua em W58 |
| W55 | Parar um run na hora e orientar o run ao vivo | Feito — parar devolve o item para a fila e preserva a worktree; orientar grava a mensagem no jornal, e um segredo nessa mensagem sai redigido |
| W56 | Pontuar um run e virar tarefa de benchmark | Neste PR a pontuação sob demanda e a tarefa congelada a partir dos dados do run. A execução dos trials: Fatia 3 |
| W57 | Métricas: autonomia, tempo de ciclo, custo, abertos e concluídos | Já na base os números. Neste PR, sem dados, só o estado vazio; com dados, a série diária. Autonomia pelos autores dos commits: Fatia 3 |
| W58 | Custo decomposto em máquina e inferência | Fatia 3 |
| W59 | Definição: validar, versões, diff, ativar, promover, abortar, voltar | Já na base nas rotas. Editor na tela: Fatia 2 |
| W60 | Configurações: modelo analista, autoria, excluir a Forja | O campo do analista está no schema neste PR. A tela: Fatia 2 |

## Medir e melhorar

| # | Capacidade | Situação |
|---|---|---|
| W61 | Scorer que classifica runs de agentes escolhidos | Neste PR o objeto no schema (`kind`, agentes, rótulos com pontuação, limiar, taxa, rubrica). Ler a pasta `scorers/` como arquivos soltos: Fatia 2 |
| W62 | Classificação com pontuação, limiar e taxa de amostragem | Neste PR — a amostragem é estável para o mesmo id, e o teste confere a faixa de 10% |
| W63 | Pontuar sob demanda; pontuar de novo substitui o resultado daquele scorer naquele run | Neste PR — o resultado mais novo é o que vale, e os anteriores ficam guardados (o score só é inserido, nunca reescrito) |
| W64 | Checagens determinísticas (CI, QA, SEC, gate, PR fechado sem merge, retornos, custo) | Neste PR |
| W65 | Tarefa de benchmark a partir de um run concluído, com os inputs copiados | Neste PR a cópia congelada. A suíte executada: Fatia 3 |
| W66 | Configurações × tarefas × repetições, com a contagem antes de lançar | Neste PR a contagem (2 × 3 × 2 = 12). Lançar e cancelar trials de verdade: Fatia 3 |
| W67 | Mudar a suíte não altera um resultado passado; trial bloqueado continua bloqueado | Neste PR os inputs congelados. Pontuar um trial bloqueado: Fatia 3 |
| W68 | Três recomendações: maior qualidade, mais eficiente, mais barato | Neste PR a função e o teste. O gráfico na tela: Fatia 2 |
| W69 | Aplicar o resultado cria uma proposta em teste; não aplica direto | Neste PR — aprovar é que inicia o canário |
| W70 | Checagem com 25 falhas em aberto ou a mais antiga com 7 dias; limiar configurável | Neste PR |
| W71 | "Rodar agora" inclui um agente com uma falha e não deixa escolher quais | Neste PR, na API e no botão da tela |
| W72 | A correção pode ser na definição ou no código do projeto, sempre com aprovação | Neste PR os dois alvos. A proposta de código não inicia canário e não faz merge. Gravar a branch no repositório: Fatia 3 |
| W73 | Revisor que pode ser "ninguém" | Não se aplica — toda proposta espera uma pessoa. O schema não tem esse valor, e o validador recusa se ele aparecer |
| W74 | "Regressões tratadas" com os ids das falhas | Neste PR |
| W75 | Lista de propostas e um cartão no painel | Neste PR a tela Melhorias. Os três cartões no painel de métricas: Fatia 2 |
| W76 | Baseline, comparação e monitoramento, com reversão se piorar | Neste PR — cada score do laço mede o canário em curso: se piorou, ele é revertido sozinho; se melhorou, a pessoa promove, e só enquanto aquele canário ainda roda. A pessoa também pode medir na hora. O mesmo veredito é gravado uma vez só. Na tela: medir, promover, reverter, diff, custo estimado, trilha e exportação |
| W77 | Uma proposta pode alterar uma skill versionada, pelo mesmo canário | Neste PR — skill é um diff da definição e passa pelos mesmos limites |

### O que protege o teste de uma proposta

- **Quem pontua.** Só o laço de execução, com uma credencial criada no próprio processo e guardada só na memória, ou a pessoa. O token comum que um agente usa não pontua. O score precisa citar a versão ativa ou o canário que está rodando, e o item de trabalho, quando citado, precisa ter rodado naquela versão. A linha de corte, os rótulos, a checagem e os tetos dela vêm da definição, nunca de quem chama.
- **Quem decide.** Aprovar, medir, reverter e promover pedem a credencial da pessoa. A única ação sem a pessoa é o rollback de um teste que piorou, disparado pelos próprios scores. Ao aprovar, a proposta precisa partir da versão ativa de agora. Se a versão mudou, ela fica desatualizada e é preciso pedir outra. Os limites rodam de novo nesse momento.
- **O que uma proposta pode mudar.** O validador falha fechado. Os dois lados são lidos com os valores padrão efetivos, então uma chave omitida nunca vale como algo mais solto. Uma chave removida ou com outro tipo é recusada. Mudam livremente só instruções, modelos e skills. Portões, modos, tetos, rede, segredos, scorers, amostragem e configurações do teste só podem ficar iguais ou mais rígidos. Qualquer outro campo é protegido e só a pessoa muda, editando a definição. O `after` também passa pela validação completa da definição e precisa ter o nome do próprio factory. Um valor que parece credencial é recusado sem ser guardado.
- **O trilho.** Scores, falhas e eventos só são inseridos. A sessão recusa alterar ou apagar uma dessas linhas, e a exportação vem em páginas.

## Definição, receitas e erros

| # | Capacidade | Situação |
|---|---|---|
| W78 | Definição em `.oharness/forja`, com scorers, benchmarks, política de rede e autoaperfeiçoamento | Neste PR essas seções no schema, opcionais, sem quebrar uma definição antiga. Roteadores e um schema por tipo de arquivo: Fatia 2 e Fatia 3 |
| W79 | Validar a definição | Já na base na rota e na CLI. A ferramenta MCP: Fatia 3 |
| W80 | Roteador que escolhe o modelo por regra | Fatia 3 |
| W81 | Receitas (issue para PR, triagem, revisão, incidente, monorepo) e "Montar com o Nilo" | Fatia 2, neste PR — o Nilo monta a definição e o validador confere antes de gravar; um pedido para tirar a revisão não tira o gate |
| W82 | Um item com dois repositórios e a ordem de merge declarada por pessoa | Fatia 3 |
| W83 | O setup pergunta o escopo e o validador recusa item fora dele | Fatia 2 |
| W84 | Primeiro teste: um item pequeno e um checklist de avaliação | Fatia 2 |
| W85 | Prova visual anexada ao item | Fatia 3 |
| W86 | Catálogo de erros com o que falhou, por quê e o que fazer | Fatia 2 na tela. Os erros de provider ficam no pacote de providers |
| W87 | O detalhe do item explica por que está parado | Fatia 2 |
| W88 | Papéis de equipe | Não se aplica — um dono, e o modo máximo por agente |
| W89 | Planos e créditos | Não se aplica — o custo mostrado é o do provider. Pausar a Forja no limite de uso fica no pacote de providers |
| W90 | Memória do agente, com nota de agente ainda não revisada | Já na base. Seletor de agente no lugar do id digitado: Fatia 2. Revogar uma nota aprovada por uma proposta: neste PR, pela rota de revogação |

## Fatias que ficam

**Fatia 2** (telas e regras, sem o laço de execução): blueprint editável, rotas e gates condicionais, evento de mudança de estágio, "Dispararia?", editor de definição, agentes e memória por seletor, automações na tela, nova Forja e "Montar com o Nilo", catálogo de erros na tela, gráfico das três recomendações.

**Fatia 3** (o laço, a rede, o MCP e o harness por agente estão feitos): juiz por modelo, trials de benchmark executados, branch de código gravada no repositório, forge genérico e conectores que hoje são esqueleto.
