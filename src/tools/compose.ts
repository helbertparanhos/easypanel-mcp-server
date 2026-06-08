import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok, assertValidName } from "../context.js";

export const composeTools: Tool[] = [
  {
    name: "create_compose",
    description:
      "Cria um serviço do tipo Docker Compose em um projeto. Depois use set_compose_file (via trpc_raw) ou o painel para definir o docker-compose, e deploy_compose para subir.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço compose" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "inspect_compose",
    description:
      "Retorna a configuração de um serviço Docker Compose: arquivo compose, env, source e estado. Use antes de qualquer alteração.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço compose" },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "deploy_compose",
    description:
      "Dispara o deploy (docker compose up) de um serviço Compose com a configuração atual.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço compose" },
      },
      required: ["projectName", "serviceName"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleComposeTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  assertValidName(projectName, "projectName");
  assertValidName(serviceName, "serviceName");
  const ctx = contextHeader(projectName, serviceName);

  if (name === "create_compose") {
    const result = await client.mutate("services.compose.createService", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "compose_criado",
            projectName,
            serviceName,
            resultado: result,
            proximo_passo: "Defina o docker-compose e use deploy_compose",
          }),
        },
      ],
    };
  }

  if (name === "inspect_compose") {
    const result = await client.query("services.compose.inspectService", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "deploy_compose") {
    const result = await client.mutate("services.compose.deployService", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "deploy_iniciado",
            projectName,
            serviceName,
            resultado: result,
            dica: "Use list_actions para acompanhar o progresso.",
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
