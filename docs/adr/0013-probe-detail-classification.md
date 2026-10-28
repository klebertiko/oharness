# ADR 0013 — Classificar falhas de probe pelo `detail`: contrato aceito

Status: Aceito · 2026-10-28 · Issue #84 (mapa #82) · Teste: `backend/tests/test_probe_detail_contract.py`

## Contexto
Toda falha de probe chega como `health: "fault"` (ou `"setup"` nos CLIs); a diferença só existe no texto de `detail`. A tela Providers e o combo do chat
precisam de uma ação por estado (chave rejeitada, inacessível, rate limit, sem créditos, entrar no CLI, instalar o CLI).

## Tabela
Todos os `detail` de falha que os adapters emitem (`backend/adapters/*.py` em `main`), com a classe proposta. O teste extrai os `detail=` do código
por AST e falha se aparecer um novo, ou se a tabela citar um que não existe mais.

| `detail` (arquivo) | Classe |
|---|---|
| `401 unauthorized — …` (`openai_compatible.py`, 2 pontos) | key-rejected |
| `HTTP {n} from {origin}.` (`openai_compatible.py`, 2 pontos) | 401/403 key-rejected · 402 out-of-credits · 429 rate-limited · demais unknown |
| `Could not reach …` / `… did not respond in time.` (`openai_compatible.py`, 4 pontos) | unreachable |
| `{cli} CLI not found on PATH. …` com `health: setup` (`cli_claude/codex/cursor.py`) | cli-missing |
| `{cli} CLI is installed but not logged in. …` com `health: setup` (idem) | cli-signin |
| `{cli} did not respond to …`, `… returned unreadable output.`, `… exited N.`, última linha do stderr (idem) | unknown |
| `str(exc)` de `httpx.HTTPError` que não é conexão nem timeout (`openai_compatible.py`, 2 pontos) | unknown |
| Portão de plataforma (`_non_windows_gate`, `_windows_gate`), `health: setup` | unknown |
| `… model list larger than 2 MB.`, adapter sem probe | unknown |

## Decisão
**O front pode classificar pelo `detail`.** Nenhum texto cai em duas classes: o status HTTP vem num formato fixo (`HTTP {n} from`), e os casos de CLI
exigem `health: setup` mais a frase. O que não é reconhecido vira `unknown` (mostra "Test again" e o `detail`), nunca uma classe errada. Os casos de
texto livre (stderr do CLI, `str(exc)`, portões de plataforma) são `unknown` por construção, não ambíguos.

Não é preciso abrir issue de backend pedindo `reason` estruturado agora. Reavaliar se o produto passar a exigir ação diferente para algum caso hoje
`unknown`. Custo conhecido: reescrever uma frase de adapter quebra o teste acima de propósito, e o classificador do front (#86) precisa acompanhar.

## Consequências
- O classificador puro do front (#86) implementa exatamente as regras de `classify()` do teste.
- 403 vira key-rejected por decisão (alguns vendors usam 403 para chave inválida); se um vendor usar 403 para outra coisa, trocar a regra aqui e no teste.
- O protótipo descartável é este teste mais esta tabela; não há código de protótipo para apagar.
