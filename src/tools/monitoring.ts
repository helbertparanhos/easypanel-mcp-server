import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok } from "../context.js";

export const monitoringTools: Tool[] = [
  {
    name: "get_docker_stats",
    description:
      "Retorna estatísticas dos containers Docker em execução: CPU, memória, rede por container.",
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
      "Retorna métricas de um serviço específico: CPU e memória do container.",
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
    // getDockerTaskStats retorna um objeto chaveado pelo nome do serviço Docker
    // (`${projectName}_${serviceName}`), não um array. Indexamos a chave exata —
    // antes o código retornava as métricas de TODOS os serviços por engano.
    const result = await client.query<Record<string, unknown>>("monitorOld.getDockerTaskStats");
    const key = `${projectName}_${serviceName}`;
    const stats =
      result && typeof result === "object" && !Array.isArray(result) ? result[key] : undefined;
    if (stats === undefined) {
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
    return { content: [{ type: "text" as const, text: ok(ctx, stats) }] };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
