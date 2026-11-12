## O que e por quê
<!-- 1–3 linhas. Link da tarefa: Closes #n -->

## Como verificar
<!-- comandos / telas; o que NÃO foi verificado (sandbox sem rede, chaves, SO, dispositivo) -->

## Checklist (docs/process/pre-pr-checklist.md)
- [ ] Base em `main`, sem empilhar em PR aberto; branch atualizada
- [ ] Sem variável/import sem uso (ruff F401,F841 / biome), sem chave-constante em teste, sem RegExp dinâmico, sem `shell=True`
- [ ] Sem `tsbuildinfo`/`next-env.d.ts`/arquivos gerados, sem caminhos ou e-mails pessoais
- [ ] Teste que falha no código antigo; flake tratado na causa raiz (sem skip/retry)
- [ ] UI: tokens, dois temas, axe, teclado, reduced-motion, i18n en/pt-BR
- [ ] ADR (se decisão difícil de reverter); docs atualizadas se o comportamento mudou
- [ ] `/code-review` high tratado; threads respondidas
- [ ] CI completo concluído e verde no head final

## Definition of Done (docs/process/backlog.md)
- [ ] Cada critério do "Pronto quando" está provado acima (teste, tela ou comando); o que não foi verificado está dito
- [ ] Revisão QA e SEC em contexto limpo, sem achado aberto, no SHA do head (quem mescla confere o SHA)
- [ ] Contrato de assinatura verde; sem segredo; assinatura não inventa USD
- [ ] Achados baixos e lacunas viraram issue com número; issue e épico atualizados
