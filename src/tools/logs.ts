import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok } from "../context.js";

export const logTools: Tool[] = [
  {
    name: "get_service_logs",
    description:
      "Busca os logs do container de um serviço. Use para debugar erros em runtime. Retorna as últimas N linhas.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        lines: {
          type: "number",
          description: "Número de linhas a retornar (default: 100, max: 500)",
          default: 100,
        },
      },
      required: ["projectName", "serviceName"],
    },
  },
  {
    name: "get_build_logs",
    description:
      "Retorna os logs de build/deploy do último action registrado para o serviço. Use para debugar falhas de build.",
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
    name: "get_system_stats",
    description:
      "Retorna métricas do servidor: CPU, memória, disco, rede e uptime. Use para verificar saúde do servidor.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

type Args = Record<string, unknown>;

export async function handleLogTool(name: string, args: Args) {
  const client = getClient();

  if (name === "get_service_logs") {
    const { projectName, serviceName, lines = 100 } = args as {
      projectName: string;
      serviceName: string;
      lines?: number;
    };
    const ctx = contextHeader(projectName, serviceName);
    const safeLines = Math.min(Number(lines) || 100, 500);

    // Encode path components to prevent path traversal
    const safePath = `/api/logs/${encodeURIComponent(projectName)}/${encodeURIComponent(serviceName)}?lines=${safeLines}`;

    try {
      const res = await client.fetchRaw(safePath);
      if (res.ok) {
        const text = await res.text();
        return { content: [{ type: "text" as const, text: ctx + text }] };
      }
    } catch {
      // Log endpoint may not exist; fall through to service error fallback
    }

    const error = await client.query("services.common.getServiceError", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            aviso: "Endpoint de logs em tempo real indisponível. Retornando último erro registrado.",
            ultimo_erro: error,
            alternativa: "Use list_actions para ver logs de builds recentes",
          }),
        },
      ],
    };
  }

  if (name === "get_build_logs") {
    const { projectName, serviceName } = args as {
      projectName: string;
      serviceName: string;
    };
    const ctx = contextHeader(projectName, serviceName);

    const actions = await client.query<any[]>("actions.listActions");
    // Use && so we only match actions for this exact project+service combination
    const relevant = Array.isArray(actions)
      ? actions
          .filter(
            (a: any) =>
              a.projectName === projectName && a.serviceName === serviceName
          )
          .slice(0, 5)
      : actions;

    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            projectName,
            serviceName,
            acoes_recentes: relevant,
            dica: "Use get_action com o ID de uma ação para ver logs completos",
          }),
        },
      ],
    };
  }

  if (name === "get_system_stats") {
    const stats = await client.query("monitorOld.getSystemStats");
    return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
