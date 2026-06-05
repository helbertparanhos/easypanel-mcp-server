import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok, assertValidName } from "../context.js";

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
    assertValidName(projectName, "projectName");
    assertValidName(serviceName, "serviceName");
    const ctx = contextHeader(projectName, serviceName);
    const safeLines = Math.min(Number(lines) || 100, 500);

    // Logs de runtime do container chegam pelo WebSocket /ws/serviceLogs — o mesmo
    // canal usado pela aba "Logs" da UI do Easypanel. O nome do serviço Docker é
    // `${projectName}_${serviceName}`. Não depende do Advanced Logs (Loki/licença).
    const dockerService = `${projectName}_${serviceName}`;
    try {
      const logs = await client.streamServiceLogs(dockerService, { maxLines: safeLines });
      const body = logs.trim().length > 0 ? logs : "(container sem saída de log recente)";
      return { content: [{ type: "text" as const, text: ctx + body }] };
    } catch {
      // Falha ao abrir o stream (serviço inexistente/parado, ou token sem acesso).
      // Faz fallback para o último erro registrado do serviço.
    }

    const error = await client.query("services.common.getServiceError", { projectName, serviceName });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            aviso:
              "Não foi possível ler os logs de runtime via WebSocket (o serviço pode estar parado, não existir, ou o token não ter acesso). Retornando o último erro registrado.",
            ultimo_erro: error,
            alternativa: "Use get_build_logs para ver os logs do último deploy/build.",
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

    // actions.listActions filtra no servidor por projeto/serviço/tipo. Buscamos as
    // deployments mais recentes deste serviço (a lista global só guarda uma janela
    // curta, então o filtro server-side é essencial para não "perder" o serviço).
    const relevant = await client.query<any[]>("actions.listActions", {
      projectName,
      serviceName,
      type: "deployment",
      limit: 5,
    });

    const latest = Array.isArray(relevant) ? relevant[0] : undefined;
    if (!latest) {
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, {
              aviso: "Nenhuma ação de build/deploy encontrada para este serviço.",
              projectName,
              serviceName,
            }),
          },
        ],
      };
    }

    // O log completo do build fica no campo `log` de actions.getAction.
    const detail = await client.query<any>("actions.getAction", { id: latest.id });
    const buildLog: string =
      typeof detail?.log === "string" ? detail.log : "(sem log disponível para esta ação)";

    return {
      content: [
        {
          type: "text" as const,
          text:
            ctx +
            JSON.stringify(
              {
                projectName,
                serviceName,
                acao: {
                  id: latest.id,
                  tipo: latest.type,
                  status: latest.status,
                  descricao: latest.description,
                  criado_em: latest.createdAt,
                },
                acoes_recentes: relevant.slice(0, 5).map((a: any) => ({
                  id: a.id,
                  tipo: a.type,
                  status: a.status,
                  criado_em: a.createdAt,
                })),
              },
              null,
              2
            ) +
            "\n\n--- LOG DO BUILD ---\n" +
            buildLog,
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
