# ADR 0046: disparar e acompanhar uma run isolada em worktree (UI)

Status: aceita. Completa o #159 depois do ADR 0019 (que só tinha a API).

## Decisão
- **Disparar:** com o harness ligado e uma pasta de trabalho escolhida, a barra de configurações da run mostra o interruptor "Own worktree on/off" (padrão desligado; desabilitado durante uma run). Ligado, a run de harness segue com `worktree: true` e o `cwd` da pasta; sem pasta, ou num turno direto de chat (sem grafo para isolar), o campo nem é enviado. O estado vive em `runWorktreeStore`, como o interruptor de subagentes.
- **Acompanhar:** a transcrição mostra, como aviso da run, "This run works in its own worktree; your folder is not touched." ao abrir o worktree e, ao fechá-lo, "The worktree was removed. Its changes are kept on <ref>." (ou "It had no changes to keep."). O servidor agora remove o worktree e envia `worktree_closed` no próprio stream **antes** do `harness_done` (o cliente ainda escuta e uma continuação feita assim que a run completa já encontra a ref de resgate); o jornal o recebe uma vez só, então o histórico da run mostra o mesmo texto ao ser reaberta e a continuação (ADR 0044) sabe de qual ref partir. Fim anormal (cliente que saiu, erro) segue o caminho antigo: o `finally` fecha o worktree e grava o evento no jornal.
- **Design:** só o `Button` e os avisos que já existem (tokens do design system, nenhuma cor nova), então vale nos dois temas; teste axe no interruptor. O caminho da ref aparece como texto, sem caminho absoluto.

## Fora de escopo / limites
- O interruptor vale para runs de **harness**. Um comando `/` (ferramenta) e o modo Plan são turnos diretos e continuam na pasta; o texto do interruptor diz isso.
- Se a remoção do worktree falhar, a run não muda de resultado e nenhum aviso de fechamento é enviado; o worktree aparece como `orphaned` na listagem do Workspace Manager (ADR 0008).
- **Idiomas:** o frontend não tem camada de internacionalização (toda a interface está em inglês, como o glossário manda para os termos). As strings novas seguem esse padrão; pt-BR depende de uma decisão de produto (qual biblioteca, onde ficam os catálogos) que não cabe num PR deste tamanho. O que falta: catálogo `en`/`pt-BR` e tradução destas strings quando a camada existir.
- `/execute/direct` continua sem worktree (não há grafo a isolar).
