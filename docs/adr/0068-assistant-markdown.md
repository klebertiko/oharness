# ADR 0068 — Resposta do assistente em markdown, sem HTML

Status: Aceito (reversível) · 2026-11-12 · Issue #299 (paridade A10) · Código: `frontend/src/components/agent/AssistantMarkdown.tsx`, `frontend/src/components/agent/safeMarkdown.ts`

## Contexto
A resposta final e a resposta ao vivo no chat eram texto puro (`whitespace-pre-wrap`). O texto do modelo é dado não confiável. Transformar markdown em HTML abriria inclusão de script, esquema `javascript:` e imagem que faz pedido. Uma biblioteca de markdown pesa no bundle e, se aceitar HTML, reabre o mesmo buraco.

## Decisão
- Só a resposta do assistente (mensagem gravada e a região ao vivo) passa pelo renderizador. A mensagem da pessoa continua texto puro.
- O renderizador produz elementos React a partir de um subconjunto. Não interpreta HTML e não escreve HTML.
- O subconjunto é: parágrafos, quebra de linha, título ATX como parágrafo em `font-medium` (a conversa já tem um único `h1`), código cercado e em linha com `t-code`, listas, ênfase e links.
- Um link só existe quando o esquema, depois do parser de URL, é `http` ou `https`. Ele abre em aba nova com `rel="noopener noreferrer"`. Qualquer outro esquema fica texto. Sintaxe de imagem nunca vira `img` (não há pedido): vira link seguro ou texto.
- A coluna segue em no máximo 68ch (`max-w-[68ch]` e `min-w-0`). O bloco de código quebra dentro dela.
- Nenhuma dependência nova.

## Por quê
O limite de segurança fica no tipo do elemento, não numa limpeza de tags feita depois. Sem dependência, o bundle não ganha um parser de markdown, e não aparece um caminho de HTML ao lado.

## Consequências
- Tabela, HTML, link relativo e esquema que não seja `http`/`https` aparecem como texto.
- Um bloco de código ainda aberto na resposta ao vivo já aparece como código, para o texto não alternar a cada token.
- Reverter é voltar o texto puro nas duas chamadas em `AgentStage.tsx`.

## Verificação
`AssistantMarkdown.test.tsx` (entrada hostil, `rel`, `t-code`, 68ch, axe) e `AgentStage.markdown.test.tsx` (mensagem final e resposta ao vivo). Não verificado no app desktop reinstalado: este sandbox não instala o app. O vitest cobre o componente.
