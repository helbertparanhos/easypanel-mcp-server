# Easypanel MCP — Como incluir neste projeto

Cole este bloco no `CLAUDE.md` do seu projeto para que o Claude saiba como usar o Easypanel:

---

## Easypanel (Deploy e Gestão)

Este projeto usa o **easypanel-mcp-server** para deploy e gestão de serviços.

**Painel:** `https://SEU-PAINEL.EXEMPLO.COM`
**Projeto Easypanel:** `NOME-DO-PROJETO`
**Serviço principal:** `NOME-DO-SERVICO`
**Repo GitHub:** `owner/repo` — branch: `main`

### Como fazer deploy

```
1. Verifique o serviço:   inspect_service projectName="NOME-DO-PROJETO" serviceName="NOME-DO-SERVICO"
2. Dispare o deploy:      deploy_service  projectName="NOME-DO-PROJETO" serviceName="NOME-DO-SERVICO"
3. Acompanhe:             list_actions
```

### Regras para este projeto

- SEMPRE inspecione o serviço antes de alterar qualquer configuração
- Confirme o contexto `[Contexto ativo: projeto="X" | serviço="Y"]` antes de executar
- Operações destrutivas requerem `confirm: "CONFIRMO"` — não execute sem confirmação explícita do usuário
- Depois de alterar env vars, sempre avise que é necessário fazer um novo deploy

---

## Configuração do MCP (Claude Code / Cursor)

Adicione ao `.mcp.json` do projeto ou ao `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "easypanel-mcp": {
      "command": "node",
      "args": ["/CAMINHO/PARA/easypanel-mcp-server/dist/index.js"],
      "env": {
        "EASYPANEL_URL": "https://SEU-PAINEL.EXEMPLO.COM",
        "EASYPANEL_TOKEN": "SEU-TOKEN-API"
      }
    }
  }
}
```

**Token:** Easypanel → Settings → API → Generate Token
