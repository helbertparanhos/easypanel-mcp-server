# Test Report — easypanel-mcp-server v1.3.0

**Data:** 2026-06-08
**Ambiente:** Node v24 · Windows 11
**Servidor:** `node dist/index.js` (stdio)
**Painel de teste:** instância Easypanel real (v2.30.1), projeto `aplicativos`

## Metodologia

Três camadas: (1) **suíte automatizada** de testes unitários das funções puras de
segurança e roteamento (`npm test`, sem rede); (2) **validação ponta-a-ponta** dos
handlers contra a API tRPC/WebSocket de um painel Easypanel real; (3) revisão de
código das mutações destrutivas (não executadas contra produção por design, exceto o
redeploy de compose abaixo, autorizado pelo usuário).

## Suíte automatizada (`npm test` — 23 testes, 0 falhas)

Testes unitários determinísticos (Node `node:test` via `tsx`), sem tocar a rede:

| Área | Cobertura |
|------|-----------|
| `assertValidName` | aceita nomes válidos; rejeita maiúsculas, espaços, `/`, `..`, `.`, `;`, não-ascii, não-string |
| `looksDestructiveCommand` | detecta rm -rf/dd/mkfs/shutdown/kill/fork bomb/pipe-para-shell; deixa passar leitura |
| `guardDestructive` | libera só com `CONFIRMO` exato; bloqueia variações |
| `isReadOnly` | reflete `MCP_ACCESS_MODE` (case-insensitive) |
| `extractServiceType` | roteamento app/compose/db nas 3 formas de resposta; null p/ tipo/projeto/dados inválidos |
| env vars | `parseEnvString`/`serializeEnvVars` roundtrip; escape de newline (anti-injeção); `maskSensitiveValues`; `validateKeyValue` |
| `isValidProcedureName` | aceita `namespace.procedure`; rejeita barra/query/traversal/sem-ponto/não-string |
| registry | 57 tools, nomes únicos, inputSchema object, tools destrutivas declaram `confirm`, dispatcher rejeita tool desconhecida |

## Infra

| Item | Status |
|------|--------|
| `tools/list` retorna 57 tools | ✅ |
| `tools/call` end-to-end via stdio | ✅ |
| Build `tsc` | ✅ |
| `npm test` (23 testes) | ✅ 0 falhas |
| `npm audit` | ✅ 0 vulnerabilidades |

## Roteamento Compose validado ao vivo (v1.3.0)

| Verificação | Status | Observações |
|------|--------|-------------|
| Forma de `listProjectsAndServices` | ✅ | `{ projects, services:[{projectName,name,type}] }`; `aplicativos/strat-vexa` = `compose` |
| `deploy_service` roteia compose → `services.compose.deployService` | ✅ | HTTP 200, action `status=done` |
| Stack `strat-vexa` saudável pós-deploy | ✅ | `vexa-api`/`vexa-dashboard`/`vexa-db` todos `running` (api e db `healthy`) |

## Tools verificadas ao vivo (executadas contra o painel real)

| Tool | Status | Observações |
|------|--------|-------------|
| `inspect_service` | ✅ OK | retorna config completa do serviço |
| `list_actions` | ✅ OK | filtros server-side (projectName/serviceName/type) |
| `get_build_logs` | ✅ OK | log de build completo via `actions.getAction` |
| `get_service_logs` | ✅ OK | logs de runtime via WebSocket `/ws/serviceLogs` |
| `get_service_error` | ✅ OK | exercido pelo fallback do `get_service_logs` |
| `list_containers` | ✅ OK | lista containers Docker do serviço |
| `exec_in_container` | ✅ OK | exec no container; guard de comando destrutivo validado (bloqueia sem `CONFIRMO`, permite leitura, executa destrutivo com confirm) |
| `get_docker_events` | ✅ OK | captura eventos Docker em tempo real |
| `get_exposed_ports` | ✅ OK | retorna portas publicadas (vazio p/ hermes) |
| `get_service_stats` | ✅ OK | indexa a chave correta (bug do "retorna todos" corrigido) |
| `get_docker_stats` | ✅ OK | métricas por container |

## Tools validadas por revisão (não executadas contra produção)

Operações que criam, alteram ou removem recursos — não executadas para não afetar o painel real. Procedures tRPC confirmados; guards de confirmação (`CONFIRMO`) presentes nas destrutivas.

| Categoria | Tools |
|-----------|-------|
| Projetos | `list_projects`, `get_project`, `create_project`, `delete_project` ⚠️ |
| Serviços | `create_service`, `rename_service` ⚠️, `destroy_service` ⚠️, `deploy_service`, `start_service`, `stop_service` ⚠️, `restart_service`, `get_service_notes`, `set_service_notes`, `get_action` |
| Deploy | `set_source_github`, `set_source_image`, `enable_github_deploy`, `disable_github_deploy` |
| Env vars | `get_env_vars`, `set_env_var`, `delete_env_var` ⚠️ |
| Domínios | `list_domains`, `add_domain`, `remove_domain` ⚠️, `set_primary_domain` |
| Bancos | `create_database`, `inspect_database`, `destroy_database` ⚠️ |
| Monitoramento | `get_system_stats`, `get_storage_stats` |

⚠️ = exige `confirm: "CONFIRMO"`

## Resumo

- **Total:** 57 tools + `trpc_raw`
- **Suíte automatizada:** ✅ 23/23 (funções puras de segurança e roteamento, sem rede)
- **Verificadas ao vivo:** tools de leitura/diagnóstico + roteamento compose (`deploy_service` → compose, redeploy real do `strat-vexa`)
- **Validadas por revisão:** mutáveis/destrutivas curadas (não executadas contra produção por design, exceto o redeploy autorizado)
- **Erros:** 0
- **Infra (load + roteamento + stdio):** ✅ 57/57

## Observações

- Logs de runtime (`get_service_logs`) dependem do WebSocket `/ws/serviceLogs`, que funciona sem licença. O "Advanced Logs" (Loki) do Easypanel é opcional e exige licença — não é usado.
- `get_docker_events` captura apenas eventos que ocorrem durante a janela (~8s); servidor ocioso pode retornar vazio (sem histórico no Docker).
- `exec_in_container` executa comandos arbitrários no container — comandos destrutivos exigem confirmação explícita.
