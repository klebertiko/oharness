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
| `installed` | bool | o binário resolve na busca do próprio adapter. Limite: no Windows, com WSL presente, o prefixo `wsl` conta como instalado sem conferir o binário dentro da distro (#460) |
| `loggedIn` | bool | o comando de status confirmou sessão |
| `version` | string | só a primeira linha do stdout e só se parecer versão (letras, dígitos e `. _ + ( ) -`, até 80); vazia se não instalado, bloqueado, sem resposta ou fora desse formato. Nunca vem do stderr |
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
