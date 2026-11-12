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
| `installed` | bool | o binário resolve (busca do próprio adapter) |
| `loggedIn` | bool | o comando de status confirmou sessão |
| `version` | string | uma linha, até 80 caracteres; vazia se não instalado, bloqueado ou sem resposta |
| `state` | enum abaixo | estado único para a tela |
| `detail` | string | texto fixo por estado |

`state`:

- `ready` — instalado e com sessão.
- `not-logged-in` — instalado, sem sessão.
- `not-installed` — binário não encontrado.
- `unavailable` — bloqueio de plataforma (Codex fora do Windows, Cursor no Windows sem WSL2): nada é executado, nem `--version`.
- `error` — o status falhou, expirou ou veio ilegível.

## O que nunca aparece na resposta

E-mail da conta, plano, caminho do binário, stderr/stdout cru. `detail` é texto fixo por estado; cada resposta de CLI é lida até 64 KiB. Mudar isso exige atualizar este documento e o teste `backend/tests/test_cli_detect_api.py`.
