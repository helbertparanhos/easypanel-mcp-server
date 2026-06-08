import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { guardDestructive, CONFIRM_KEYWORD } from "../context.js";

export const maintenanceTools: Tool[] = [
  {
    name: "prune_docker",
    description: `Executa um "docker system prune" no servidor inteiro via Easypanel: remove containers parados, redes sem uso, cache de build e imagens não referenciadas para liberar espaço em disco. ⚠️ Ação destrutiva e de escopo GLOBAL (afeta todos os projetos do servidor, não um serviço específico) — exige confirm: "${CONFIRM_KEYWORD}". Use cleanup_docker_images para uma limpeza mais leve (só imagens não usadas).`,
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "string",
          description: `Obrigatório. Deve ser exatamente "${CONFIRM_KEYWORD}" para confirmar a limpeza global.`,
        },
      },
      required: [],
    },
  },
  {
    name: "cleanup_docker_images",
    description:
      "Remove do servidor apenas as imagens Docker não utilizadas (dangling/sem container), liberando espaço sem mexer em containers, redes ou volumes. Operação mais leve e segura que prune_docker — imagens podem ser recriadas em um novo deploy. Escopo global do servidor.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

type Args = Record<string, unknown>;

export async function handleMaintenanceTool(name: string, args: Args) {
  const client = getClient();

  if (name === "prune_docker") {
    const { confirm } = args as { confirm?: string };
    const blocked = guardDestructive(
      confirm,
      "prune_docker",
      "docker system prune no SERVIDOR INTEIRO (todos os projetos): remove containers parados, redes, cache de build e imagens não usadas"
    );
    if (blocked) return { content: [{ type: "text" as const, text: blocked }] };

    const result = await client.mutate("settings.systemPrune");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "OK",
              acao: "docker system prune executado no servidor",
              resultado: result ?? "(sem retorno da API — prune concluído)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "cleanup_docker_images") {
    const result = await client.mutate("settings.cleanupDockerImages");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "OK",
              acao: "imagens Docker não utilizadas removidas",
              resultado: result ?? "(sem retorno da API — limpeza concluída)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
