import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok } from "../context.js";

export const monitoringTools: Tool[] = [
  {
    name: "get_docker_stats",
    description:
      "Retorna o estado das tasks Docker de cada serviço: réplicas em execução (actual) vs desejadas (desired). Use para ver rapidamente o que está no ar, escalado ou caído. Para CPU/memória de um serviço use get_service_stats.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_storage_stats",
    description: "Retorna uso de armazenamento do servidor.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_service_stats",
    description:
      "Retorna métricas de um serviço específico: CPU, memória e rede do container.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
      },
      required: ["projectName", "serviceName"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleMonitoringTool(name: string, args: Args) {
  const client = getClient();

  if (name === "get_docker_stats") {
    const result = await client.query("monitorOld.getDockerTaskStats");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "get_storage_stats") {
    const result = await client.query("monitorOld.getStorageStats");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "get_service_stats") {
    const { projectName, serviceName } = args as { projectName: string; serviceName: string };
    const ctx = contextHeader(projectName, serviceName);

    // `getServiceStats` devolve o que a tool promete — { cpu:{percent},
    // memory:{percent,usage}, network:{in,out} }. Até a v2 esta tool lia
    // `getDockerTaskStats`, que só traz contagem de réplicas ({actual,desired}):
    // o retorno não tinha nada de CPU/memória apesar da descrição.
    try {
      const stats = await client.query<unknown>("monitorOld.getServiceStats", {
        projectName,
        serviceName,
      });
      if (stats !== null && stats !== undefined) {
        return { content: [{ type: "text" as const, text: ok(ctx, stats) }] };
      }
    } catch {
      // Painel antigo sem essa procedure — cai nas réplicas abaixo, rotuladas
      // pelo que realmente são.
    }

    // Fallback: estado das tasks. O objeto vem chaveado pelo nome do serviço
    // Docker (`${projectName}_${serviceName}`), não é um array.
    const result = await client.query<Record<string, unknown>>("monitorOld.getDockerTaskStats");
    const key = `${projectName}_${serviceName}`;
    const replicas =
      result && typeof result === "object" && !Array.isArray(result) ? result[key] : undefined;
    if (replicas === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: ok(ctx, {
              aviso: `Sem métricas para "${key}". O serviço pode estar parado.`,
              servicos_disponiveis:
                result && typeof result === "object" ? Object.keys(result) : [],
            }),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            aviso: "Métricas de CPU/memória indisponíveis neste painel; retornando o estado das réplicas.",
            replicas,
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
