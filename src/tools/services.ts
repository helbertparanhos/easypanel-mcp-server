import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

export const serviceTools: Tool[] = [
  {
    name: "inspect_service",
    description:
      "Retorna configuração completa de um serviço: source, env vars, deploy config, mounts, ports, domínios, recursos. Use SEMPRE antes de qualquer update para preservar o estado.",
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
    name: "create_service",
    description:
      "Cria um novo serviço de app em um projeto. Após criar, configure a source com set_source_github ou set_source_image.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: {
          type: "string",
          description: "Nome do serviço — apenas letras minúsculas, números, hífens e underscores",
        },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "rename_service",
    description: `⚠️ Renomeia ou move um serviço. Webhooks, DNS e referências internas que usam o nome antigo deixarão de funcionar. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Projeto atual do serviço" },
        serviceName: { type: "string", description: "Nome atual do serviço" },
        newProjectName: { type: "string", description: "Novo projeto (pode ser o mesmo)" },
        newServiceName: { type: "string", description: "Novo nome do serviço" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "newProjectName", "newServiceName", "confirm"],
    },
  },
  {
    name: "destroy_service",
    description: `⚠️ DESTRUTIVO — Remove permanentemente o serviço e seus dados. Irreversível. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço a destruir" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "confirm"],
    },
  },
  {
    name: "deploy_service",
    description:
      "Dispara o deploy do serviço com a configuração atual. Usa o source configurado (GitHub, image, dockerfile).",
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
    name: "start_service",
    description: "Inicia um serviço que está parado.",
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
    name: "stop_service",
    description: `⚠️ PARA o serviço em produção. Usuários não conseguirão acessar enquanto parado. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "confirm"],
    },
  },
  {
    name: "restart_service",
    description: "Reinicia o serviço. Causa breve indisponibilidade.",
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
    name: "get_service_error",
    description:
      "Retorna o último erro registrado do serviço. Use para debugar falhas de deploy ou runtime.",
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
    name: "get_exposed_ports",
    description:
      "Lista as portas expostas (publicadas no host) de um serviço. Use para descobrir em quais portas o serviço está acessível externamente.",
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
    name: "get_service_notes",
    description: "Lê as notas/anotações salvas no serviço.",
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
    name: "set_service_notes",
    description: "Salva notas/anotações no serviço (markdown suportado).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        notes: { type: "string", description: "Conteúdo das notas (markdown)" },
      },
      required: ["projectName", "serviceName", "notes"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleServiceTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  const ctx = contextHeader(projectName, serviceName);

  if (name === "inspect_service") {
    const result = await client.query("services.app.inspectService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "create_service") {
    await client.mutate("services.app.createService", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "criado",
            projectName,
            serviceName,
            proximo_passo: "Configure a source com set_source_github ou set_source_image",
          }),
        },
      ],
    };
  }

  if (name === "rename_service") {
    const { newProjectName, newServiceName, confirm } = args as {
      newProjectName: string;
      newServiceName: string;
      confirm: string;
    };
    const blocked = guardDestructive(
      confirm,
      "rename_service",
      `serviço "${serviceName}" → "${newProjectName}/${newServiceName}" (webhooks e referências ao nome antigo irão quebrar)`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("services.common.rename", {
      oldProjectName: projectName,
      oldServiceName: serviceName,
      newProjectName,
      newServiceName,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "renomeado",
            de: `${projectName}/${serviceName}`,
            para: `${newProjectName}/${newServiceName}`,
          }),
        },
      ],
    };
  }

  if (name === "destroy_service") {
    const { confirm } = args as { confirm: string };
    const blocked = guardDestructive(
      confirm,
      "destroy_service",
      `serviço "${serviceName}" no projeto "${projectName}"`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("services.app.destroyService", { projectName, serviceName });
    return {
      content: [{ type: "text" as const, text: ok(ctx, { status: "destruido", projectName, serviceName }) }],
    };
  }

  if (name === "deploy_service") {
    const result = await client.mutate("services.app.deployService", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "deploy_iniciado",
            projectName,
            serviceName,
            resultado: result,
            dica: "Use list_actions para acompanhar o progresso do deploy",
          }),
        },
      ],
    };
  }

  if (name === "start_service") {
    await client.mutate("services.app.startService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "iniciado", projectName, serviceName }) }] };
  }

  if (name === "stop_service") {
    const { confirm } = args as { confirm: string };
    const blocked = guardDestructive(
      confirm,
      "stop_service",
      `serviço "${serviceName}" (usuários perderão acesso)`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("services.app.stopService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "parado", projectName, serviceName }) }] };
  }

  if (name === "restart_service") {
    await client.mutate("services.app.restartService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "reiniciado", projectName, serviceName }) }] };
  }

  if (name === "get_service_error") {
    const result = await client.query("services.common.getServiceError", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "get_exposed_ports") {
    const result = await client.query("services.app.getExposedPorts", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "get_service_notes") {
    const result = await client.query("services.common.getNotes", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "set_service_notes") {
    const { notes } = args as { notes: string };
    await client.mutate("services.common.setNotes", { projectName, serviceName, notes });
    return { content: [{ type: "text" as const, text: ok(ctx, { status: "notas_salvas", projectName, serviceName }) }] };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
