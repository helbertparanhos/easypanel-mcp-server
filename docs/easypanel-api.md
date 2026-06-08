# Referência da API tRPC do Easypanel

Documentação da API interna que este MCP consome. O Easypanel não publica uma API
REST oficial — o painel conversa com o backend via **tRPC sobre HTTP**, e este MCP
usa os mesmos endpoints. Esta referência existe para que adicionar/auditar uma tool
não dependa de engenharia reversa repetida.

> ⚠️ É uma API **interna e não versionada**. Procedures podem mudar entre versões do
> Easypanel. As confirmadas abaixo foram validadas em uso real; o resto deve ser tratado
> como "provável" e verificado antes de depender em produção.

---

## Arquitetura

- **Protocolo:** tRPC sobre HTTP (serialização superjson).
- **Base URL:** `${EASYPANEL_URL}/api/trpc/`
- **Auth:** header `Authorization: Bearer <EASYPANEL_TOKEN>`
  (Settings → API → Generate Token). Os endpoints WebSocket `/ws/*` são a exceção:
  exigem o token na query string `?token=...`.
- **Queries (leitura):** `GET /api/trpc/<router>.<procedure>?input=<json-url-encoded>`
- **Mutations (escrita):** `POST /api/trpc/<router>.<procedure>` com corpo `{"json": {...}}`

### Formato de input

Tanto query quanto mutation embrulham os parâmetros em `{ "json": <params> }`:

```
GET  /api/trpc/projects.inspectProject?input=%7B%22json%22%3A%7B%22projectName%22%3A%22meu-app%22%7D%7D
POST /api/trpc/services.app.deployService     body: {"json":{"projectName":"meu-app","serviceName":"web"}}
```

### Formato de resposta

```jsonc
// sucesso
{ "result": { "data": { "json": <dado_real>, "meta": { ... } } } }
// erro
{ "error": { "json": { "message": "...", "code": -32001,
  "data": { "code": "UNAUTHORIZED", "httpStatus": 401, "path": "...", "zodErrors": null } } } }
```

O [`client.ts`](../src/client.ts) já desembrulha `result.data.json` e trata os erros —
nunca vaza o corpo cru no contexto do LLM (loga em stderr).

---

## Namespaces (routers)

O Easypanel expõe ~**347 procedures** em **43 namespaces**. Os nomes dos namespaces
(estáveis o suficiente para servir de mapa) são:

```
actions          app              auth             box
branding         certificates     cloudflareTunnel cluster
common           compose          databaseBackups  dockerBuilders
domains          dropbox          ftp              git
google           lemonLicense     local            mariadb
middlewares      mongo            monitor          monitorOld
mounts           mysql            notifications    portalLicense
ports            postgres         projects         redis
server           settings         setup            sftp
templates        traefik          twoFactor        update
users            volumeBackups    wordpress
```

> A lista completa das 347 procedures não é publicada pelo Easypanel. Para descobrir
> uma procedure específica, veja [Como descobrir novas procedures](#como-descobrir-novas-procedures).

---

## Procedures confirmadas (mapeadas para tools)

`Q` = query (leitura) · `M` = mutation (escrita)

### projects
| Procedure | Tipo | Tool |
|---|---|---|
| `projects.listProjectsAndServices` | Q | `list_projects` |
| `projects.inspectProject` | Q | `get_project` |
| `projects.createProject` | M | `create_project` |
| `projects.destroyProject` | M | `delete_project` |
| `projects.getDockerContainers` | Q | `list_containers`, `exec_in_container` |

### services.app
| Procedure | Tipo | Tool |
|---|---|---|
| `services.app.inspectService` | Q | `inspect_service`, `get_env_vars` |
| `services.app.createService` | M | `create_service` |
| `services.app.deployService` | M | `deploy_service` |
| `services.app.startService` | M | `start_service` |
| `services.app.stopService` | M | `stop_service` |
| `services.app.restartService` | M | `restart_service` |
| `services.app.destroyService` | M | `destroy_service` |
| `services.app.updateSourceGithub` | M | `set_source_github` |
| `services.app.updateSourceImage` | M | `set_source_image` |
| `services.app.updateEnv` | M | `set_env_var`, `delete_env_var` |
| `services.app.updateResources` | M | `set_service_resources` |
| `services.app.enableGithubDeploy` | M | `enable_github_deploy` |
| `services.app.disableGithubDeploy` | M | `disable_github_deploy` |
| `services.app.getExposedPorts` | Q | `get_exposed_ports` |

### services.common
| Procedure | Tipo | Tool |
|---|---|---|
| `services.common.getServiceError` | Q | `get_service_error` |
| `services.common.rename` | M | `rename_service` |
| `services.common.getNotes` | Q | `get_service_notes` |
| `services.common.setNotes` | M | `set_service_notes` |

### services.compose
| Procedure | Tipo | Tool |
|---|---|---|
| `services.compose.createService` | M | `create_compose` |
| `services.compose.inspectService` | Q | `inspect_compose` |
| `services.compose.deployService` | M | `deploy_compose`, `deploy_service`/`restart_service`/`start_service` (auto-roteado p/ compose) |

> **Roteamento por tipo de serviço.** As tools genéricas de ciclo de vida
> (`deploy_service`, `restart_service`, `start_service`, `stop_service`) detectam o
> tipo do serviço via `projects.listProjectsAndServices` e roteiam para o namespace
> correto. Chamar `services.app.deployService` num serviço compose retorna 404/500 —
> o roteamento evita isso. Em compose, **restart/start = redeploy** (`compose up`
> recria os containers). **Stop de compose não tem procedure confirmada** — a tool
> retorna orientação acionável em vez de disparar mutation no escuro.
>
> **Forma de resposta confirmada ao vivo** (v2.30.1):
> `{ projects: [{ name, createdAt }], services: [{ projectName, name, type, ... }] }`,
> com `type` ∈ `app | compose | postgres | mysql | mariadb | mongo | redis`.
> ⚠️ Ainda não confirmados: eventuais `services.compose.start/stop/restartService`
> (o MCP usa só `services.compose.deployService`, que é confirmada).

### databases (postgres / mysql / mariadb / mongo / redis)
| Procedure | Tipo | Tool |
|---|---|---|
| `services.<engine>.createService` | M | `create_database` |
| `services.<engine>.inspectService` | Q | `inspect_database` |
| `services.<engine>.destroyService` | M | `destroy_database` |

### domains
| Procedure | Tipo | Tool |
|---|---|---|
| `domains.listDomains` / `createDomain` / `deleteDomain` | Q/M | `list_domains`, `add_domain`, `remove_domain`, `set_primary_domain` |

### mounts / ports
| Procedure | Tipo | Tool |
|---|---|---|
| `mounts.listMounts` | Q | `list_mounts` |
| `mounts.createMount` | M | `create_mount` |
| `ports.listPorts` | Q | `list_ports` |
| `ports.createPort` | M | `create_port` |

> **Schemas validados em teste real** (não óbvios pela engenharia reversa):
> - `mounts.createMount` → `{ projectName, serviceName, values: { type, mountPath, name?, hostPath? } }`
> - `ports.createPort` → `{ projectName, serviceName, values: { published, target, protocol } }` (campos `published`/`target`, **não** `publishedPort`/`targetPort`)
> - `services.app.updateResources` → `{ projectName, serviceName, resources: { memoryReservation, memoryLimit, cpuReservation, cpuLimit } }` — os **4 campos são obrigatórios**; um update parcial é rejeitado (a tool `set_service_resources` faz merge com os valores atuais para contornar isso).

### actions (logs de deploy)
| Procedure | Tipo | Tool |
|---|---|---|
| `actions.listActions` | Q | `list_actions` |
| `actions.getAction` | Q | `get_action`, `get_build_logs` |

### monitor / monitorOld
| Procedure | Tipo | Tool |
|---|---|---|
| `monitorOld.getSystemStats` | Q | `get_system_stats` |
| `monitorOld.getDockerTaskStats` | Q | `get_docker_stats`, `get_service_stats` |
| `monitorOld.getStorageStats` | Q | `get_storage_stats` |

> Existe também o namespace mais novo `monitor.*` (ex.: `monitor.getSystemStats`,
> `monitor.getServiceStats`). Este MCP usa `monitorOld.*` por estabilidade; vale avaliar
> migrar se o `monitor.*` entregar dados melhores.

### settings / server / users / certificates / cluster
| Procedure | Tipo | Tool |
|---|---|---|
| `settings.systemPrune` | M | `prune_docker` |
| `settings.cleanupDockerImages` | M | `cleanup_docker_images` |
| `settings.restartEasypanel` | M | `restart_panel` |
| `server.reboot` | M | `reboot_server` |
| `users.listUsers` | Q | `list_users` |
| `certificates.listCertificates` | Q | `list_certificates` |
| `cluster.listNodes` | Q | `list_nodes` |

### Endpoints WebSocket (`/ws/*`)
| Endpoint | Uso | Tool |
|---|---|---|
| `/ws/serviceLogs` | logs de runtime | `get_service_logs` |
| `/ws/containerShell` | exec no container | `exec_in_container` |
| `/ws/dockerEvents` | eventos Docker em tempo real | `get_docker_events` |

---

## Acesso ao restante: `trpc_raw`

Cobrir 347 procedures com tools tipadas seria inviável. Tudo que **não** tem tool
dedicada é acessível pela tool [`trpc_raw`](../src/tools/raw.ts), que chama qualquer
procedure diretamente:

```jsonc
// leitura (padrão)
{ "procedure": "certificates.listCertificates" }
{ "procedure": "traefik.getDashboard" }

// escrita — exige isMutation:true E confirm:"CONFIRMO"
{ "procedure": "branding.updateSettings", "input": { ... },
  "isMutation": true, "confirm": "CONFIRMO" }
```

Mutations via `trpc_raw` pulam os guards das tools curadas, então a confirmação
explícita é a rede de segurança mínima. Em `MCP_ACCESS_MODE=readonly`, qualquer
mutation (curada ou raw) é bloqueada no client.

> ⚠️ **Reads via `trpc_raw` não são protegidos pelo readonly** e podem retornar
> dados sensíveis (ex.: `services.app.inspectService` devolve env vars com secrets de
> qualquer projeto). Em ambientes expostos a conteúdo não confiável (risco de prompt
> injection), defina **`EASYPANEL_RAW_DISABLED=1`** para desligar o escape hatch por
> completo. O input também é validado (precisa ser objeto) e o nome da procedure é
> restrito a `[a-zA-Z0-9.]` para evitar injeção de path/query.

Namespaces úteis acessíveis só por `trpc_raw`: `traefik.*`, `branding.*`,
`cloudflareTunnel.*`, `box.*`, `middlewares.*`, `notifications.*`,
`volumeBackups.*`, `databaseBackups.*`, `wordpress.*`, `git.*`, `update.*`,
`twoFactor.*`, `setup.*`.

---

## Modo somente-leitura

Defina `MCP_ACCESS_MODE=readonly` para bloquear **toda** escrita (mutations),
deixando apenas leitura/diagnóstico. O bloqueio é feito em
[`EasyPanelClient.mutate`](../src/client.ts), cobrindo tools curadas e `trpc_raw`
de uma vez. Default: `full`.

---

## Como descobrir novas procedures

1. **Inspecionar o tráfego do painel:** abra o DevTools (aba Network), execute a
   ação desejada na UI do Easypanel e observe a chamada `POST`/`GET` para
   `/api/trpc/<router>.<procedure>` — o nome e o payload aparecem ali.
2. **Bundle do frontend:** os nomes das procedures estão no JS do painel; um
   `grep` por `.<namespace>.` no bundle revela as procedures de um router.
3. **Testar com `trpc_raw`:** comece sempre com `isMutation:false` (leitura) para
   inspecionar o shape de retorno antes de tentar uma escrita.

Ao confirmar uma nova procedure, adicione-a à tabela acima e — se for de uso comum —
promova a uma tool curada (com validação e, se destrutiva, `CONFIRMO`).
