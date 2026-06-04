import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

const SENSITIVE_PATTERN = /secret|password|token|key|pwd|credential|private|auth/i;

export const envTools: Tool[] = [
  {
    name: "get_env_vars",
    description:
      "Lista as variáveis de ambiente do serviço. Valores de variáveis sensíveis (KEY, SECRET, PASSWORD, TOKEN) são mascarados por padrão. Use include_values: true para ver os valores completos.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        include_values: {
          type: "boolean",
          description: "Se true, exibe valores completos incluindo segredos (use com cautela)",
          default: false,
        },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "set_env_var",
    description:
      "Adiciona ou atualiza UMA variável de ambiente. Lê o estado atual antes de escrever — não apaga outras variáveis.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        key: { type: "string", description: "Nome da variável (ex: DATABASE_URL)" },
        value: { type: "string", description: "Valor da variável" },
      },
      required: ["projectName", "serviceName", "key", "value"],
    },
  },
  {
    name: "delete_env_var",
    description: `⚠️ Remove UMA variável de ambiente. Lê estado atual antes de escrever. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        key: { type: "string", description: "Nome da variável a remover" },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "key", "confirm"],
    },
  },
];

function parseEnvString(envStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of envStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    if (!key) continue; // skip malformed lines with empty key
    result[key] = trimmed.slice(idx + 1);
  }
  return result;
}

function serializeEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v.replace(/\r?\n/g, "\\n")}`)
    .join("\n");
}

function maskSensitiveValues(
  vars: Record<string, string>,
  reveal: boolean
): Record<string, string> {
  if (reveal) return vars;
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [
      k,
      SENSITIVE_PATTERN.test(k) ? `***${v.slice(-4)}` : v,
    ])
  );
}

function validateKeyValue(key: string, value: string): void {
  if (/[\r\n]/.test(key)) {
    throw new McpError(ErrorCode.InvalidParams, "key não pode conter quebras de linha");
  }
  if (/[\r\n]/.test(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "value não pode conter quebras de linha literais. Use \\n para representar nova linha."
    );
  }
}

type Args = Record<string, unknown>;

export async function handleEnvTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  const ctx = contextHeader(projectName, serviceName);

  async function readCurrentEnv(): Promise<Record<string, string>> {
    const service = await client.query<{ env: string }>("services.app.inspectService", {
      projectName,
      serviceName,
    });
    return parseEnvString(service.env ?? "");
  }

  if (name === "get_env_vars") {
    const { include_values = false } = args as { include_values?: boolean };
    const vars = await readCurrentEnv();
    const displayed = maskSensitiveValues(vars, Boolean(include_values));
    const sensitiveCount = Object.keys(vars).filter((k) => SENSITIVE_PATTERN.test(k)).length;
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            projectName,
            serviceName,
            total_vars: Object.keys(vars).length,
            masked_vars: include_values ? 0 : sensitiveCount,
            env_vars: displayed,
            nota: include_values ? null : "Variáveis sensíveis estão mascaradas. Use include_values: true para ver valores completos.",
          }),
        },
      ],
    };
  }

  if (name === "set_env_var") {
    const { key, value } = args as { key: string; value: string };
    validateKeyValue(key, value);
    const current = await readCurrentEnv();
    const isNew = !(key in current);
    current[key] = value;
    await client.mutate("services.app.updateEnv", {
      projectName,
      serviceName,
      env: serializeEnvVars(current),
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: isNew ? "variavel_criada" : "variavel_atualizada",
            key,
            total_vars_apos: Object.keys(current).length,
            aviso: "Faça um deploy para aplicar a mudança em produção",
          }),
        },
      ],
    };
  }

  if (name === "delete_env_var") {
    const { key, confirm } = args as { key: string; confirm: string };
    const blocked = guardDestructive(
      confirm,
      "delete_env_var",
      `variável "${key}" do serviço "${serviceName}"`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };

    const current = await readCurrentEnv();
    if (!(key in current)) {
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, { status: "variavel_nao_encontrada", key, info: "Nenhuma alteração feita" }),
          },
        ],
      };
    }
    delete current[key];
    await client.mutate("services.app.updateEnv", {
      projectName,
      serviceName,
      env: serializeEnvVars(current),
    });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "variavel_removida",
            key,
            total_vars_apos: Object.keys(current).length,
            aviso: "Faça um deploy para aplicar a mudança em produção",
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
