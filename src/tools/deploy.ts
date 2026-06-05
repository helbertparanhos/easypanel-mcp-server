import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok } from "../context.js";

export const deployTools: Tool[] = [
  {
    name: "set_source_github",
    description:
      "Configura a source do serviço para um repositório GitHub. O repo deve estar conectado no Easypanel (Settings > GitHub).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        owner: { type: "string", description: "Dono do repositório (usuário ou org no GitHub)" },
        repo: { type: "string", description: "Nome do repositório" },
        ref: { type: "string", description: "Branch ou tag (ex: main, master, v1.0.0)" },
        path: {
          type: "string",
          description: "Caminho dentro do repo onde está o app (use '/' para raiz)",
          default: "/",
        },
      },
      required: ["projectName", "serviceName", "owner", "repo", "ref"],
    },
  },
  {
    name: "set_source_image",
    description: "Configura a source do serviço para uma imagem Docker.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        image: {
          type: "string",
          description: "Imagem Docker (ex: nginx:latest, ghcr.io/user/app:tag)",
        },
        username: {
          type: "string",
          description: "Usuário do registry (para imagens privadas)",
        },
        password: {
          type: "string",
          description: "Senha do registry (para imagens privadas)",
        },
      },
      required: ["projectName", "serviceName", "image"],
    },
  },
  {
    name: "enable_github_deploy",
    description:
      "Ativa o auto-deploy via GitHub: a cada push no branch configurado, um deploy é disparado automaticamente.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "disable_github_deploy",
    description: "Desativa o auto-deploy via GitHub. Deploys precisarão ser disparados manualmente.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "list_actions",
    description:
      "Lista as ações/jobs em execução ou recentes (deploys, builds, restarts). A lista global guarda apenas uma janela curta — passe projectName/serviceName para filtrar no servidor e não perder ações de um serviço específico.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Filtrar por projeto (opcional)" },
        serviceName: { type: "string", description: "Filtrar por serviço (opcional)" },
        type: {
          type: "string",
          description: "Filtrar por tipo de ação, ex: deployment (opcional)",
        },
        limit: {
          type: "number",
          description: "Número máximo de ações a retornar (default: 50)",
          default: 50,
        },
      },
      required: [],
    },
  },
  {
    name: "get_action",
    description: "Retorna detalhes e logs de uma ação específica (deploy, build, etc).",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string", description: "ID da ação (obtido via list_actions)" },
      },
      required: ["actionId"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleDeployTool(name: string, args: Args) {
  const client = getClient();

  if (name === "set_source_github") {
    const { projectName, serviceName, owner, repo, ref, path = "/" } = args as {
      projectName: string;
      serviceName: string;
      owner: string;
      repo: string;
      ref: string;
      path?: string;
    };
    const ctx = contextHeader(projectName, serviceName);
    await client.mutate("services.app.updateSourceGithub", {
      projectName,
      serviceName,
      owner,
      repo,
      ref,
      path,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "source_configurada",
            tipo: "github",
            repo: `${owner}/${repo}`,
            branch: ref,
            path,
            proximo_passo: "Execute deploy_service para fazer o deploy, ou enable_github_deploy para auto-deploy",
          }),
        },
      ],
    };
  }

  if (name === "set_source_image") {
    const { projectName, serviceName, image, username, password } = args as {
      projectName: string;
      serviceName: string;
      image: string;
      username?: string;
      password?: string;
    };
    const ctx = contextHeader(projectName, serviceName);
    await client.mutate("services.app.updateSourceImage", {
      projectName,
      serviceName,
      image,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "source_configurada",
            tipo: "image",
            image,
            proximo_passo: "Execute deploy_service para fazer o deploy",
          }),
        },
      ],
    };
  }

  if (name === "enable_github_deploy") {
    const { projectName, serviceName } = args as { projectName: string; serviceName: string };
    const ctx = contextHeader(projectName, serviceName);
    await client.mutate("services.app.enableGithubDeploy", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "github_autodeploy_ativo",
            info: "Deploy automático disparado a cada push no branch configurado",
          }),
        },
      ],
    };
  }

  if (name === "disable_github_deploy") {
    const { projectName, serviceName } = args as { projectName: string; serviceName: string };
    const ctx = contextHeader(projectName, serviceName);
    await client.mutate("services.app.disableGithubDeploy", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "github_autodeploy_desativo",
            info: "Deploys precisarão ser disparados manualmente via deploy_service",
          }),
        },
      ],
    };
  }

  if (name === "list_actions") {
    // actions.listActions valida o input como object — passar campos (ainda que só
    // limit) evita o erro 400 "Expected object, received undefined" de antes.
    // projectName/serviceName/type filtram no servidor.
    const { projectName, serviceName, type, limit = 50 } = args as {
      projectName?: string;
      serviceName?: string;
      type?: string;
      limit?: number;
    };
    const input: Record<string, unknown> = { limit: Math.min(Number(limit) || 50, 200) };
    if (projectName) input.projectName = projectName;
    if (serviceName) input.serviceName = serviceName;
    if (type) input.type = type;
    const result = await client.query("actions.listActions", input);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "get_action") {
    const { actionId } = args as { actionId: string };
    const result = await client.query("actions.getAction", { id: actionId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
