# Changelog

## [1.1.0] - 2026-06-05

### Added
- **`exec_in_container`**: executa comandos shell dentro do container de um serviço e retorna stdout/stderr (via WebSocket `/ws/containerShell`). Ideal para debug em runtime — inspecionar arquivos, env, conectividade, etc.
- **`list_containers`**: lista os containers Docker em execução de um serviço (ID, imagem, comando, status, portas) via `projects.getDockerContainers`.
- **`get_docker_events`**: captura eventos Docker do servidor em tempo real numa janela curta (start/stop/kill/die/exec/health) via WebSocket `/ws/dockerEvents`.
- **`get_exposed_ports`**: lista as portas publicadas no host de um serviço (`services.app.getExposedPorts`).
- Total de tools: 37 → **41**. Nova categoria "containers".
- Dependência `ws` para os canais WebSocket (logs de runtime, exec, eventos).

### Security
- WebSocket: erros de conexão nunca propagam a URL (que contém o token na query string, exigência do Easypanel) — mensagem genérica ao cliente e log só do `path` em stderr, espelhando o tratamento HTTP.
- `exec_in_container`: comandos potencialmente destrutivos (rm -rf, dd, mkfs, shutdown, kill, fork bomb, pipe para shell, etc.) agora exigem `confirm: "CONFIRMO"`; comandos de leitura seguem sem fricção.
- Validação de `projectName`/`serviceName` (regex `^[a-z0-9][a-z0-9_-]*$`) antes de montar o nome do serviço Docker e a query do WebSocket (defense-in-depth contra confusão de alvo/injeção de parâmetros).
- Dependência `ws` fixada na versão exata (`8.21.0`).

### Fixed
- `get_service_stats`: `monitorOld.getDockerTaskStats` retorna um objeto chaveado por serviço — a tool retornava as métricas de TODOS os serviços; agora indexa a chave exata `${projectName}_${serviceName}`.
- WebSocket: adicionado `handshakeTimeout` (falha rápida em host inacessível) e `get_service_logs` aciona o fallback corretamente quando o stream abre mas não traz dados.
- `list_actions`: o procedure `actions.listActions` exige input do tipo object — eliminado o erro `400`. Agora aceita filtros opcionais `projectName`/`serviceName`/`type`/`limit`, repassados ao servidor (a lista global guarda só uma janela curta).
- `get_build_logs`: corrigido o mesmo erro `400` e agora busca a deployment mais recente do serviço via filtro server-side (`type: "deployment", limit`) e retorna o log de build completo, lido do campo `log` de `actions.getAction`.
- `get_service_logs`: deixava de bater em `/api/logs/...` (rota inexistente que devolvia o HTML do SPA). Agora lê os logs de runtime do container pelo WebSocket `/ws/serviceLogs` — o mesmo canal da aba "Logs" da UI do Easypanel —, coletando o buffer recente e retornando as últimas N linhas. Funciona sem o Advanced Logs (Loki), que requer licença. Fallback para o último erro registrado caso o stream não abra.

## [1.0.1] - 2026-06-04

### Fixed
- Added `#!/usr/bin/env node` shebang to entry point for reliable `npx` execution

## [1.0.0] - 2026-06-04

### Added
- 37 MCP tools across 8 categories: projects, services, deploy, env vars, logs, domains, databases, monitoring
- Bearer token authentication (more secure than email/password)
- Context banner in every response — Claude always knows which project/service it is touching
- Confirmation guard: destructive actions require `confirm: "CONFIRMO"` to execute
- Safe env var update (read-modify-write — never wipes existing variables)
- GitHub auto-deploy toggle (`enable_github_deploy` / `disable_github_deploy`)
- Deploy action tracking (`list_actions`, `get_action`)
- Sensitive env var masking in `get_env_vars` responses
- Runtime allowlist validation for database type parameter
- URL component encoding to prevent path traversal
- Companion Claude skill `/ep` for guided deploy workflow
