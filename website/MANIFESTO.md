# Por um OHarness Model

Um agente recebe uma tarefa, consulta ferramentas e produz uma resposta. Entre a intenção e o resultado, há escolhas: quem pode agir, com qual contexto, quando o trabalho deve parar e quem decide continuar. Queremos que essas escolhas possam ser lidas, discutidas e revistas por quem responde pelo trabalho.

Defendemos um OHarness Model aberto à inspeção e à evolução. Um harness reúne agentes, capacidades, pontos de verificação e decisões humanas para organizar o trabalho. Sua descrição deve tornar visíveis as responsabilidades que sustentam essa organização. Quem a utiliza precisa conseguir compreender o que está delegando.

**Legibilidade é parte do controle.** Contexto, instruções e critérios precisam ter um lugar reconhecível. Queremos que uma pessoa consiga acompanhar o raciocínio da composição, revisar uma mudança e entender suas consequências. Clareza também exige declarar o que falta, o que depende do ambiente e o que permanece incerto.

**Portabilidade é uma direção de projeto.** Queremos levar a descrição do trabalho entre ambientes, preservando sua intenção e explicitando suas dependências. Cada conexão tem condições; cada ambiente tem limites. Uma transição responsável deve mostrar quais partes podem seguir, quais exigem adaptação e quais ainda precisam ser verificadas.

**Conexões precisam ser compreensíveis.** Ferramentas e fontes de contexto ampliam o alcance dos agentes. Defendemos que seus vínculos e permissões sejam visíveis na composição. Escolher uma conexão deve permitir entender o que ela oferece, do que depende e qual responsabilidade acrescenta ao trabalho.

**A autoridade permanece humana.** Pessoas devem definir objetivos, estabelecer limites, examinar evidências e decidir a aceitação. Queremos pontos de intervenção claros, com espaço para interromper, recusar e corrigir o curso. Delegar uma atividade deve preservar a possibilidade de questionar como ela foi realizada.

Adotamos YAML para os arquivos `.ohm`, favorecendo a leitura de instruções, comentários e conteúdo multilinha. Os harnesses incluídos no app que vêm de arquivos .ohm e a linha de comando já usam essa sintaxe; a importação e a exportação do Studio ainda usam JSON, e a migração do desktop não foi concluída. O app já oferece grafos, conteúdo incorporado, validação estrutural e simulação. Grafos com ciclo ainda não são executáveis, e os ciclos de trabalho continuarão exigindo regras explícitas de execução.

Nosso horizonte é ampliar essa base com legibilidade, portabilidade e autoridade humana como critérios de decisão. Cada capacidade anunciada deve encontrar respaldo no que pode ser inspecionado. Cada aspiração deve continuar identificada como trabalho por realizar.
