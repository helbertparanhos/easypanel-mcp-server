# Test Report — easypanel-mcp-server v3.0.0

**Data:** 2026-08-12
**Ambiente:** Node v26 · Windows 11
**Servidor:** `node dist/index.js` (stdio, compilado)
**Painel de teste:** instância Easypanel real **2.33.1**, projetos `aplicativos` / `ferramentas`

## Metodologia

Quatro camadas: (1) **suíte automatizada** sem rede; (2) **contrato de API** travado
contra um snapshot real do OpenAPI do painel; (3) **validação ponta-a-ponta** dos
handlers contra o painel 2.33.1; (4) **end-to-end no binário compilado**, falando MCP
por stdio como o Claude Code o executa.

Escritas destrutivas **não** foram executadas contra produção por design. A única
escrita realizada foi um **no-op verificado** (reescrever as notas de um serviço com o
valor que elas já tinham, conferindo antes e depois) — o suficiente para provar o
caminho `POST /api/<op>` com body JSON puro sem alterar estado.

Antes do release a branch passou por **revisão de código** (`/code-review high`), que
levantou 4 problemas — todos confirmados e corrigidos, com teste ou validação ao vivo
para cada um (ver seção 5).

## 1. Suíte automatizada (`npm test` — 51 testes, 0 falhas)

| Área | Cobertura |
|---|---|
| `context.ts` | guards de confirmação, validação de nomes, detecção de comando destrutivo, readonly |
| `services.ts` | roteamento por tipo de serviço (`extractServiceType`, 4 formas de resposta) |
| `env.ts` | parse/serialize/mascaramento de env vars, anti-injeção de newline |
| `raw.ts` | validação do nome da operação nas duas notações (achatada e com namespace) |
| `client.ts` | detecção de geração, `rpcPath`, `unwrapBody`, `safeServerMessage`, `kindMapFromSpec` (2.31 e 2.32) |
| `client.ts` (v3) | `publicIndexFromSpec`, `toQueryParams`, `errorMessageFromBody` |
| `procedures.ts` (v3) | tradução interno ↔ público, bijeção do mapa |

## 2. Contrato de API (`test/procedures.test.ts`)

Snapshot de **375 operações** de um painel 2.33.1 em
`test/fixtures/easypanel-2.33-ops.json`. Os testes verificam que:

- **as 61 procedures mapeadas existem** no spec do painel;
- as **20 leituras curadas são `GET`** e as **32 escritas curadas são `POST`** —
  classificação exata, sem heurística de nomes;
- os 5 tipos de banco têm `create`/`inspect`/`destroy` mapeados;
- nenhum nome público está duplicado (o reverso seria ambíguo).

Efeito prático: uma renomeação futura do Easypanel vira **falha de CI**, não 404 em
produção. Foi exatamente assim que o 2.33 quebrou o `trpc_raw` da v2 — o painel
reorganizou o spec e o cliente só descobriu ao vivo.

## 3. Validação ponta-a-ponta (painel 2.33.1 — 34 verificações, 0 falhas)

Rodado com `MCP_ACCESS_MODE=readonly` como cinto de segurança.

| Bloco | Verificações |
|---|---|
| Projetos / serviços | `list_projects`, `get_project`, `inspect_service` (app **e compose**), `get_service_error`, `get_exposed_ports`, `get_service_notes` |
| Env / rede / storage | `get_env_vars` (app, **compose**, **banco**), `list_domains`, `list_mounts`, `list_ports` |
| Monitoramento | `get_system_stats`, `get_docker_stats`, `get_storage_stats`, `get_service_stats` |
| Containers / ações | `list_containers`, `list_actions` (com e sem filtro), `get_build_logs` |
| Infra | `list_users`, `list_certificates`, `list_nodes`, `inspect_compose`, `inspect_database` |
| Escape hatch | nome achatado, nome com namespace, alias legado `trpc_raw` |
| Guards | escrita-como-leitura, leitura-como-escrita, readonly, escrita sem `CONFIRMO` |

**Correções da v3 confirmadas ao vivo:**

- `inspect_service` num serviço **compose** retorna a config (antes: 404, ia para `services.app.*`);
- `get_env_vars` num **compose** lista as vars; num **banco** devolve orientação em vez de erro;
- `get_service_stats` retorna `{cpu, memory, network}` (antes: contagem de réplicas);
- `list_actions` com `limit` numérico funciona pelo fallback ao transporte interno, com o motivo logado em stderr;
- os `zodErrors` aparecem no erro: `Easypanel API error 400 on [listVolumeBackups]: Input validation failed (projectName: Required; serviceName: Required)`.

**Escrita (no-op verificado):** `set_service_notes` gravou o mesmo valor de volta em
`aplicativos/demandas`; leitura antes e depois idênticas. Confirma
`POST /api/setServiceNotes` com body JSON puro.

## 4. End-to-end no compilado (stdio — 7 verificações, 0 falhas)

`node dist/index.js` com `initialize` → `tools/list` → `tools/call` reais:

- `serverInfo` = `easypanel-mcp v3.0.0`; **57 tools** anunciadas;
- `easypanel_raw` na lista, `trpc_raw` **fora** da lista mas ainda roteado;
- auto-detecção acertou o painel (`painel 2.33.1 — usando a API pública`) sem override;
- `readonly` bloqueou `delete_project` na origem.

## 5. Revisão de código (4 achados, 4 corrigidos)

| Achado | Verificação da correção |
|---|---|
| Leituras com param não-string inalcançáveis pelo `easypanel_raw` (métricas/logs) | 5 nomes internos confirmados ao vivo; `getMetricsSystemStats` e `getAllServicesStats` respondem 200 pelo transporte interno. Teste novo falha se qualquer leitura de param não-string ficar sem rota |
| Sonda transitória cacheava o flavor errado, prendendo o processo na API interna | Detecção agora separa resposta conclusiva de falha de rede/5xx; só cacheia a conclusiva |
| Nome achatado quebrava em painéis ≤ 2.32 | Tradução achatado → namespace aplicada nos transportes `trpc` e `rpc` |
| `null` de 200 sem corpo virava `TypeError` em env/database | Guardas `?.` em `readCurrentEnv` e `buildConnectionString` |

`queryServiceLogs` roteia corretamente mas o painel devolve `400 fetch failed` — o
Advanced Logs (Loki) não está configurado nessa instância. A chamada direta a
`/api/rpc/logs/queryServiceLogs` dá o mesmo erro, o que confirma que o roteamento
está certo e a limitação é do painel.

## Não coberto

- **Painéis ≤ 2.32 não foram re-validados ao vivo** nesta release. Os caminhos `trpc` e
  `rpc` foram preservados e seguem cobertos por testes unitários, mas o painel de teste
  disponível é 2.33.1.
- **Escritas destrutivas** (deploy, destroy, stop, prune, reboot) não são executadas
  contra produção. A migração dessas procedures é garantida pelo contrato de API da
  camada 2: nome e método conferidos contra o spec real do painel.
- **Compose `start`/`stop`/`restart`** (novos no 2.33) foram validados por contrato
  (existem no spec, são `POST`), não por execução.
