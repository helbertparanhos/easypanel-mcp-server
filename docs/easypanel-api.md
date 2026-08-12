# Referência da API do Easypanel (tRPC ≤ 2.30 / RPC 2.31–2.32 / pública ≥ 2.33)

Documentação da API que este MCP consome. Esta referência existe para que
adicionar/auditar uma tool não dependa de engenharia reversa repetida.

> ⚠️ Até o 2.32 era uma API **interna e não versionada**. O **2.33 publicou uma API
> pública documentada** e passou a avisar que a interna "may change without notice
> and should not be relied upon" — por isso o MCP usa a pública quando ela existe.
> As operações confirmadas abaixo foram validadas em uso real.

---

## As três gerações da API

O **Easypanel 2.31** (jun/2026) substituiu o tRPC interno por uma camada RPC
(estilo [oRPC](https://orpc.dev)), mantendo nomes e inputs. O **2.33** (jul/2026)
publicou por cima disso uma **API pública achatada**, onde cada procedure vira um
path de um segmento e o método HTTP volta a separar leitura de escrita:

| | **≤ 2.30 (tRPC)** | **2.31–2.32 (RPC interno)** | **≥ 2.33 (pública)** |
|---|---|---|---|
| Base | `/api/trpc/<ns>.<proc>` | `/api/rpc/<ns>/<proc>` | **`/api/<operação>`** |
| Leitura | `GET ?input={"json":<params>}` | **`POST` body `{"json": <params>}`** ¹ | **`GET ?param=valor`** ² |
| Escrita | `POST` body `{"json": <params>}` | `POST` body `{"json": <params>}` | **`POST` body JSON puro** |
| Resposta (sucesso) | `{"result":{"data":{"json":<dado>}}}` | `{"json": <dado>}` | **`<dado>` cru, sem envelope** ³ |
| Resposta (erro) | `{"error":{"json":{"message":...}}}` | HTTP ≠ 200 + `{"json":{...,"message":...}}` | HTTP ≠ 200 + `{"code","status","message","data":{"zodErrors":{campo:msg}}}` |
| Nome da procedure | `services.app.inspectService` | `services.app.inspectService` | **`inspectAppService`** (achatado) |
| Documentação | nenhuma | OpenAPI em `/api/openapi.json` (paths `/api/rpc/*`) | OpenAPI em `/api/openapi.json` (**375 ops**, paths achatados) |
| WebSockets `/ws/*` | iguais | iguais | **iguais** (sem mudança) |

¹ O OpenAPI do 2.31 documenta queries como `GET` com query params, mas na prática
o GET com parâmetros responde `400 Input validation failed` — o caminho confiável
é `POST {"json": ...}` para **qualquer** procedure.

² ⚠️ A API pública valida query params com zod **sem coerção de tipo**: `?limit=5`
chega como `"5"` e é rejeitado com `Expected number, received string`. Não há
codificação que resolva (testado `limit=5` e `limit[]=5`). Atinge 5 das 103
leituras (`listActions`, `queryServiceLogs`, `queryComposeServiceLogs`,
`getMetricsServiceStats`, `getMetricsSystemStats`). Quando o input tem qualquer
valor não-string, o client cai no transporte `/api/rpc`, que leva JSON no body.

³ Procedures sem retorno respondem **200 com corpo vazio** (confirmado em
`listNodes`) — `JSON.parse("")` lançaria, então o client devolve `null`.

**Consequência de segurança:** no 2.31–2.32 o método HTTP deixou de separar leitura
de escrita (tudo é POST), e o [`client.ts`](../src/client.ts) precisava do OpenAPI
para classificar. **No 2.33 a separação volta a ser exata** (GET = leitura,
POST = escrita, declarado no spec), então o guard do `easypanel_raw` deixa de
depender de heurística de nomes nesses painéis. Nas duas direções: leitura chamada
como escrita e escrita chamada como leitura são recusadas. Para operações
**arbitrárias** o guard é **fail-closed**: spec indisponível ou operação fora do
spec → leitura recusada.

### Tradução de nomes

O mapa interno → público vive em [`src/procedures.ts`](../src/procedures.ts) e é
travado por teste contra um snapshot real do spec
(`test/fixtures/easypanel-2.33-ops.json`). A conversão **não é mecânica**:

| interno (≤ 2.32) | público (≥ 2.33) |
|---|---|
| `services.app.inspectService` | `inspectAppService` |
| `services.compose.deployService` | `deployComposeService` |
| `services.mongo.createService` | `createMongoDBService` |
| `services.common.rename` | `renameService` |
| `monitorOld.getSystemStats` | `getLegacyMonitorSystemStats` |
| `update.getStatus` | `getUpdateStatus` |

### Auto-detecção no client

O client detecta a geração com 1 request e cacheia o resultado. **A ordem importa**:
o 2.33 mantém `/api/trpc/*` e `/api/rpc/*` vivos, respondendo `{"json":...}` — sondar
as rotas antigas primeiro classificaria um painel 2.33 como `rpc`. Então:

1. `GET /api/getUpdateStatus` — só existe na API pública. Responde `{version}` sem
   envelope → **`public`** (e a versão do painel vai para o stderr).
2. `GET /api/trpc/update.getStatus` — corpo com `result`/`error` → **`trpc`**;
   corpo com `json` no topo → **`rpc`**.

Dá para forçar com `EASYPANEL_API_FLAVOR=trpc|rpc|public` (aliases: `legacy`|`modern`).

---

## Arquitetura (geração tRPC, ≤ 2.30)

- **Protocolo:** tRPC sobre HTTP (serialização superjson).
- **Base URL:** `${EASYPANEL_URL}/api/trpc/`
- **Auth:** header `Authorization: Bearer <EASYPANEL_TOKEN>`
  (Settings → API → Generate Token). Os endpoints WebSocket `/ws/*` são a exceção:
  exigem o token na query string `?token=...`. **A auth é igual nas três gerações.**
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

O [`client.ts`](../src/client.ts) desembrulha as **duas** formas de resposta
(`result.data.json` no legado, `json` no 2.31+) e trata os erros — nunca vaza o
corpo cru no contexto do LLM (loga em stderr).

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
> ✅ **Resolvido no 2.33:** `startComposeService`, `stopComposeService` e
> `restartComposeService` existem na API pública e o MCP passou a usá-los. Em
> painéis ≤ 2.32, onde não há procedure confirmada, `start`/`restart` seguem caindo
> em `services.compose.deployService` e `stop` devolve orientação.

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
| `monitorOld.getServiceStats` | Q | `get_service_stats` |
| `monitorOld.getDockerTaskStats` | Q | `get_docker_stats` (fallback de `get_service_stats`) |
| `monitorOld.getStorageStats` | Q | `get_storage_stats` |

> ⚠️ `getDockerTaskStats` devolve **estado das tasks** (`{actual, desired}` de
> réplicas), **não** CPU/memória. Até a v2 o `get_service_stats` lia dessa procedure
> apesar de prometer CPU/memória; agora usa `getServiceStats`, que retorna
> `{cpu, memory, network}`. O dado de réplicas segue como fallback para painéis
> antigos, rotulado pelo que é.
>
> Existe também o namespace mais novo `monitor.*` (métricas via Prometheus, sob a tag
> "Metrics" na API pública: `getMetricsSystemStats`, `getMetricsServiceStats`,
> `getAllServicesStats`). Este MCP usa `monitorOld.*` por não exigir a stack de
> métricas habilitada no painel.

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

## Acesso ao restante: `easypanel_raw`

Cobrir 375 operações com tools tipadas seria inviável. Tudo que **não** tem tool
dedicada é acessível pela tool [`easypanel_raw`](../src/tools/raw.ts), que chama
qualquer operação diretamente (nome achatado no 2.33+, ou a notação antiga, que é
traduzida):

```jsonc
// leitura (padrão)
{ "procedure": "certificates.listCertificates" }
{ "procedure": "traefik.getDashboard" }

// escrita — exige isMutation:true E confirm:"CONFIRMO"
{ "procedure": "branding.updateSettings", "input": { ... },
  "isMutation": true, "confirm": "CONFIRMO" }
```

Mutations via `easypanel_raw` pulam os guards das tools curadas, então a confirmação
explícita é a rede de segurança mínima. Em `MCP_ACCESS_MODE=readonly`, qualquer
mutation (curada ou raw) é bloqueada no client. Em painéis 2.31+ — onde todo o
transporte é POST — o client classifica a procedure contra o OpenAPI do painel de
forma **fail-closed**: leituras via `easypanel_raw` só executam se a procedure constar
como query (spec indisponível ou procedure desconhecida → recusada), então não dá
para executar escrita "disfarçada" de leitura.

De onde sai a classificação depende da geração do spec:

| Spec | Sinal de leitura/escrita |
|------|--------------------------|
| 2.31 | Método HTTP documentado: `GET` = query, só-`POST` = mutation |
| 2.32+ | **Não existe mais** (tudo é POST, sem `x-*`) → convenção de nomes: o verbo inicial da procedure (`get`/`list`/`inspect`/`check`/`query`/`search` = query; qualquer outro = mutation), restrita às procedures presentes no spec |

O fallback do 2.32+ é fail-closed por construção (verbo desconhecido → mutation) e
está coberto por teste contra as 19 leituras das tools curadas — ver
[`kindMapFromSpec`](../src/client.ts). É um sinal mais fraco que o do 2.31: se o
painel algum dia expuser uma escrita chamada `getX`, ela seria classificada como
leitura. Se um spec futuro voltar a marcar a natureza da procedure, prefira esse
sinal a este fallback.

> ⚠️ **Reads via `easypanel_raw` não são protegidos pelo readonly** e podem retornar
> dados sensíveis (ex.: `services.app.inspectService` devolve env vars com secrets de
> qualquer projeto). Em ambientes expostos a conteúdo não confiável (risco de prompt
> injection), defina **`EASYPANEL_RAW_DISABLED=1`** para desligar o escape hatch por
> completo. O input também é validado (precisa ser objeto) e o nome da procedure é
> restrito a `[a-zA-Z0-9.]` para evitar injeção de path/query.

Áreas acessíveis só por `easypanel_raw` (notação antiga; no 2.33+ use o nome
achatado do `openapi.json`): `traefik.*`, `branding.*`,
`cloudflareTunnel.*`, `box.*`, `middlewares.*`, `notifications.*`,
`volumeBackups.*`, `databaseBackups.*`, `wordpress.*`, `git.*`, `update.*`,
`twoFactor.*`, `setup.*`.

---

## Modo somente-leitura

Defina `MCP_ACCESS_MODE=readonly` para bloquear **toda** escrita (mutations),
deixando apenas leitura/diagnóstico. O bloqueio é feito em
[`EasyPanelClient.mutate`](../src/client.ts), cobrindo tools curadas e `easypanel_raw`
de uma vez. Default: `full`.

---

## Como descobrir novas procedures

1. **OpenAPI do painel (2.31+):** `GET /api/openapi.json` (com o Bearer token)
   devolve o spec completo — ~374 endpoints com schemas de input. É a fonte
   primária a partir do 2.31. No 2.31 o método separa a natureza (`GET` = query,
   só-`POST` = mutation); **no 2.32+ tudo virou POST**, o prefixo `/api/rpc` saiu
   dos paths para `servers[].url`, e o nome da procedure passou a viver no
   `operationId`.
2. **Inspecionar o tráfego do painel:** abra o DevTools (aba Network), execute a
   ação desejada na UI do Easypanel e observe a chamada para
   `/api/trpc/...` ou `/api/rpc/...` — o nome e o payload aparecem ali.
3. **Bundle do frontend:** os nomes das procedures estão no JS do painel; um
   `grep` por `.<namespace>.` no bundle revela as procedures de um router.
4. **Testar com `easypanel_raw`:** comece sempre com `isMutation:false` (leitura) para
   inspecionar o shape de retorno antes de tentar uma escrita.

Ao confirmar uma nova procedure, adicione-a à tabela acima e — se for de uso comum —
promova a uma tool curada (com validação e, se destrutiva, `CONFIRMO`).
