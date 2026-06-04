# easypanel-mcp-server

> MCP Server for full Easypanel control via Claude Code, Cursor and Claude Desktop.

37 tools — deploy, logs, env vars, domains, databases and monitoring.  
Built-in safety guards: destructive actions require explicit `confirm: "CONFIRMO"`.

[![npm version](https://badge.fury.io/js/easypanel-mcp-server.svg)](https://www.npmjs.com/package/easypanel-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Quick start

### Option A — npx (no install needed)

```json
{
  "mcpServers": {
    "easypanel-mcp": {
      "command": "npx",
      "args": ["-y", "easypanel-mcp-server"],
      "env": {
        "EASYPANEL_URL": "https://your-panel.example.com",
        "EASYPANEL_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Option B — local build

```bash
git clone https://github.com/helbertparanhos/easypanel-mcp-server
cd easypanel-mcp-server
npm install && npm run build
```

```json
{
  "mcpServers": {
    "easypanel-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/easypanel-mcp-server/dist/index.js"],
      "env": {
        "EASYPANEL_URL": "https://your-panel.example.com",
        "EASYPANEL_TOKEN": "your-api-token"
      }
    }
  }
}
```

**Get your token:** Easypanel → Settings → API → Generate Token

---

## Adding to a project

Place `.mcp.json` at the project root (see above), then add this to your `CLAUDE.md`:

```markdown
## Easypanel
Project: `my-project` | Service: `my-api` | Branch: `main`
Repo: `owner/repo`
```

That's it. No folder copying needed — one MCP install serves all your projects.

---

## Available tools (37)

| Category | Tools |
|----------|-------|
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` ⚠️ |
| **Services** | `inspect_service`, `create_service`, `rename_service`, `destroy_service` ⚠️, `deploy_service`, `start_service`, `stop_service` ⚠️, `restart_service`, `get_service_error`, `get_service_notes`, `set_service_notes` |
| **Deploy / GitHub** | `set_source_github`, `set_source_image`, `enable_github_deploy`, `disable_github_deploy`, `list_actions`, `get_action` |
| **Env Vars** | `get_env_vars`, `set_env_var`, `delete_env_var` ⚠️ |
| **Logs** | `get_service_logs`, `get_build_logs`, `get_system_stats` |
| **Domains** | `list_domains`, `add_domain`, `remove_domain` ⚠️, `set_primary_domain` |
| **Databases** | `create_database`, `inspect_database`, `destroy_database` ⚠️ |
| **Monitoring** | `get_docker_stats`, `get_storage_stats`, `get_service_stats` |

⚠️ = requires `confirm: "CONFIRMO"` to execute.

---

## Safety features

### Context banner
Every response that touches a specific project/service starts with:
```
[Contexto ativo: projeto="my-project" | serviço="my-api"]
```
Ensures Claude always knows what it is modifying.

### Confirmation guard
Destructive or production-impacting actions return `BLOQUEADO` until they receive `confirm: "CONFIRMO"`:

```json
{
  "status": "BLOQUEADO",
  "acao": "stop_service",
  "alvo": "serviço \"api\" (usuários perderão acesso)",
  "instrucao": "Para confirmar, passe o parâmetro: confirm: \"CONFIRMO\"",
  "aviso": "⚠️  Esta ação pode ser IRREVERSÍVEL. Confirme apenas se tiver certeza."
}
```

### Safe env vars (read-modify-write)
`set_env_var` and `delete_env_var` read the current state, apply only the requested change, and write back. The Easypanel API replaces the entire env string on every update — without this protection it's easy to accidentally wipe all variables.

---

## Companion skill `/ep`

Install the workflow skill for guided deploy operations:

```bash
mkdir -p ~/.claude/skills/ep
cp skill/SKILL.md ~/.claude/skills/ep/SKILL.md
```

Then use `/ep` in Claude Code for an interactive deploy workflow.

---

## Testing without Claude

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

Opens a browser UI where you can call any tool manually.

---

## Comparison with similar packages

| Feature | easypanel-mcp-server | easypanel-mcp (sitp2k) |
|---------|---------------------|----------------------|
| Total tools | **37** | ~15 |
| Auth method | Bearer token | Email + password |
| Confirmation guard | ✅ | ❌ |
| Safe env update (read-modify-write) | ✅ | ❌ |
| Deploy action tracking | ✅ | ❌ |
| Companion Claude skill | ✅ | ❌ |
| GitHub deploy control | ✅ | Partial |

---

## Publishing

```bash
npm login
npm publish
```

After publishing, anyone can use it with `npx easypanel-mcp-server` — no cloning needed.
