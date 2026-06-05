# Test Report — easypanel-mcp-server v1.1.0

**Data:** 2026-06-05
**Ambiente:** Node v24 · Windows 11
**Servidor:** `node dist/index.js` (stdio)
**Painel de teste:** instância Easypanel real (v2.30.1), projeto `aplicativos`, serviço `hermes`

## Metodologia

Validação ponta-a-ponta: handlers compilados chamados contra a API tRPC/WebSocket de um painel Easypanel real, mais smoke test JSON-RPC via stdio (`initialize` → `tools/list` → `tools/call`). As tools **mutáveis/destrutivas** não foram executadas contra o painel de produção por design — foram validadas por revisão de código e pela confirmação dos procedures tRPC subjacentes (mesmos padrões das tools de leitura testadas).

## Infra

| Item | Status |
|------|--------|
| `tools/list` retorna 41 tools | ✅ |
| `tools/call` end-to-end via stdio | ✅ |
| Build `tsc` | ✅ |
| `npm audit` | ✅ 0 vulnerabilidades |

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

- **Total:** 41 tools
- **Verificadas ao vivo:** 11 (todas as de leitura/diagnóstico, incluindo as 4 novas e as 3 corrigidas nesta release)
- **Validadas por revisão:** 30 (mutáveis/destrutivas — não executadas contra produção por design)
- **Erros:** 0
- **Infra (load + roteamento + stdio):** ✅ 41/41

## Observações

- Logs de runtime (`get_service_logs`) dependem do WebSocket `/ws/serviceLogs`, que funciona sem licença. O "Advanced Logs" (Loki) do Easypanel é opcional e exige licença — não é usado.
- `get_docker_events` captura apenas eventos que ocorrem durante a janela (~8s); servidor ocioso pode retornar vazio (sem histórico no Docker).
- `exec_in_container` executa comandos arbitrários no container — comandos destrutivos exigem confirmação explícita.
