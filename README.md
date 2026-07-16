# easypanel-mcp-server

> MCP Server for full Easypanel control via Claude Code, Cursor and Claude Desktop.

[![npm version](https://img.shields.io/npm/v/easypanel-mcp-server.svg?style=flat-square)](https://www.npmjs.com/package/easypanel-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/helbertparanhos/easypanel-mcp-server?style=flat-square)](https://github.com/helbertparanhos/easypanel-mcp-server/issues)
[![Glama Quality](https://glama.ai/mcp/servers/helbertparanhos/easypanel-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/helbertparanhos/easypanel-mcp-server)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-000000?style=flat-square)](https://modelcontextprotocol.io/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-D97706?style=flat-square)](https://claude.ai/code)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-4F46E5?style=flat-square)](https://cursor.sh)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Compatible-D97706?style=flat-square)](https://claude.ai/download)

[![Instagram](https://img.shields.io/badge/@helbertparanhos-E4405F?style=flat-square&logo=instagram&logoColor=white)](https://www.instagram.com/helbertparanhos)
[![YouTube](https://img.shields.io/badge/stratacademy-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://www.youtube.com/@stratacademy)
[![LinkedIn](https://img.shields.io/badge/helbert--paranhos-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/helbert-paranhos/)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/helbertparanhos)
[![Strat Academy](https://img.shields.io/badge/Strat%20Academy-8B5CF6?style=flat-square)](https://stratacademy.com.br)

---

## What is this

**easypanel-mcp-server** connects Claude Code, Cursor and Claude Desktop directly to your [Easypanel](https://easypanel.io) instance — a modern Docker-based server control panel — through the Model Context Protocol.

Instead of switching between your editor and the Easypanel dashboard, you control everything from inside Claude: deploy from GitHub, update env vars, read live logs, exec into containers, manage domains, databases, volumes and ports, set resource limits, run Docker maintenance and monitor your server — all in natural language.

It maps the Easypanel API to **57 typed tools** across 15 categories, plus a single `trpc_raw` escape hatch that reaches **any** of Easypanel's ~350 procedures (40+ namespaces) for everything not covered by a dedicated tool. It speaks **both API generations** — the tRPC API of panels ≤ 2.30 and the new RPC layer introduced in Easypanel 2.31 — auto-detecting which one your panel uses. Every destructive action is gated behind an explicit confirmation, every response opens with a context banner so Claude always knows what it is touching, and an optional read-only mode lets you connect safely to a production panel.

📖 API reference: [`docs/easypanel-api.md`](docs/easypanel-api.md) — architecture, the 43 namespaces, confirmed procedures mapped tool-by-tool, and how to discover new ones.

---

## Compatibility

**Easypanel 2.31 replaced its internal tRPC API** with a new RPC layer (`/api/rpc/*`, OpenAPI at `/api/openapi.json`). On panels ≥ 2.31, every v1.x call that carries parameters fails with `400 Input validation failed`.

| Your Easypanel version | Use |
|---|---|
| **any** (recommended) | `easypanel-mcp-server@latest` (**v2.x**) — auto-detects the panel's API generation, works on both |
| **≤ 2.30.x** only, pinned | `easypanel-mcp-server@legacy` (**v1.3.x**) — frozen tRPC-only line, last validated against v2.30.1 |

v2.x detects the generation with a single probe request on first call (cached). To skip detection, set `EASYPANEL_API_FLAVOR=trpc` (≤ 2.30) or `EASYPANEL_API_FLAVOR=rpc` (≥ 2.31).

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

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EASYPANEL_URL` | ✅ | — | Panel URL, no trailing slash (e.g. `https://panel.example.com`) |
| `EASYPANEL_TOKEN` | ✅ | — | API token (Easypanel → Settings → API → Generate Token) |
| `MCP_ACCESS_MODE` | — | `full` | Set to `readonly` to block **all** writes (curated tools **and** `trpc_raw`). Reads stay available — ideal for connecting to a production panel for inspection only. |
| `EASYPANEL_API_FLAVOR` | — | _(auto)_ | Force the panel's API generation instead of auto-detecting: `trpc` (≤ 2.30) or `rpc` (≥ 2.31). Aliases: `legacy` / `modern`. |
| `EASYPANEL_RAW_DISABLED` | — | _(enabled)_ | Set to `1` to fully disable the `trpc_raw` escape hatch. Recommended when the MCP is exposed to untrusted content (prompt-injection risk), since `trpc_raw` reads can return secrets and are **not** covered by read-only mode. |

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

> **"Why is my service down?"** — Claude calls `get_service_error`, `get_service_logs` and `get_build_logs`, and can `exec_in_container` to inspect files/env live.

> **"Add DATABASE_URL to staging"** — Claude reads current env vars with `get_env_vars`, adds only the new key with `set_env_var` (never wipes others), and reminds you to redeploy.

> **"Give this service 512MB and half a core"** — Claude calls `set_service_resources` (reads current limits and merges your change) and reminds you to restart.

> **"Persist /app/data and expose port 5432"** — Claude calls `create_mount` (named volume) and `create_port`, both applied on the next deploy.

> **"My disk is full"** — Claude runs `get_storage_stats`, then `cleanup_docker_images` or `prune_docker` (with confirmation) to reclaim space.

> **"Show me the Traefik dashboard config"** — for anything without a dedicated tool, Claude uses `trpc_raw` to call the procedure directly.

---

## Available tools (57)

| Category | Tools |
|----------|-------|
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` ⚠️ |
| **Services** | `inspect_service`, `create_service`, `rename_service` ⚠️, `destroy_service` ⚠️, `deploy_service`, `start_service`, `stop_service` ⚠️, `restart_service`, `get_service_error`, `get_exposed_ports`, `get_service_notes`, `set_service_notes`, `set_service_resources` |
| **Deploy / GitHub** | `set_source_github`, `set_source_image`, `enable_github_deploy`, `disable_github_deploy`, `list_actions`, `get_action` |
| **Env Vars** | `get_env_vars`, `set_env_var`, `delete_env_var` ⚠️ |
| **Logs** | `get_service_logs`, `get_build_logs`, `get_system_stats` |
| **Containers** | `list_containers`, `exec_in_container` ⚠️, `get_docker_events` |
| **Domains** | `list_domains`, `add_domain`, `remove_domain` ⚠️, `set_primary_domain` |
| **Databases** | `create_database`, `inspect_database`, `destroy_database` ⚠️ |
| **Volumes / Mounts** | `list_mounts`, `create_mount` ⚠️ |
| **Ports** | `list_ports`, `create_port` ⚠️ |
| **Compose** | `create_compose`, `inspect_compose`, `deploy_compose` |
| **Monitoring** | `get_docker_stats`, `get_storage_stats`, `get_service_stats` |
| **Maintenance** | `prune_docker` ⚠️, `cleanup_docker_images` |
| **Server / Infra** | `list_users`, `list_certificates`, `list_nodes`, `restart_panel` ⚠️, `reboot_server` ⚠️ |
| **Raw access** | `trpc_raw` ⚠️ |

⚠️ = requires `confirm: "CONFIRMO"`. For `exec_in_container`, `create_mount`, `create_port` and `trpc_raw` the confirmation is **conditional** (only for destructive commands, sensitive host-path bind mounts, privileged ports `< 1024`, and write mutations respectively).

Full tool descriptions with parameters are in [`llms.txt`](llms.txt). For the underlying API (both generations), see [`docs/easypanel-api.md`](docs/easypanel-api.md).

### `trpc_raw` — reach any of the ~350 procedures

Covering every Easypanel procedure with a typed tool isn't practical, so anything without a dedicated tool is reachable directly:

```jsonc
// read (default)
{ "procedure": "certificates.listCertificates" }
{ "procedure": "traefik.getDashboard" }

// write — requires isMutation:true AND confirm:"CONFIRMO"
{ "procedure": "branding.updateSettings", "input": { /* ... */ },
  "isMutation": true, "confirm": "CONFIRMO" }
```

Useful namespaces only reachable via `trpc_raw`: `traefik.*`, `branding.*`, `cloudflareTunnel.*`, `box.*`, `middlewares.*`, `notifications.*`, `volumeBackups.*`, `databaseBackups.*`, `wordpress.*`, `git.*`, `update.*`.

Procedure names use dot notation on both API generations — the client translates to the right transport. On panels ≥ 2.31 the client also classifies the procedure against the panel's own OpenAPI spec, fail-closed: a `trpc_raw` read only executes if the procedure comes back as a query, so writes can't sneak past the `readonly` mode or the confirmation gate. On 2.31 that classification is the documented HTTP method; on 2.32+, where the spec is POST-only and no longer carries it, the client falls back to the panel's naming convention (`get`/`list`/`inspect`/`check`/`query`/`search` = read, anything else = write), restricted to procedures present in the spec.

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

This gates project/service deletion, stop/rename, env/domain removal, database destruction, the global server ops (`prune_docker`, `restart_panel`, `reboot_server`), and — conditionally — dangerous container commands, sensitive bind mounts, privileged ports and raw mutations.

### Read-only mode
Set `MCP_ACCESS_MODE=readonly` to block **every** write at the source (`client.mutate`), covering both curated tools and `trpc_raw`. Reads remain available — perfect for a production panel you only want to inspect.

### Raw escape-hatch controls
`trpc_raw` validates the procedure name (`namespace.procedure`, no path/query injection), requires the `input` to be an object (≤ 50KB), and demands `CONFIRMO` for any mutation. Set `EASYPANEL_RAW_DISABLED=1` to turn it off entirely.

### Secret redaction
`list_users` strips `apiToken`, `twoFactorSecret` and password fields before returning — only `id`, `email`, `admin`, `twoFactorEnabled` and `createdAt` reach the model.

### Safe env vars (read-modify-write)
`set_env_var` and `delete_env_var` read the current state, apply only the requested change, and write back. The Easypanel API replaces the entire env string on every update — without this protection it is easy to accidentally wipe all variables at once.

### Sensitive value masking
`get_env_vars` masks values whose key matches `*SECRET*`, `*PASSWORD*`, `*TOKEN*`, `*KEY*` by default. Pass `include_values: true` to reveal.

### Token never leaks
HTTP errors and WebSocket failures are logged to stderr and surfaced to the model as a generic message — the bearer token (sent in the WebSocket query string, as Easypanel requires) never reaches the model context.

### Input validation
`projectName` / `serviceName` are validated against `^[a-z0-9][a-z0-9_-]*$` before being used to build a Docker service name or WebSocket query (defense-in-depth against target confusion / parameter injection). Ports are validated as integers `1–65535`; resource values must be positive numbers.

---

## Companion skill `/ep`

Install the workflow skill for guided deploy operations in Claude Code:

```bash
mkdir -p ~/.claude/skills/ep
cp skill/SKILL.md ~/.claude/skills/ep/SKILL.md
```

Then use `/ep` for an interactive deploy workflow without needing to remember tool names.

---

## How it works

The Easypanel panel talks to its backend over **tRPC** (`/api/trpc/<router>.<procedure>`), not a public REST API. This server uses the same endpoints:

- **Reads** are tRPC queries; **writes** are tRPC mutations — see [`docs/easypanel-api.md`](docs/easypanel-api.md).
- **Live logs, container exec and Docker events** use the panel's WebSocket channels (`/ws/serviceLogs`, `/ws/containerShell`, `/ws/dockerEvents`) — the same ones the UI uses — so they work without the licensed Advanced Logs (Loki).
- A few input schemas (mounts, ports, resources) were **validated against a live Easypanel** and are documented in the API reference.

---

## Known limitations

- **WordPress / Box service types** — not exposed as dedicated tools; reach them via `trpc_raw` (e.g. `wordpress.inspectService`, `box.createService`).
- **`trpc_raw` reads bypass read-only mode** — read-only blocks writes only. A raw read can return sensitive data; use `EASYPANEL_RAW_DISABLED=1` in untrusted environments.
- **Cluster tools** — `list_nodes` returns the local node only on single-server setups (no Swarm cluster).
- **Docker events** are real-time only (no history) — an idle server may return an empty window.

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
| Curated tools | **57** | ~15 |
| Raw access to all ~347 procedures | ✅ (`trpc_raw`) | ❌ |
| Auth method | Bearer token | Email + password |
| Confirmation guard | ✅ | ❌ |
| Read-only mode | ✅ | ❌ |
| Container exec + live logs (WebSocket) | ✅ | ❌ |
| Volumes / ports / compose / resources | ✅ | ❌ |
| Server maintenance (prune / reboot) | ✅ | ❌ |
| Safe env update (read-modify-write) | ✅ | ❌ |
| Secret redaction & value masking | ✅ | ❌ |
| Companion Claude skill | ✅ | ❌ |
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
