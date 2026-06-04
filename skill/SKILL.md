---
name: ep
description: >
  Workflow de deploy e gestão do Easypanel via MCP. Use sempre que o usuário pedir para
  fazer deploy, gerenciar projetos/serviços, configurar GitHub auto-deploy, checar logs,
  alterar env vars ou verificar status no Easypanel.
  Triggers: /ep, 'fazer deploy', 'deployar', 'redeployar', 'subir no easypanel',
  'checar logs do painel', 'alterar env do serviço', 'verificar serviços', 'criar projeto
  no painel', 'status do easypanel', 'restart no easypanel', 'parar serviço',
  'configurar github deploy', 'deploy via github', 'push e deploy'.
user-invocable: true
allowed-tools: mcp__easypanel-mcp__list_projects, mcp__easypanel-mcp__get_project,
  mcp__easypanel-mcp__inspect_service, mcp__easypanel-mcp__deploy_service,
  mcp__easypanel-mcp__set_source_github, mcp__easypanel-mcp__enable_github_deploy,
  mcp__easypanel-mcp__list_actions, mcp__easypanel-mcp__get_action,
  mcp__easypanel-mcp__get_env_vars, mcp__easypanel-mcp__set_env_var,
  mcp__easypanel-mcp__get_service_logs, mcp__easypanel-mcp__get_service_error,
  mcp__easypanel-mcp__get_system_stats
---

# Easypanel — Workflow de Deploy e Gestão

Assistente de operações no Easypanel. Usa o MCP `easypanel-mcp` para operar o painel diretamente.

**Regra crítica:** Antes de qualquer operação, identifique o projeto e serviço exatos.
Sempre confirme com o usuário antes de executar ações destrutivas.

---

## Fluxo 1 — Deploy via GitHub (uso principal)

Quando o usuário pedir "fazer deploy", "subir no Easypanel", "deployar do GitHub":

1. **Listar projetos** — `list_projects` para ver o que existe
2. **Confirmar alvo** — perguntar: "Qual projeto e serviço devo usar?" (se não informado)
3. **Inspecionar serviço** — `inspect_service` para ver a config atual
4. **Configurar source** (se necessário) — `set_source_github` com owner, repo, ref, path
5. **Ativar auto-deploy** (se o usuário quiser) — `enable_github_deploy`
6. **Fazer deploy** — `deploy_service`
7. **Acompanhar** — `list_actions` para ver o progresso. Se houver ação em andamento, `get_action` com o ID

**Mostre ao usuário ao final:**
```
✅ Deploy iniciado
   Projeto: [nome]
   Serviço: [nome]
   Source:  github.com/[owner]/[repo]@[branch]
   
Para acompanhar: list_actions
```

---

## Fluxo 2 — Verificar status e debugar

Quando o usuário pedir "o que está rodando?", "checar status", "ver logs":

1. `list_projects` — panorama geral
2. `inspect_service` — config completa do serviço específico
3. `get_service_error` — último erro registrado
4. `get_service_logs` — logs do container
5. `get_system_stats` — CPU/RAM/disco do servidor

---

## Fluxo 3 — Alterar variáveis de ambiente

Quando o usuário pedir "mudar env", "adicionar variável", "alterar config":

1. `get_env_vars` — mostrar as vars atuais (NUNCA mostre senhas ao usuário sem necessidade)
2. Confirmar a variável e valor com o usuário
3. `set_env_var` — aplicar a mudança (safe — não apaga outras vars)
4. Avisar: "Faça um deploy para aplicar a mudança em produção"

**Atenção:** Para remover vars, use `delete_env_var` que requer `confirm: "CONFIRMO"`.

---

## Regras de segurança (siga sempre)

- Nunca execute `destroy_service`, `delete_project`, `stop_service`, `remove_domain` ou `delete_env_var` sem o usuário ter passado explicitamente `confirm: "CONFIRMO"`
- Sempre mostre o **contexto ativo** (projeto + serviço) antes de qualquer operação
- Para operações destrutivas, descreva o que vai acontecer e peça confirmação em linguagem natural antes de chamar a tool
- O guard de confirmação é automático nas tools, mas você deve pedir confirmação ao usuário ANTES de chamar a tool

---

## Dicas de uso

- O context header `[Contexto ativo: projeto="X" | serviço="Y"]` aparece em todas as respostas — confirme que está no projeto/serviço certo
- `list_actions` após um deploy mostra se está em andamento, concluído ou falhou
- `get_service_error` é o primeiro lugar para olhar quando algo não funciona
