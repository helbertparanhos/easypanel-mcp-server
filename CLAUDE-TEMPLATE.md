# Easypanel — Contexto para o CLAUDE.md

Cole o bloco abaixo no `CLAUDE.md` do seu projeto, preenchendo os dados.
A URL e o token já estão no `.mcp.json` — aqui só vai o contexto operacional.

---

## Easypanel

**Projeto Easypanel:** `NOME-DO-PROJETO`
**Serviço principal:** `NOME-DO-SERVICO` _(deixe em branco se ainda não existe — use `list_projects` para descobrir)_
**Repo GitHub:** `owner/repo` — branch: `main`

### Regras para este projeto

- Antes de qualquer operação, use `inspect_service` para ver o estado atual
- Sempre confirme o contexto `[Contexto ativo: projeto="X" | serviço="Y"]` antes de executar
- Operações destrutivas requerem `confirm: "CONFIRMO"` — não execute sem o usuário confirmar explicitamente
- Após alterar env vars, avise que é necessário fazer um novo deploy para aplicar

### Fluxo de deploy

```
1. list_projects                                          → descubra o projeto/serviço
2. inspect_service projectName="X" serviceName="Y"       → veja estado atual
3. deploy_service  projectName="X" serviceName="Y"       → dispare o deploy
4. list_actions                                           → acompanhe o progresso
```

---

_A conexão com o Easypanel (URL + token) está no `.mcp.json` deste projeto — não é necessário repetir aqui._
