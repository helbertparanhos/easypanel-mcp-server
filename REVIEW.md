# Relatório de Qualidade — easypanel-mcp-server v1.1.0

**Data:** 2026-06-05
**Escopo:** 13 arquivos em `src/`, 41 tools. Revisão por agentes `code-reviewer` + `security-reviewer`, com validação ao vivo contra um painel Easypanel real.

## Resumo Executivo

| Dimensão | Status | Findings | Resolução |
|----------|--------|----------|-----------|
| Segurança | ✅ | 0 críticos · 0 altos · 4 médios · 3 infos | 4 médios corrigidos; infos avaliadas |
| Qualidade | ✅ | 0 críticos · 0 altos · 2 médios · 4 baixos | 2 médios + 2 baixos corrigidos |
| Padrões MCP | ✅ | 0 | descrições/inputSchema/guards consistentes |
| Documentação | ✅ | 0 | README, llms.txt, CHANGELOG atualizados |

## Certificado

### 🏆 APROVADO PARA PRODUÇÃO
Zero findings críticos ou altos. Todos os médios acionáveis foram corrigidos e revalidados ao vivo.

## Correções aplicadas nesta revisão

**Segurança**
- **M2 — token não vaza em erros de WebSocket:** a URL do WS carrega o token na query string (exigência do Easypanel — confirmado que o endpoint rejeita header `Authorization` com 400). Erros agora propagam mensagem genérica (`Falha na conexão WebSocket em {path}`) e logam só o `path` em stderr. *Validado: token ausente do erro e do stderr.*
- **M3 — guard em `exec_in_container`:** comandos destrutivos (rm -rf, dd, mkfs, shutdown, kill, fork bomb, pipe→shell, etc.) exigem `confirm: "CONFIRMO"`; comandos de leitura seguem sem fricção. *Validado: bloqueia sem confirm, permite seguro, executa destrutivo com confirm.*
- **M4 — validação de nomes:** `projectName`/`serviceName` validados (`^[a-z0-9][a-z0-9_-]*$`) antes de montar o nome do serviço Docker e a query do WS. *Validado: rejeita `aplic/../x`.*
- **M1 — token na query do WS:** limitação do upstream (a própria UI do Easypanel faz assim); documentado em código e mitigado por M2.
- **I3 —** dependência `ws` fixada em `8.21.0`. `npm audit`: 0 vulnerabilidades.

**Qualidade**
- **`get_service_stats` (bug real):** `getDockerTaskStats` retorna objeto chaveado por serviço — a tool retornava as métricas de **todos**; agora indexa a chave exata. *Validado.*
- **WebSocket robustez:** `handshakeTimeout` (falha rápida em host inacessível) e `get_service_logs` aciona o fallback corretamente quando o stream abre sem dados (`failIfEmpty`).

## Pontos positivos (destacados pelos revisores)

- Tratamento de erro HTTP exemplar: corpo cru só em stderr, nunca no contexto do LLM.
- `collectWs` com guarda `done` contra dupla-resolução e limpeza de timers — sem race conditions nem vazamento de socket.
- Sem secrets hardcoded; token via env; mascaramento de sensíveis em `env.ts`; CSPRNG em `generateDomainId`; allowlist runtime de tipos de banco; `validateKeyValue` contra injeção de newline; guard de confirmação em todas as ações destrutivas.
- Padrões MCP sólidos: descrições acionáveis, `inputSchema` correto, clamps de limite consistentes.

## Recomendações futuras (não bloqueiam)

- **I1:** mascaramento de secrets em `env.ts` é por nome de chave (best-effort); considerar heurística por entropia do valor.
- **I2:** documentar que valores sensíveis passados como argumentos de tool ficam visíveis no histórico do client MCP.
- Tipar shapes mínimos das respostas tRPC para reduzir `any` (pragmático hoje, acessos já defensivos com `?.`).

## Validação executada

- Build `tsc` ✅ · `npm audit` 0 vulnerabilidades ✅
- Smoke test JSON-RPC stdio: initialize → tools/list (41) → tools/call ✅
- 6/6 checks de regressão de segurança/qualidade ao vivo ✅
