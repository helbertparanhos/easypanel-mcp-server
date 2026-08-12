# Changelog

## [3.0.0] - 2026-08-12

Suporte ao **Easypanel 2.33**, que publicou uma **API pública documentada** e passou a avisar que a interna "may change without notice and should not be relied upon". O MCP migrou para ela.

### ⚠️ Breaking
- **`trpc_raw` virou `easypanel_raw`.** A API não é mais tRPC, e o escape hatch agora aceita o nome achatado da API pública (`listCertificates`) além da notação antiga (`certificates.listCertificates`). O nome `trpc_raw` **continua sendo roteado** (não aparece mais em `tools/list`, mas chamadas antigas seguem funcionando) — skills e prompts salvos não quebram.
- **`get_docker_stats` teve a descrição corrigida.** Ela sempre retornou contagem de réplicas (`{actual, desired}`), nunca CPU/memória como a descrição prometia. O comportamento não mudou; a descrição agora diz a verdade.
- Major bump pelo transporte novo e pela renomeação. Os **57 tools, seus nomes e parâmetros continuam idênticos**.

### Fixed
- **Easypanel 2.33 quebrou o `trpc_raw` (de novo).** O `/api/openapi.json` deixou de descrever `/api/rpc/*` e passou a descrever a API pública, com paths de um segmento só (`/getAction`) e `operationId` sem namespace. O `kindMapFromSpec` da v2 montava o mapa com chaves achatadas (`getaction`), então **todo lookup namespaced dava `undefined` e toda leitura via `trpc_raw` era recusada** (fail-closed) em painéis 2.33+. Confirmado ao vivo num 2.33.1 antes da correção.
- **`inspect_service` e `destroy_service` ignoravam o tipo do serviço** e sempre chamavam `services.app.*` — inspecionar ou destruir um serviço **compose** ou de **banco** resultava em 404 opaco. Agora resolvem o tipo e roteiam para o namespace certo.
- **`get_env_vars` / `set_env_var` / `delete_env_var` também eram fixos em `services.app.*`**, então o env de um serviço **compose** era inacessível. Agora roteiam por tipo; em bancos (que não têm env editável) devolvem orientação em vez de erro.
- **`get_service_stats` prometia CPU e memória mas devolvia contagem de réplicas.** Passou a usar `getServiceStats`, que retorna `{cpu, memory, network}` de verdade; painéis antigos sem essa procedure caem no dado de réplicas, agora rotulado pelo que é.
- **`stop_service` em compose deixou de ser "não suportado"** nos painéis 2.33+: `startComposeService`/`stopComposeService`/`restartComposeService` existem na API pública e agora são usados. Em painéis antigos o comportamento anterior é preservado.
- **Resposta 200 com corpo vazio deixou de virar erro.** Procedures que não retornam nada (confirmado em `listNodes`) faziam `JSON.parse("")` lançar "Resposta inválida".

### Added
- **Flavor `public` (Easypanel ≥ 2.33):** leitura via `GET /api/<op>?param=valor`, escrita via `POST /api/<op>` com body JSON puro, resposta **sem envelope**. A detecção sonda `GET /api/getUpdateStatus` **antes** das rotas antigas — o 2.33 mantém `/api/trpc/*` e `/api/rpc/*` vivos, e sondá-las primeiro classificaria o painel como `rpc`. A versão do painel vai para o stderr no boot.
- **Classificação leitura/escrita exata.** Na API pública o método HTTP volta a separar as duas coisas, então a heurística de nomes (`get`/`list`/... = leitura) **não é mais usada** em painéis 2.33+ — o guard de `easypanel_raw` passa a ser o que o painel declara. A heurística segue viva só para 2.31–2.32.
- **Guard no sentido inverso:** chamar uma **leitura** com `isMutation:true` agora é recusado com mensagem clara, em vez de virar um POST sem rota.
- **Erros acionáveis.** Os `zodErrors` por campo da API pública são propagados: `Easypanel API error 400 on [listVolumeBackups]: Input validation failed (projectName: Required; serviceName: Required)` em vez de só "Input validation failed".
- **`EASYPANEL_API_FLAVOR=public`** como override manual.
- **`test/fixtures/easypanel-2.33-ops.json`** — snapshot das 375 operações de um painel 2.33.1. Os testes conferem que **toda** procedure mapeada existe no spec e com o método esperado, transformando uma renomeação futura do Easypanel em falha de CI em vez de 404 em produção (34 → 50 testes).

### Notes
- **Parâmetro numérico em leitura cai no transporte interno, de propósito.** O painel 2.33 valida query params com zod **sem coerção**: `?limit=5` chega como `"5"` e é rejeitado com "Expected number, received string" — não há codificação que resolva (testado com `limit=5` e `limit[]=5`). Quando o input tem qualquer valor não-string, o client usa `/api/rpc` (que carrega JSON no body) e registra o motivo no stderr. Atinge 5 das 103 leituras do painel; entre as tools curadas, só `list_actions`/`get_build_logs` (`limit`).
- **Se você fixou `EASYPANEL_API_FLAVOR=rpc` por causa da v2**, remova a variável: com ela o MCP continua no transporte interno, que o Easypanel declarou instável.
- **O Easypanel 2.33 também ganhou um MCP nativo** (`/api/mcp`). Ele não cobre logs de runtime e exec em container via WebSocket, `MCP_ACCESS_MODE=readonly`, os gates `CONFIRMO` nem o mascaramento de secrets — veja a comparação no README.

## [2.0.1] - 2026-07-16

### Fixed
- **Easypanel 2.32 quebrou o parse do OpenAPI do painel.** O 2.32 reorganizou o spec: o prefixo `/api/rpc` saiu dos paths e foi para `servers[].url` (paths ficaram nus, `/projects/listProjects`), e o nome da procedure passou a viver no `operationId`. O `loadMethodMap` do v2.0.0 filtrava por `p.startsWith("/api/rpc/")` → **mapa vazio** → aviso em stderr e **toda leitura via `trpc_raw` recusada** (fail-closed) em painéis 2.32+. O parser agora lê o `operationId` (com o path + `servers` como reserva) e monta as 374 procedures do 2.32.2. Tools curadas não eram afetadas.
- **A classificação leitura/escrita sumiu do spec no 2.32** — os 374 endpoints são POST-only, sem `GET` e sem extensão `x-*`. A heurística `GET = query` do v2.0.0 classificaria **toda leitura como mutation**, e `query()` recusaria as 19 leituras das tools curadas. Quando o spec não tem nenhum `GET`, o client agora classifica pela convenção de nomes do painel (`get`/`list`/`inspect`/`check`/`query`/`search` = query; qualquer outro verbo = mutation), restrita às procedures presentes no spec. Specs 2.31 seguem usando o método HTTP, que é o sinal mais forte.

### Security
- O fallback do 2.32+ é **fail-closed por construção**: verbo desconhecido → `mutation` → leitura via `trpc_raw` recusada. `MCP_ACCESS_MODE=readonly` e o gate `CONFIRMO` seguem valendo. É um sinal mais fraco que o método HTTP do 2.31 — uma escrita nomeada `getX` seria classificada como leitura. Auditado contra as 374 procedures do 2.32.2 ao vivo: 102 query / 272 mutation, nenhuma escrita conhecida classificada como leitura.

### Notes
- **Se todas as chamadas falham com `405 Method Not Supported` num painel 2.31+**, verifique se `EASYPANEL_API_FLAVOR` está fixada em `trpc` no ambiente: o modo legado usa `GET /api/trpc/*`, que o painel novo recusa com 405. Remova a variável (a auto-detecção acerta) ou fixe em `rpc`.

### Internal
- `kindMapFromSpec` e `procKindFromName` exportadas e testadas (28 → 34 testes), incluindo um teste que trava as 19 leituras curadas contra regressão de classificação.

## [2.0.0] - 2026-06-12

### ⚠️ Breaking / Compatibilidade
- **Suporte ao Easypanel 2.31+**, que substituiu a API tRPC interna por uma camada RPC nova (estilo oRPC) — a mudança que fazia **toda chamada com parâmetros falhar com `400 Input validation failed`** no v1.x. O client agora fala as **duas gerações** e **auto-detecta** qual o painel usa (1 request `update.getStatus`, cacheado; forçável com `EASYPANEL_API_FLAVOR=trpc|rpc`).
- Major bump por mudança de transporte/parse no client. A superfície das tools (nomes, parâmetros, 57 tools) **não mudou** — para o agente, nada muda.
- Painéis ≤ 2.30 continuam suportados pelo v2.x (caminho legado preservado byte-a-byte e coberto por testes; não re-validado contra um painel ≤ 2.30 ao vivo). A linha v1.3.x permanece no npm sob a dist-tag `legacy`.

### Added
- **Modo RPC (Easypanel ≥ 2.31):** todas as chamadas vão por `POST {"json": input}` para `/api/rpc/<ns>/<proc>` (validado ao vivo contra Easypanel 2.31.0 — o `GET` com query params documentado no OpenAPI do painel responde 400 na prática); respostas `{"json": dado}` desembrulhadas; mensagens de erro estruturadas (`message`) agora aparecem no erro da tool (ex.: "Service not found." em vez de um 404 opaco).
- **`EASYPANEL_API_FLAVOR`** — override manual da geração da API (`trpc`/`legacy` ou `rpc`/`modern`); sem ela, auto-detecção.
- **Guard query-vs-mutation no modo RPC:** como no 2.31+ tudo é POST, o método HTTP deixou de separar leitura de escrita. O client baixa o **OpenAPI do próprio painel** (`/api/openapi.json`) e recusa procedures documentadas como mutation quando chamadas como leitura (ex.: `trpc_raw` com `isMutation:false`) — preserva o contrato do `MCP_ACCESS_MODE=readonly` e o gate de `CONFIRMO`, que no tRPC legado eram garantidos pelo próprio método HTTP.
- Funções puras exportadas e testadas: `flavorFromEnv`, `flavorFromBody`, `rpcPath`, `unwrapBody`, `safeServerMessage` (23 → 28 testes).

### Security
- **Leituras arbitrárias são fail-closed no modo RPC** (endurecido após security review): `trpc_raw` com `isMutation:false` só executa se o OpenAPI do painel classificar a procedure como query. Spec indisponível ou procedure fora do spec → chamada recusada com erro acionável (sem isso, uma falha no fetch do spec permitiria executar mutation "disfarçada" de leitura, contornando readonly e CONFIRMO). Tools curadas não são afetadas (procedures de leitura são literais verificados; para elas o guard é defense-in-depth).
- Lookup do guard **normalizado em minúsculas** nos dois lados — não contornável por variação de caixa (a regex do `trpc_raw` aceita A-Z).
- Fetch do OpenAPI **deduplicado em voo e sem cache de falha** — chamadas concorrentes durante o primeiro fetch não rodam sem guard, e uma falha transitória não desativa o guard pela sessão.
- Mensagens de erro estruturadas do servidor são **colapsadas e truncadas (300 chars)** antes de ir ao contexto do LLM (`safeServerMessage`) — mitiga injeção/inflação de contexto por um painel comprometido. O corpo cru continua indo só para stderr; o token nunca aparece em log ou erro.

### Docs
- `docs/easypanel-api.md` reescrita com a seção **"As duas gerações da API"** (tabela tRPC vs RPC, formas de resposta, OpenAPI, auto-detecção) e descoberta de procedures via `/api/openapi.json`.
- README: seção Compatibility (qual versão usar), `EASYPANEL_API_FLAVOR` na tabela de env vars.

### Verificação ao vivo (Easypanel 2.31.0)
- Query com input (`projects.inspectProject`), query sem input, mutation real (`services.common.setNotes`, gravada e restaurada), guard de mutation-como-leitura (`projects.createProject` via query → recusado) e kill-switch readonly — todos validados contra painel real.
- WebSockets `/ws/serviceLogs`, `/ws/containerShell`, `/ws/dockerEvents` **não mudaram** no 2.31 (logs validados ao vivo).

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
