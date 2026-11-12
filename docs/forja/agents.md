# Agentes da Forja

Um agente da Forja é um ator de longa duração descrito por um arquivo em `agents/<id>/agent.md` (ver [definição](definition.md)). Ele junta instruções, modelo, harness opcional, skills, servidores MCP e um modo de permissão. Não é o nó *Agent* de um harness: o agente da Forja executa um harness (ou o loop direto) em runs.

## Começar com os agentes padrão

```bash
python -m oharness forja init .oharness/forja --name payments --model openai/gpt-4o --review-model anthropic/claude-opus --role triage --role implement --role review
```

Escreve uma pasta válida: o foreman mais os papéis pedidos, cada um com o ponto de partida do seu papel (`default_agent`). Nunca sobrescreve uma pasta que já tem arquivos; se a escrita falha no meio, a pasta fica ausente ou vazia para a próxima tentativa. Recusa o que a definição recusaria, como um review com o mesmo modelo do implement. Depois é só editar os arquivos e rodar `python -m oharness forja validate .oharness/forja --check`.

## Adoção parcial

O foreman é obrigatório. Triage, Spec, Implement, Review, Verify e Monitor são opcionais: só os agentes com `enabled: true` participam, e um estágio sem agente ligado espera a pessoa (por exemplo, ligar só o Triage). Qualquer outro `id` com `role: custom` é um agente custom.

## O acesso vem da configuração, não do prompt

O que um agente alcança é calculado só pelos campos de configuração:

| Campo | Efeito |
| --- | --- |
| `permissions.mode` | Modo de permissão do agente; vale o mais restritivo entre ele e `policy.maxPermissionMode`. |
| `mcp` | Lista explícita de servidores. Nada é herdado. |
| `secrets` | Referências `forja/<nome>` que o agente recebe só nas suas runs. Sem lista, nenhum segredo. |
| `tokenCeiling`, `permissions.maxTokens` | Teto de tokens; vale o menor entre eles e `ceilings.tokensPerRun`. |
| repositórios | Os repositórios declarados na Forja. |

Instruções e skills são orientação. Editar um texto (ou instalar uma skill) não adiciona servidor, segredo, repositório nem permissão; um teste de contrato compara as capacidades antes e depois de mudar só as palavras. O runner entrega só os segredos desse cálculo. O plano do foreman só atribui a um estágio um agente que ele pode receber: o modo é o efetivo (o mais restritivo), um harness só cabe em `plan` ou `read_only`, e `maxTokens` não passa do teto calculado. O texto do foreman na chamada ao modelo é o das instruções e das skills dele. Isso também limita injeção de prompt: texto que chega de fora não amplia o que o agente alcança.

## Skills

Quatro origens, com o rótulo que o código grava. As de papel (`role`) vêm primeiro, embarcadas por papel; o foreman leva `reply-to-origin`. Cada skill citada em `skills` resolve nesta ordem: a do agente (`agent`, `agents/<id>/skills/<id>/SKILL.md`), a global (`global`, `skills/<id>/SKILL.md`) e a embutida (`builtin`, `forja-definition` e `forja-intake`). Agentes `custom` não recebem as embutidas. As skills estendem as instruções do agente e não as substituem.

## Review diferente de implement

Com `policy.reviewIndependence: require`, o review precisa diferir do implement em modelo ou harness, e isso é conferido na definição e em cada plano do foreman.
