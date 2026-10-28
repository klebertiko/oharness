# ADR 0019: worktree por run

Status: aceita (issue #159; depende do Workspace Manager, ADR 0008).

## Decisão
- `POST /execute/` aceita `worktree: true` (padrão `false`, comportamento anterior intacto). O pedido só vale com um `cwd` validado (projeto registrado, ver `_validated_project_cwd`); sem ele a resposta é `400 worktree_needs_workspace` antes de qualquer coisa começar.
- Ao iniciar o stream, `run_worktree.RunWorktree` cria um worktree gerenciado (`WorkspaceService.create(cwd, "HEAD")`, destacado, sob a raiz gerenciada; o cliente nunca informa destino) e o motor roda com esse diretório como `cwd`. O stream emite `worktree_ready {workspace_id}` (o id, nunca o caminho). Duas runs simultâneas no mesmo repositório recebem worktrees distintos e o checkout principal não é escrito.
- Ao encerrar a run (fim normal, erro, parada, cliente que desconectou), o `finally` do stream roda `removal_check` + `remove` do gerenciador. Trabalho deixado no worktree é preservado pelo resgate do ADR 0008 (`refs/openharness/rescue/<id>`) antes de a pasta sumir. Falha na limpeza nunca muda o resultado da run: vira log e o worktree aparece como `orphaned` na listagem, concluído pelas mesmas duas fases.
- Se o worktree não puder ser criado (pasta que não é repositório, por exemplo), a run termina com um evento `error` e o motor não é chamado.

## Escolhas conservadoras (registradas)
- O worktree nasce dentro do stream, não na rota: se o cliente nunca consumir a resposta, nada vaza.
- Só `POST /execute/` neste corte; `/execute/direct` e a escolha na UI ficam fora, para decidir com o dono do agent-run.
- O worktree parte do último commit (`HEAD`): edições não commitadas do checkout principal não entram na run, de propósito (a run não deve depender de um estado que o checkout principal ainda vai mudar). Ao encerrar, o jornal recebe `worktree_closed {workspace_id, rescue_ref}`; `rescue_ref` é a ref do resgate quando a run deixou mudanças (o usuário as recupera por ela).
- A chamada de triagem (intake) de uma run isolada roda sem `cwd`, para nunca tocar o checkout principal.
- Sempre `HEAD` destacado: sem branch nova (evita colisão de nomes entre runs simultâneas).
