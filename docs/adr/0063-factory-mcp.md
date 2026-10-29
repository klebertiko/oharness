# ADR 0063: Factory MCP

Status: aceita (implementação no PR do MCP).

## Decisão
- Servidor MCP local, **stdio por padrão** (`oharness factory mcp`), JSON-RPC 2.0 mínimo (`initialize`, `tools/list`, `tools/call`) escrito à mão, sem dependência nova. Sem HTTP; um transporte de rede só viria com ADR próprio.
- Ferramentas: `factory_submit`, `factory_list`, `factory_status`, `factory_comment`, `factory_cancel`, `factory_metrics`, `factory_claim` (assumir: o item vai a `claimed`, a run própria da fábrica é suspensa e o agente local trabalha num worktree/sessão local) e `factory_release` (devolver: resumo + branch, o item vai a revisão humana).
- Segurança: o cliente MCP é um processo local do dono; ainda assim, o conteúdo que ele envia é tratado como entrada (limites de tamanho/taxa do ADR 0059), a saída das ferramentas é dado (campos de fonte externa saem citados), e nenhuma ferramenta faz merge, push ou executa comando. Credenciais não passam pelo MCP.
