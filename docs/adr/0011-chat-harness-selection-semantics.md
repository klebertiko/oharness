# ADR 0011 — Semântica da escolha de harness no chat: configuração da conversa para os próximos turnos

Status: **Proposta, reversível** · 2026-10-28 · Issue #73 (wayfinder #70) · Código: `lib/chatHarness.ts`, `store/threadStore.ts` (`Thread.harness`, `setThreadHarness`), `components/agent/useChatHarness.ts`, `AgentStage.tsx`

## Contexto
A escolha de harness era um estado global da sessão (`harnessSessionStore`: `enabled` + `activeBundle`): trocar de conversa não trazia a escolha de volta, nada registrava qual harness respondeu e um harness apagado era substituído sem aviso.

## Alternativas
| | Padrão para turnos futuros | Contrato imutável da conversa | Override por run |
|---|---|---|---|
| Troca após mensagens | Livre; vale da próxima mensagem | Proibida (exige fork) | Livre, mas a conversa não "lembra" |
| Histórico | Cada resposta guarda o harness que a produziu | Uniforme | Disperso |
| Carga cognitiva | Baixa: um seletor, um efeito claro | Média: conversa "presa" | Alta: decidir a cada envio |

Como cada turno envia só a instrução (o app já diz "earlier messages are not included automatically"), trocar de harness não corrompe contexto; um contrato imutável só traria atrito.

## Decisão
1. **A escolha é uma configuração da conversa, válida para os próximos turnos** (`Thread.harness`). Uma conversa sem escolha própria (o "novo chat" em branco) segue a escolha da sessão, que também é com o que o próximo chat nasce; ao enviar a primeira mensagem a conversa grava a escolha.
2. **Histórico imutável:** cada resposta registra o harness que a produziu (`ThreadMessage.harness`, carimbado quando o turno *começa*, mesmo que a escolha mude durante a execução).
3. **Trocar depois de haver mensagens** é permitido e deixa uma linha discreta no transcrito (`role=separator`): "Harness changed to X. It applies from your next message; earlier replies stay as they were." Antes da primeira mensagem não há linha.
4. **"No harness"** é uma escolha explícita (`{kind:"none"}`), distinta de "ainda não escolhi": conversa direta com o modelo.
5. **Harness indisponível ou apagado:** a conversa mantém a referência `{id,name}`; o seletor mostra "<nome> (unavailable)", **o envio fica bloqueado** com aviso e a ação "Continue without a harness". Nunca há troca silenciosa. Enquanto a biblioteca carrega, o estado é `loading` (não "missing"); se o carregamento falha, o estado passa a `missing` para a pessoa não ficar presa, e o aviso diz as duas causas. Limite conhecido: um harness vindo do Studio ("Use in chat") só existe como harness ativo da sessão; ao trocar para outro, a conversa dele passa a ver "indisponível".
6. **Provider fixado:** harness e provider são eixos independentes. Escolher harness não altera o provider do chat; agentes do harness usam seus modelos/conexões fixados (ou o provider do chat quando não fixam), como o rodapé do composer já diz. O seletor de harness não mostra providers.
7. **Vocabulário para não especialistas:** rótulo "Harness"; "No harness" = "Direct conversation with the model"; avisos em frases curtas, sem "bundle", "manifest" ou ids.

## Sessão e conversa
A sessão (`harnessSessionStore`) continua sendo o que o motor lê. Uma única instância (`useChatHarness(true)`, no palco do chat) a mantém alinhada: abrir uma conversa aplica o harness dela; uma escolha feita fora (paleta de comandos, "Use in chat" do Studio) com uma conversa aberta vira o harness *dessa* conversa (com a linha de troca). O `hydrate` da sessão não sobrescreve um harness posto em uso enquanto o padrão carregava.

## Modelo de dados mínimo
`ThreadHarness = {kind:"none"} | {kind:"harness", id, name}` em `Thread.harness?` e `ThreadMessage.harness?` (aditivo; conversas antigas não têm campo e seguem a sessão até a primeira escolha).

## Consequências
- Voltar a uma conversa antiga restaura o harness dela e reposiciona a sessão (o próximo chat nasce com o harness em uso por último).
- Mudar a política (p.ex. exigir fork ao trocar) afeta só `setThreadHarness` e `useChatHarness`.
