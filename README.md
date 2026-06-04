# easypanel-mcp-server

> MCP Server for full Easypanel control via Claude Code, Cursor and Claude Desktop.

[![npm version](https://img.shields.io/npm/v/easypanel-mcp-server.svg?style=flat-square)](https://www.npmjs.com/package/easypanel-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/issues)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-000000?style=flat-square)](https://modelcontextprotocol.io/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-D97706?style=flat-square)](https://claude.ai/code)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-4F46E5?style=flat-square)](https://cursor.sh)

[![Instagram](https://img.shields.io/badge/@helbertparanhos-E4405F?style=flat-square&logo=instagram&logoColor=white)](https://www.instagram.com/helbertparanhos)
[![YouTube](https://img.shields.io/badge/stratacademy-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://www.youtube.com/@stratacademy)
[![LinkedIn](https://img.shields.io/badge/helbert--paranhos-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/helbert-paranhos/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/helbertparanhos)
[![Strat Academy](https://img.shields.io/badge/Strat%20Academy-8B5CF6?style=flat-square)](https://stratacademy.com.br)

---

## What is this

**easypanel-mcp-server** connects Claude Code, Cursor and Claude Desktop directly to your [Easypanel](https://easypanel.io) instance — a modern Docker-based server control panel — through the Model Context Protocol.

Instead of switching between your editor and the Easypanel dashboard, you control everything from inside Claude: deploy from GitHub, update env vars, read logs, manage domains, create databases and monitor your server — all in natural language.

It covers the full Easypanel tRPC API with **37 tools**, including safety guards that require explicit confirmation before any destructive action, and a context banner in every response so Claude always knows which project and service it is touching.

---

## Prerequisites

- Easypanel instance running and accessible
- API token — generate at **Easypanel → Settings → API → Generate Token**
- Node.js ≥ 18 and Claude Code, Cursor or Claude Desktop

---

## Quick start

### Option A — npx (no install needed)

Add `.mcp.json` to your project root:

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

### Cursor — reuse env vars across projects

In **Cursor Settings → Tools & MCPs → Environment Variables**, set:
- `EASYPANEL_URL` = `https://your-panel.example.com`
- `EASYPANEL_TOKEN` = `your-api-token`

Then your `.cursor/mcp.json` uses references that apply automatically to every project:

```json
{
  "mcpServers": {
    "easypanel-mcp": {
      "command": "npx",
      "args": ["-y", "easypanel-mcp-server"],
      "env": {
        "EASYPANEL_URL": "${EASYPANEL_URL}",
        "EASYPANEL_TOKEN": "${EASYPANEL_TOKEN}"
      }
    }
  }
}
```

---

## Adding context to a project

Place this in your project's `CLAUDE.md` so Claude knows which Easypanel project and service it should operate on by default:

```markdown
## Easypanel
Project: `my-project` | Service: `my-api` | Branch: `main`
Repo: `owner/repo`
```

No folder copying needed — one MCP install serves all your projects.

---

## Use cases

> **"Deploy my app"** — Claude lists projects, inspects the current service, triggers `deploy_service`, then watches `list_actions` until it completes.

> **"Why is my service down?"** — Claude calls `get_service_error`, `get_service_logs` and `get_build_logs` in sequence to diagnose.

> **"Add DATABASE_URL to staging"** — Claude reads current env vars with `get_env_vars`, adds only the new key with `set_env_var` (never wipes others), and reminds you to redeploy.

> **"Create a Postgres database for this project"** — Claude calls `create_database`, then `inspect_database` to return the connection string ready to use.

---

## Available tools (37)

| Category | Tools |
|----------|-------|
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` ⚠️ |
| **Services** | `inspect_service`, `create_service`, `rename_service` ⚠️, `destroy_service` ⚠️, `deploy_service`, `start_service`, `stop_service` ⚠️, `restart_service`, `get_service_error`, `get_service_notes`, `set_service_notes` |
| **Deploy / GitHub** | `set_source_github`, `set_source_image`, `enable_github_deploy`, `disable_github_deploy`, `list_actions`, `get_action` |
| **Env Vars** | `get_env_vars`, `set_env_var`, `delete_env_var` ⚠️ |
| **Logs** | `get_service_logs`, `get_build_logs`, `get_system_stats` |
| **Domains** | `list_domains`, `add_domain`, `remove_domain` ⚠️, `set_primary_domain` |
| **Databases** | `create_database`, `inspect_database`, `destroy_database` ⚠️ |
| **Monitoring** | `get_docker_stats`, `get_storage_stats`, `get_service_stats` |

⚠️ = requires `confirm: "CONFIRMO"` to execute.

Full tool descriptions with parameters are in [`llms.txt`](llms.txt).

---

## Safety features

### Context banner
Every response that touches a specific project/service starts with:
```
[Contexto ativo: projeto="my-project" | serviço="my-api"]
```
Claude always knows what it is modifying before taking any action.

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
`set_env_var` and `delete_env_var` read the current state, apply only the requested change, and write back. The Easypanel API replaces the entire env string on every update — without this protection it is easy to accidentally wipe all variables at once.

### Sensitive value masking
`get_env_vars` masks values whose key matches `*SECRET*`, `*PASSWORD*`, `*TOKEN*`, `*KEY*` by default. Pass `include_values: true` to reveal.

---

## Companion skill `/ep`

Install the workflow skill for guided deploy operations in Claude Code:

```bash
mkdir -p ~/.claude/skills/ep
cp skill/SKILL.md ~/.claude/skills/ep/SKILL.md
```

Then use `/ep` for an interactive deploy workflow without needing to remember tool names.

---

## Known limitations

- **No container exec** — interactive console is not available via the Easypanel tRPC API (it uses WebSockets). Use `get_service_logs` and `get_service_error` for debugging.
- **Log streaming** — `get_service_logs` tries a REST endpoint; if unavailable, falls back to the last recorded service error.
- **Auth scope** — tools only work with app services (`services.app.*`). WordPress, Compose and Box service types are not covered.

---

## Testing without Claude

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

Opens a browser UI where you can call any tool manually and inspect the response.

---

## Comparison with similar packages

| Feature | easypanel-mcp-server | easypanel-mcp (sitp2k) |
|---------|---------------------|----------------------|
| Total tools | **37** | ~15 |
| Auth method | Bearer token | Email + password |
| Confirmation guard | ✅ | ❌ |
| Safe env update (read-modify-write) | ✅ | ❌ |
| Sensitive value masking | ✅ | ❌ |
| Deploy action tracking | ✅ | ❌ |
| Companion Claude skill | ✅ | ❌ |
| GitHub deploy control | ✅ | Partial |
| Known limitations documented | ✅ | ❌ |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add tools, report bugs and open PRs.

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)

---

## 👤 Author

Created by **[Helbert Paranhos](https://github.com/helbertparanhos)** from **[Strat Academy](https://stratacademy.com.br)**.

[![Instagram](https://img.shields.io/badge/@helbertparanhos-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/helbertparanhos)
[![YouTube](https://img.shields.io/badge/stratacademy-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@stratacademy)
[![LinkedIn](https://img.shields.io/badge/helbert--paranhos-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/helbert-paranhos/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/helbertparanhos)

If this project was useful, consider giving it a ⭐ and following [Strat Academy](https://stratacademy.com.br) for more AI automation content.

---

## 📄 License

MIT © [Helbert Paranhos](https://github.com/helbertparanhos) / [Strat Academy](https://stratacademy.com.br)

See [LICENSE](LICENSE) for details.
