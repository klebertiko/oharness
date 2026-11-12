# Detecção de CLIs de assinatura — `GET /providers/clis`

Issue #382 (R-PRV-01). Diz, por CLI de assinatura, se está instalado, se há sessão e qual a versão. Roda só `--version` e o comando de status do próprio CLI: nenhum prompt, nenhum token, ambiente com allowlist (I5, I7). Exige o token do sidecar como qualquer rota (sem token: 401).

## Resposta

```json
{"clis": [{"id": "claude", "provider": "anthropic", "installed": true, "loggedIn": true,
           "version": "2.1.4 (Claude Code)", "state": "ready", "detail": "Signed in."}]}
```

| Campo | Tipo | Significado |
| --- | --- | --- |
| `id` | `claude` \| `codex` \| `cursor` | CLI detectado |
| `provider` | `anthropic` \| `openai` \| `cursor` | conexão do catálogo que usa esse CLI |
| `installed` | bool | o binário resolve na busca do próprio adapter. Limite do Cursor: no Windows, com WSL presente, o prefixo `wsl` conta como instalado, então `installed` pode ser `true` sem que o binário dentro da distro tenha sido conferido (#460) |
| `loggedIn` | bool | o comando de status confirmou sessão |
| `version` | string \| null | só a primeira linha do stdout, e só se for uma versão de verdade: começa com letra ou dígito, tem ao menos um dígito, até 80 caracteres de letras, dígitos e `. + _ ( ) -` e espaço, sem `@`. `null` se não instalado, bloqueado, sem resposta ou fora desse formato. Nunca vem do stderr |
| `state` | enum abaixo | estado único para a tela |
| `detail` | string | texto fixo por estado |

`state`:

- `ready` — instalado e com sessão.
- `not-logged-in` — instalado, sem sessão.
- `not-installed` — binário não encontrado.
- `unavailable` — bloqueio de plataforma (Codex fora do Windows, Cursor no Windows sem WSL2): nada é executado, nem `--version`.
- `error` — o status falhou, expirou ou veio ilegível.

## O que nunca aparece na resposta

E-mail da conta, plano, caminho do binário, stderr/stdout cru. `detail` é texto fixo por estado. O que entra na análise de cada resposta de CLI é cortado em 64 KiB (bytes); isso limita a resposta, não a memória: o `run_cli` já guardou a saída inteira (limite nos adapters: #455). Busca de binário que inclui o diretório atual no Windows: #456. Mudar qualquer ponto exige atualizar este documento e o teste `backend/tests/test_cli_detect_api.py`.
