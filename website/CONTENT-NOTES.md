# Atualização após a decisão YAML — 11/09/2026

O usuário aprovou YAML 1.2 como sintaxe dos arquivos `.ohm`, mantendo JSON nas APIs e importação dos documentos JSON anteriores. A página e o exemplo foram atualizados com indicação explícita de suporte desktop em migração. Os achados abaixo registram a implementação JSON consultada antes dessa decisão; não foram convertidos em alegações de suporte YAML já entregue. A validação do exemplo YAML é feita após parsing contra o schema atual, separada do leitor de arquivos do desktop.

Decisão: `../docs/adr/0003-ohm-yaml.md`. Plano: `../docs/product/ohm-yaml-migration.md`.

# Notas de conteúdo — OHarness Model

Base editorial verificada no checkout local em 11/09/2026, com alterações em andamento. Estas notas descrevem o código consultado; não certificam uma versão publicada. O [manifesto](D:/Development/src/OHarness/website/MANIFESTO.md) distingue princípios desejados das funções existentes.

## Nome, propósito e estado da documentação

**OHarness Model (OHM)** é o nome do modelo; **`.ohm`** é a extensão canônica. O vocabulário do produto reúne Agent, Gate, HITL, Skill e Signal. McpServer e Tool são Connections; os vínculos com Providers pertencem à composição. Essa descrição conceitual não equivale a um contrato completo de execução ou a campos próprios no schema atual.

Fontes: [CONTEXT.md](D:/Development/src/OHarness/CONTEXT.md) e [ADR 0002](D:/Development/src/OHarness/docs/adr/0002-ohm-model.md).

A migração de nomenclatura está incompleta. [README da especificação](D:/Development/src/OHarness/docs/harness-spec/README.md) e [HELLO.md](D:/Development/src/OHarness/docs/harness-spec/HELLO.md) ainda descrevem `.oharness` e apontam para a antiga fixture. A rota de modelo padrão já lê [default-agile.ohm](D:/Development/src/OHarness/backend/oharness/fixtures/default-agile.ohm), conforme [bundles.py](D:/Development/src/OHarness/backend/routers/bundles.py). Usar `.ohm` na página e tratar `.oharness` como legado legível durante a migração.

## Arquivo e schema reais

O arquivo é **um único documento JSON UTF-8**. “Bundle” designa esse documento com conteúdo incorporado. No caminho de leitura/exportação consultado, não há contêiner ZIP, diretório interno ou arquivo `manifest.json` separado: `manifest` é um objeto do próprio JSON.

Evidências: `validate_path` lê texto e usa `json.loads` em [validate.py](D:/Development/src/OHarness/backend/oharness/validate.py); `downloadOHarness` serializa JSON indentado como `application/json` e usa `.ohm` por padrão em [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts). A [biblioteca de harnesses](D:/Development/src/OHarness/frontend/src/components/harnesses/HarnessLibrary.tsx) aceita `.ohm`, `.oharness` e JSON, faz parse e chama a validação antes de importar. A extensão, sozinha, não atesta validade.

O contrato estrutural está em [oharness.schema.json](D:/Development/src/OHarness/backend/oharness/schema/oharness.schema.json), usando JSON Schema Draft 2020-12. [models.py](D:/Development/src/OHarness/backend/oharness/models.py) define os modelos Pydantic e `SCHEMA_VERSION = "1.0.0"`.

| Campo obrigatório na raiz | Estrutura exigida pelo JSON Schema |
| --- | --- |
| `schemaVersion` | String. |
| `manifest` | `id`, `name`, `version`, `description`, `license`: strings; `tags`: lista de strings. |
| `graph` | Listas `nodes` e `edges`; ambas podem estar vazias. |
| `content` | Mapas `prompts`, `agents`, `skills`, `hooks`, `commands`, `scripts`; podem estar vazios. |
| `runtime` | `preferred`: string; `cli`: string ou null; `env` e `secrets`: listas. |
| `validation` | `mockProfile`: string. |

A raiz e esses objetos estruturais rejeitam propriedades adicionais. O interior dos nós, arestas, mapas de conteúdo e listas de runtime permanece amplamente livre: os modelos usam `Any`, e o schema não descreve uma estrutura detalhada para esses elementos. Não há campos de raiz `connectors` ou `providers`; não inventar um exemplo que os acrescente.

Os modelos Pydantic oferecem valores padrão para vários campos que o JSON Schema exige explicitamente. A validação pública aplica primeiro o JSON Schema, depois as regras do grafo e o modelo Pydantic. Conseguir construir um objeto Pydantic não substitui esse caminho de validação.

## Validação e limites

Em [validate.py](D:/Development/src/OHarness/backend/oharness/validate.py), a validação adicional exige nós com IDs textuais não vazios e únicos e arestas cujas origens e destinos existam. Ela não verifica integralmente tipos do catálogo, Signals, permissões, disponibilidade de Providers ou comportamento dos conteúdos incorporados.

`schemaVersion` e `manifest.version` não têm restrição semântica de versão no schema. O validador não compara `schemaVersion` à constante do backend. Há ainda uma divergência concreta: `composeBundleFromCanvas`, em [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts), cria uma base com `schemaVersion: "1.1.0"` quando não recebe modelo base, enquanto backend e fixture usam `1.0.0`. Isso não comprova a existência de um segundo schema implementado.

O [mock](D:/Development/src/OHarness/backend/oharness/mock_run.py) ordena o grafo topologicamente, marca etapas planejadas e sinaliza como ignoradas as que não entram nessa ordem. Não chama modelos nem executa o conteúdo incorporado; `mockProfile` não seleciona comportamentos nessa função. Um ciclo pode passar na validação estrutural e falhar no mock.

Verificações realizadas em memória, sem alterar as fontes: a fixture `.ohm` e o exemplo legado [valid-hello.oharness](D:/Development/src/OHarness/backend/tests/oharness/fixtures/valid-hello.oharness) passaram na validação; uma versão arbitrária também passou; um grafo cíclico passou no validador e retornou `ok: false` no mock. Não foi realizada uma homologação completa do produto.

## Portabilidade e autoridade humana

A exportação de arquivo está implementada. Porém, `composeBundleFromCanvas` reduz nós a `id`, `role`, `label` e arestas a `id`, `source`, `target`. Nessa conversão, dados adicionais do canvas, como vínculos de Providers, configuração de nós e Signals nas arestas, não são preservados. Portanto, não anunciar fidelidade integral de ida e volta nem execução equivalente em qualquer ambiente. Fonte: [bundlesApi.ts](D:/Development/src/OHarness/frontend/src/lib/bundlesApi.ts).

Há pausa para nós `hitl` no [engine.py](D:/Development/src/OHarness/backend/engine.py): o estado passa a `awaiting_human`, o motor aguarda liberação e uma decisão `reject` interrompe a execução. O endpoint de [controle da execução](D:/Development/src/OHarness/backend/routers/execution.py) permite parar e retomar. Contudo, a retomada sem decisão explícita assume `approve` no motor. Descrever como ponto de intervenção implementado; não prometer aprovação humana explícita obrigatória para toda ação ou autoridade garantida por qualquer consumidor do arquivo.

A fixture atual inclui HITL. Já o [compilador do harness](D:/Development/src/OHarness/backend/oharness/compile_skills_harness.py) ainda o omite do grafo que gera, mantendo os oito papéis de agentes. Os dois artefatos não estão totalmente alinhados.

## Critérios para a página

- **Fato sustentado:** representação JSON, conteúdo incorporado, importação/exportação nos caminhos descritos, validação estrutural, planejamento simulado e pausa HITL com os limites acima.
- **Valor ou aspiração:** abertura à inspeção e evolução, legibilidade, portabilidade entre ambientes, clareza das conexões e autoridade humana. Usar “defendemos”, “queremos” ou “nosso horizonte”.
- **Sem respaldo para anúncio:** licença open source do produto, governança formal, adoção, métricas, compatibilidade universal, lançamento ou disponibilidade de instalador. O campo `manifest.license`, inclusive o valor `MIT` presente na fixture e no código de composição, é metadado do documento e não comprova a licença do projeto. Exportar um `.ohm` não equivale a oferecer download de instalador.
- Não apresentar MCP como compatibilidade certificada ou endosso. O vocabulário arquitetural e a inspiração no protocolo, isoladamente, não comprovam conexões operacionais em qualquer ambiente.

## Inspirações, sem reprodução

A ideia de dar ao contexto um lugar legível foi inspirada em [AGENTS.md](https://agents.md/). A atenção às conexões entre aplicações de IA, ferramentas e fontes de dados vem da [introdução ao MCP](https://modelcontextprotocol.io/docs/getting-started/intro). A escolha de uma declaração curta de valores foi inspirada no [Manifesto Ágil em português](https://agilemanifesto.org/iso/ptbr/manifesto.html).

Essas referências orientam princípios e forma editorial. O manifesto tem redação original; não transfere licenças, governança, adoção, garantias ou vínculos institucionais dessas iniciativas para o OHM.

## Complemento editorial — ecossistema e Nilo (11/09/2026)

A seção pública agora inclui [Agent Skills](https://agentskills.io/home), formato de conhecimento/instruções reutilizáveis; [engenharia de prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview), com instruções e critérios de avaliação; e [A2A](https://a2a-protocol.org/latest/), comunicação entre agentes. Textos foram redigidos em pt-BR a partir das fontes oficiais, sem transcrição e sem alegar integração implementada.

A ordem parte da orientação do agente e chega aos princípios de organização do trabalho. Nilo tem apresentação própria e utiliza quadros gerados diretamente por `niloFrame` e `statePose` do desktop. Sua animação nesta página é demonstrativa; não indica uma execução real de agentes. A fonte original de identidade permanece preservada.
