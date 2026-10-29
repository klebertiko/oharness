# ADR 0035 — Tela Providers: a tela é dona do palco, lista e conexão lado a lado, um painel por vez no estreito

Status: Aceito (reversível) · 2026-10-29 · Redesenho da tela Providers (auditoria U1, U5, U6, U7, U9) · Código: `frontend/src/components/providers/ProvidersScreen.tsx`

## Contexto
A tela era a lista no painel esquerdo do shell (216px) e o "dossiê" no palco. Abaixo de 640px o shell esconde o painel esquerdo e a lista virava um combobox ("OpenRouter — Not c…"). O dossiê empilhava nove blocos do mesmo peso; o seletor de modelos ficava no fim e sem busca; a tela abria sempre no OpenRouter.

## Decisão
- **O palco é a tela.** `section === "providers"` não tem mais painel esquerdo; `ProvidersScreen` ocupa o palco com a lista (20rem) e a conexão aberta.
- **Largura do palco, não da janela.** Duas colunas quando o palco tem 42rem ou mais (container query `@2xl`); abaixo disso, ou só a lista ou só a conexão, com botão "Providers" (voltar) no topo da conexão. Abrir uma conexão a partir do chat (`select(id)` e ir para Providers) cai direto nela.
- **`selectedId` vazio significa "nada escolhido".** O padrão deixou de ser `"openrouter"`: sem escolha, a conexão aberta é a mais próxima de responder (`closestToReady`, a mesma ordem da ADR 0016), senão a primeira. Uma instalação nova abre no próximo passo, não num fornecedor arbitrário.
- **Hierarquia da conexão:** cabeçalho (nome, uma palavra de estado, a frase do último teste, onde roda e quanto custa, **uma** ação primária) e quatro painéis: Conexão (chave, endereço, em uso), Modelos, Atividade, Sobre. Quando falta a chave, o campo de chave é a ação e o cabeçalho não tem segundo primário.
- **Grupos da lista:** "Needs action" (mais perto de pronta primeiro), "Ready", "Agents only". Offline vira um grupo só, sem afirmar estado.
- **Estados:** carregando (esqueleto com a altura da linha), offline (aviso com Retry; as linhas dizem "Can't check", nunca "Not connected"), testando, erro classificado (ADR 0013), modelo não baixado, precisa de ação, conectado, sem modelos, vazio.
- **Modelos:** lista pesquisável e limitada (8 sem busca, 25 com busca, "+N, refine o filtro"), com o padrão marcado e "Use" por linha (ADR 0015).
- **Remover chave** pede confirmação na própria linha, com Cancel como foco padrão.
- Contratos mantidos: a tela nunca mostra credencial (só prefixo, barra desenhada e final), `secretRef` segue opaco, e o valor colado nunca sai do campo não controlado.

## Por quê
Linear, Raycast e Zed põem um estado e uma ação por integração e deixam o detalhe um nível abaixo; a lista com o estado de cada linha é o que se escaneia, então ela tem de existir também no celular. Container query segue o espaço que a tela tem de fato (o shell ainda tira 220px do palco).

## O que não foi feito
- Sem medição com pessoas: a ordem dos painéis vem da auditoria (o que se faz primeiro é chave ou ação, depois modelo) e das três referências.
- A tela de Providers do `/dev/providers` usa a mesma tela, mas o "Run binding" lateral segue como estava (só dev).

## Consequências
- `ProvidersList`, `Dossier`, `CredentialSeal`, `ModelSection` e `Wallet` foram removidos; os testes foram reescritos em `ProvidersScreen.test.tsx`.
- Reverter é restaurar o painel esquerdo e o dossiê (git); o store só ganhou `loadState` (ADR 0034) e o padrão vazio de `selectedId`.
