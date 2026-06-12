# Changelog

## [1.3.1] - 2026-06-12

### Docs
- **Marca a linha v1.x como legada (Easypanel ≤ 2.30)**. O Easypanel **2.31** substituiu a API tRPC interna por uma camada RPC nova (`/api/rpc/*`, OpenAPI em `/api/openapi.json`): em painéis ≥ 2.31, qualquer chamada do v1.x **com parâmetros** falha com `400 Input validation failed` (o formato `GET ?input={"json":...}` deixou de ser aceito) e até as respostas de queries sem input mudaram de forma (`{"json":...}` no topo, sem o wrapper `result.data.json`).
- README ganhou a seção **Compatibility**: painéis ≤ 2.30 → `easypanel-mcp-server@legacy` (v1.3.x); painéis ≥ 2.31 → `@latest` (v2.x, com auto-detecção das duas gerações).
- Nenhuma mudança de código: release apenas de documentação/sinalização. A linha v1.3.x fica congelada como última versão validada contra Easypanel v2.30.1.

## [1.3.0] - 2026-06-08

### Fixed
- **Deploy/restart de serviços Compose** — `deploy_service`, `restart_service` e `start_service` agora detectam o tipo do serviço (via `projects.listProjectsAndServices`) e roteiam para o namespace correto. Antes, essas tools batiam sempre em `services.app.*` e retornavam 404/500 num serviço **compose** — o agente não conseguia redeployar uma stack compose e precisava cair no painel. Agora uma única chamada funciona para app **e** compose, sem o agente precisar saber o tipo de antemão.
  - Em compose, **restart/start = redeploy** (`services.compose.deployService`; `docker compose up` recria os containers).
  - **stop_service** em compose retorna orientação acionável (não há procedure tRPC de stop confirmada para compose) em vez de um 404 opaco.
  - Detecção é best-effort: se o tipo não for determinado, mantém o comportamento atual (`app`) — sem regressão.

### Changed
- Descrições de `deploy_service`/`restart_service`/`start_service` explicitam o suporte a compose — para o agente parar de desistir e cair no painel ao ver um serviço compose.

### Verificação ao vivo
- Forma de resposta de `projects.listProjectsAndServices` **confirmada** contra painel real (Easypanel v2.30.1): `{ projects: [...], services: [{ projectName, name, type, ... }] }` com `type` ∈ app/compose/postgres/mysql/mariadb/mongo/redis. A detecção de tipo casa exatamente (ex.: `aplicativos/strat-vexa → compose`).
- O roteamento usa apenas a procedure confirmada `services.compose.deployService`. Eventuais `services.compose.start/stop/restartService` permanecem não confirmados — por isso restart/start de compose vão por redeploy e stop devolve orientação acionável.

## [1.2.0] - 2026-06-08

### Added
- **Manutenção de servidor** — `prune_docker` (docker system prune global via `settings.systemPrune`) e `cleanup_docker_images` (remove imagens órfãs via `settings.cleanupDockerImages`).
- **Recursos do serviço** — `set_service_resources`: define limites/reservas de CPU e memória (`services.app.updateResources`). Aceita update parcial (lê os valores atuais via inspect e faz merge, já que a API exige o objeto `resources` completo).
- **Volumes** — `list_mounts` e `create_mount` (volume nomeado ou bind mount) via `mounts.*`.
- **Portas** — `list_ports` e `create_port` (port mapping host→container) via `ports.*`.
- **Docker Compose** — `create_compose`, `inspect_compose` e `deploy_compose` via `services.compose.*`.
- **Infraestrutura (leitura)** — `list_users`, `list_certificates`, `list_nodes`.
- **Operações de servidor** — `restart_panel` (`settings.restartEasypanel`) e `reboot_server` (`server.reboot`), ambos com `confirm: "CONFIRMO"`.
- **`trpc_raw`** — escape hatch que chama qualquer uma das ~347 procedures tRPC do Easypanel em 43 namespaces (traefik, branding, cloudflareTunnel, box, backups, wordpress, etc). Leitura por padrão; escrita exige `isMutation:true` + `CONFIRMO`.
- **Modo somente-leitura** — env `MCP_ACCESS_MODE=readonly` bloqueia TODA escrita (tools curadas e `trpc_raw`) na origem (`client.mutate`).
- **`EASYPANEL_RAW_DISABLED`** — env para desligar o `trpc_raw` por completo em ambientes expostos a conteúdo não confiável.
- **Documentação** — `docs/easypanel-api.md`: referência da API tRPC (arquitetura, 43 namespaces, procedures confirmadas mapeadas tool-a-tool, como descobrir novas procedures).
- Total de tools: 41 → **57**. Novas categorias: maintenance, mounts, ports, compose, server, raw.

### Security
- **`list_users` redação de secrets** — `users.listUsers` devolve `apiToken` (texto puro), `twoFactorSecret` (TOTP) e hash de senha; agora só `id`, `email`, `admin`, `twoFactorEnabled` e `createdAt` são retornados. Os campos sensíveis nunca chegam ao contexto do LLM.
- **`create_mount`** — bind mounts apontando para caminhos sensíveis do host (`/`, `/etc`, `/var/run/docker.sock`, etc.) exigem `CONFIRMO` (prevenção de escape de container).
- **`create_port`** — portas privilegiadas (`publishedPort < 1024`) exigem `CONFIRMO`.
- **`trpc_raw`** — nome da procedure validado por regex (`namespace.procedure`, sem `/`, `?`, `..`); `input` precisa ser objeto e tem teto de ~50KB; mutations exigem `CONFIRMO`.
- **Ações destrutivas globais** — `prune_docker`, `reboot_server` e `restart_panel` todas atrás de `CONFIRMO`.
- Validação `assertValidName` de `projectName`/`serviceName` estendida aos novos handlers (mounts, ports, compose).

### Fixed
- Schemas reais (validados em teste contra um Easypanel ao vivo) corrigidos: `mounts.createMount` e `ports.createPort` exigem os campos aninhados em `values` (porta usa `published`/`target`, não `publishedPort`/`targetPort`); `services.app.updateResources` exige o objeto `resources` com os 4 campos.

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
