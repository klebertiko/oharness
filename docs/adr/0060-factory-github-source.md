# ADR 0060: Fonte de trabalho GitHub

Status: aceita (implementação no PR de GitHub). Primeira entrega do contrato do ADR 0059.

## Decisão
- **Gatilhos:** issue ou PR aberto/comentado com menção ao handle da fábrica (`@payments`), ou label configurado como gatilho. Um comentário de bot da própria fábrica nunca dispara (evita laço). `allowed_authors` limita quem pode disparar.
- **Entrada:** webhook (`X-Hub-Signature-256`, HMAC do segredo no cofre, `X-GitHub-Delivery` como id de replay) e/ou polling da API REST com ETag. Webhook só no receptor local (ADR 0061); polling não abre porta nenhuma e é o caminho recomendado para quem não quer receber conexões.
- **Saída:** o resultado volta no mesmo issue/PR (comentário) via `reply`. A fábrica não faz merge, não faz push em branch protegida, não aprova PR.
- **Token (escopo mínimo):** fine-grained PAT ou GitHub App restrito aos repositórios escolhidos, com `Issues: read/write`, `Pull requests: read/write` (comentar) e `Metadata: read`; **sem** `Contents: write`, `Administration` nem `Workflows`. Quem escreve código usa o worktree local e a credencial git do dono, fora do conector.
- **Idempotência:** `idempotency_key = github:<repo>:<issue|pr>#<n>:<delivery|comment id>`.
- Corpo, título e comentário são texto não confiável (ADR 0059).

## Não verificado
Nada foi exercido contra a API real do GitHub (sem rede/token no sandbox); payloads de teste seguem a documentação pública dos eventos `issues`, `issue_comment` e `pull_request`.
