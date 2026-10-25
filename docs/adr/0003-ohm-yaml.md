# ADR 0003 — OHM canônico em YAML 1.2

**Status:** aceita para o formato, por decisão do usuário em 2026-09-11.  
**Implementação desktop:** em migração. **Loops:** P2 separado, sem contrato final aprovado.

## Decisão

O OHarness Model (`.ohm`) adota **YAML 1.2 para autoria humana**. APIs, payloads de execução e respostas da CLI continuam JSON. JSON legado em `.ohm` e `.oharness` permanece importável. A serialização converge para um único modelo normalizado; não haverá um modelo funcional diferente para cada formato.

A topologia continua em `graph.nodes` e `graph.edges`, com IDs e referências `source/target`. Âncoras não representam conexões, Signals ou controle de execução. O YAML admite grafos de representação com ciclos ([especificação §3.2.1](https://yaml.org/spec/1.2.2/#321-representation-graph)); aliases referenciam ocorrências anteriores de nós ([§7.1](https://yaml.org/spec/1.2.2/#71-alias-nodes)). Isso não define a semântica de execução do Harness: ciclos entre IDs também são representáveis em JSON.

O perfil inicial aceita um documento, raiz objeto, chaves string e valores compatíveis com JSON. Recusa chaves duplicadas, tags explícitas, âncoras, aliases e merge keys; impõe limites de recursos. As restrições são do OHM, não limitações gerais de YAML.

## Contrato de preservação

Importar, editar e exportar deve preservar os campos de autoria: node `data`, Provider/configuração, conteúdo, Signals, handles, posição e viewport quando existente no contrato. Strings multiline devem manter bytes UTF-8 equivalentes após decodificação, incluindo espaços e quebras de linha. A saída canônica é determinística **após normalização**, sem prometer identidade textual com a entrada.

Comentários, estilo e formatação não têm garantia de ida/volta. Guardar o original integral, separado do modelo, e explicar essa diferença na importação/exportação; a conversão não sobrescreve o original.

`schemaVersion` identifica o contrato de dados, não YAML versus JSON. Hoje há `SCHEMA_VERSION = "1.0.0"` no backend, fallback `"1.1.0"` no frontend e validação apenas de string. Esta ADR não inventa uma versão padrão unificada já implementada nem exige incremento por trocar a serialização.

## Limites e entrega

**P1:** codec restrito, contratos alinhados e roundtrip completo; migração de exemplos, default, compiler, CLI, rotas, canvas e import/export conforme o [handoff](../product/ohm-yaml-migration.md).

**P2:** capacidade de executar loops. Exige contrato próprio para condição, máximo de iterações, orçamento, timeout, cancelamento e HITL. Não basta remover o topo-sort; esta ADR não aprova campos ou scheduler finais.

O website foi implementado em uma trilha paralela e apresenta **“YAML como formato adotado; suporte desktop em migração”**. Ele não faz parte desta entrega. Esta decisão complementa a [ADR 0002](0002-ohm-model.md) e substitui a descrição de OHM como exclusivamente JSON em `CONTEXT.md`; atualizar essa documentação integra P1.
