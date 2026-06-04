import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

export const projectTools: Tool[] = [
  {
    name: "list_projects",
    description:
      "Lista todos os projetos do Easypanel com seus serviços e status. Use para descobrir o que existe no painel antes de operar.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_project",
    description:
      "Retorna detalhes completos de um projeto: lista de serviços, configurações e status atual.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome exato do projeto" },
      },
      required: ["projectName"],
    },
  },
  {
    name: "create_project",
    description: "Cria um novo projeto no Easypanel.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          description: "Nome do projeto — apenas letras minúsculas, números, hífens e underscores",
        },
      },
      required: ["projectName"],
    },
  },
  {
    name: "delete_project",
    description: `⚠️ DESTRUTIVO — Remove permanentemente o projeto e TODOS os seus serviços e dados. Irreversível. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome exato do projeto a deletar" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente a string "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "confirm"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleProjectTool(name: string, args: Args) {
  const client = getClient();

  if (name === "list_projects") {
    const result = await client.query("projects.listProjectsAndServices");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "get_project") {
    const { projectName } = args as { projectName: string };
    const ctx = contextHeader(projectName);
    const result = await client.query("projects.inspectProject", { projectName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "create_project") {
    const { projectName } = args as { projectName: string };
    const ctx = contextHeader(projectName);
    await client.mutate("projects.createProject", { name: projectName });
    return {
      content: [{ type: "text" as const, text: ok(ctx, { status: "criado", projectName }) }],
    };
  }

  if (name === "delete_project") {
    const { projectName, confirm } = args as { projectName: string; confirm: string };
    const ctx = contextHeader(projectName);
    const blocked = guardDestructive(
      confirm,
      "delete_project",
      `projeto "${projectName}" e TODOS os seus serviços`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("projects.destroyProject", { name: projectName });
    return {
      content: [{ type: "text" as const, text: ok(ctx, { status: "deletado", projectName }) }],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
