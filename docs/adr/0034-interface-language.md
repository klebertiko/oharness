# ADR 0034 — Idioma da interface: catálogos tipados `en` e `pt-BR`, trocados pela paleta; só `src/i18n` tem acentos

Status: Aceito (reversível) · 2026-10-29 · Redesenho da tela Providers (auditoria D9) · Código: `frontend/src/i18n/`

## Contexto
O app não tinha camada de idioma. Um teste de guardrail (`design-system/guardrails.test.ts`) exigia **interface só em inglês** (sem acentos em nenhum arquivo de `src`), porque a mistura antiga de português solto num produto em inglês era um defeito (auditoria `screens.md`, X11). O pedido agora é a tela Providers em pt-BR e en.

## Decisão
- `src/i18n/`: `messages.en.ts` é o catálogo-fonte; `messages.pt-BR.ts` é tipado com as mesmas chaves (chave faltando é erro de tipo). `translate(locale, chave, vars)` preenche `{nome}` e, se faltar chave, cai para o inglês, nunca para a chave.
- Idioma: escolha salva (`oharness-locale`), senão o primeiro idioma do navegador (qualquer `pt` vira `pt-BR`), senão `en`. O estado começa em `en` no servidor e na primeira renderização, para o HTML estático e a árvore hidratada concordarem; `AppShell` chama `hydrate()` no efeito.
- Troca: comando da paleta ("Language: Português (Brasil)" / "Language: English"). Não há tela de configurações para isso.
- O guardrail muda de "sem acentos em `src`" para "sem acentos **fora de `src/i18n`**": texto em português só vive nos catálogos, nunca solto em componente.
- Comandos, ids, nomes de modelo e rótulos de máquina nunca passam por catálogo (teste: o texto entre crases é idêntico nos dois idiomas).
- As palavras de estado e os rótulos de ação por estado (`rowStatus`, `chatProviderStatus`, `nextStep`) usam `tr()` (tradução fora de React), então a lista, o combo do chat e o CTA do composer continuam dizendo a mesma coisa em cada idioma (ADR 0016).

## Por quê
Um catálogo tipado pega chave faltando na compilação e mantém o acento num lugar só, o que preserva o objetivo do guardrail antigo (nada de português perdido no meio do código). Escolher pelo navegador e deixar a paleta trocar evita uma tela de configurações que o produto ainda não tem.

## O que não foi feito / limites
- **Só a tela Providers e as palavras de estado que ela compartilha foram traduzidas.** Chats, Studio, paleta e a maior parte do chat seguem em inglês; em pt-BR a interface fica mista até outra entrega. É a limitação mais visível desta decisão.
- Sem plural (`{n} modelos`): as frases foram escritas para não precisar. Se surgir um caso, trocar por `Intl.PluralRules` na chave.
- Datas e números usam `toLocaleString()` do navegador, não o idioma escolhido aqui.
- Nenhuma revisão por falante nativo além do autor; os textos em pt-BR seguem as regras de conteúdo do design system (frase em minúscula, segunda pessoa, o que fazer a seguir).

## Consequências
- Adicionar um idioma é um arquivo `messages.<locale>.ts` e uma entrada em `LOCALES`.
- Reverter para só inglês é apagar `src/i18n`, trocar `tr(...)` pelos textos e restaurar a regra do guardrail.
