import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

const DB_TYPES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
type DbType = (typeof DB_TYPES)[number];

export const databaseTools: Tool[] = [
  {
    name: "create_database",
    description:
      "Cria um serviço de banco de dados (Postgres, MySQL, MariaDB, MongoDB ou Redis) em um projeto.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome para o serviço de banco (ex: postgres, db-prod)" },
        type: {
          type: "string",
          enum: ["postgres", "mysql", "mariadb", "mongo", "redis"],
          description: "Tipo do banco de dados",
        },
        password: {
          type: "string",
          description: "Senha do banco (gerada automaticamente se não informada)",
        },
      },
      required: ["projectName", "serviceName", "type"],
    },
  },
  {
    name: "inspect_database",
    description:
      "Retorna detalhes do banco de dados: credenciais, porta exposta, connection string e status.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço de banco" },
        type: {
          type: "string",
          enum: ["postgres", "mysql", "mariadb", "mongo", "redis"],
          description: "Tipo do banco de dados",
        },
      },
      required: ["projectName", "serviceName", "type"],
    },
  },
  {
    name: "destroy_database",
    description: `⚠️ DESTRUTIVO — Remove o banco de dados e TODOS os seus dados permanentemente. Irreversível. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço de banco" },
        type: {
          type: "string",
          enum: ["postgres", "mysql", "mariadb", "mongo", "redis"],
          description: "Tipo do banco de dados",
        },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "type", "confirm"],
    },
  },
];

function buildConnectionString(type: DbType, info: any): string {
  const host = info.internalHost ?? info.host ?? "localhost";
  const port = info.exposedPort ?? info.port;
  const user = info.username ?? (type === "mongo" ? "" : type);
  const pass = info.password ?? "";
  const db = info.database ?? info.dbName ?? (type === "mongo" ? "admin" : type);

  switch (type) {
    case "postgres":
      return `postgresql://${user}:${pass}@${host}${port ? `:${port}` : ""}/${db}`;
    case "mysql":
    case "mariadb":
      return `mysql://${user}:${pass}@${host}${port ? `:${port}` : ""}/${db}`;
    case "mongo":
      return `mongodb://${user ? `${user}:${pass}@` : ""}${host}${port ? `:${port}` : ""}/${db}`;
    case "redis":
      return `redis://${pass ? `:${pass}@` : ""}${host}${port ? `:${port}` : ""}`;
  }
}

type Args = Record<string, unknown>;

export async function handleDatabaseTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName, type } = args as {
    projectName: string;
    serviceName: string;
    type: DbType;
  };

  // Runtime allowlist — the JSON Schema enum is advisory only, not enforced by the MCP SDK
  if (!DB_TYPES.includes(type as DbType)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Tipo de banco inválido: "${type}". Valores aceitos: ${DB_TYPES.join(", ")}`
    );
  }

  const ctx = contextHeader(projectName, serviceName);

  if (name === "create_database") {
    const { password } = args as { password?: string };
    const payload: Record<string, unknown> = { projectName, serviceName };
    if (password) payload.password = password;
    await client.mutate(`services.${type}.createService`, payload);
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "banco_criado",
            tipo: type,
            projectName,
            serviceName,
            proximo_passo: "Use inspect_database para obter as credenciais e connection string",
          }),
        },
      ],
    };
  }

  if (name === "inspect_database") {
    const info = await client.query<any>(`services.${type}.inspectService`, {
      projectName,
      serviceName,
    });
    const connectionString = buildConnectionString(type, info);
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            ...info,
            connection_string: connectionString,
          }),
        },
      ],
    };
  }

  if (name === "destroy_database") {
    const { confirm } = args as { confirm: string };
    const blocked = guardDestructive(
      confirm,
      "destroy_database",
      `banco ${type} "${serviceName}" no projeto "${projectName}" — TODOS OS DADOS SERÃO PERDIDOS`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate(`services.${type}.destroyService`, { projectName, serviceName });
    return {
      content: [
        { type: "text" as const, text: ok(ctx, { status: "banco_destruido", tipo: type, projectName, serviceName }) },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
