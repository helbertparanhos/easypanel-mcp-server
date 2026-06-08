import { Tool, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, ok, assertValidName, guardDestructive, CONFIRM_KEYWORD } from "../context.js";

function assertValidPort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new McpError(ErrorCode.InvalidParams, `${field} inválido. Use um inteiro entre 1 e 65535.`);
  }
  return value;
}

export const portTools: Tool[] = [
  {
    name: "list_ports",
    description:
      "Lista os mapeamentos de porta de um serviço (porta publicada no host → porta do container). Complementa get_exposed_ports com a configuração completa de portas. Use para ver o que está exposto e em qual protocolo.",
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
    name: "create_port",
    description: `Publica uma porta de um serviço no host (port mapping), expondo-a externamente sem passar pelo proxy/domínio. Útil para TCP/UDP brutos (bancos, jogos, etc). Aplica no próximo deploy. ⚠️ Portas privilegiadas (publishedPort < 1024, ex: 80/443/22) exigem confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        publishedPort: { type: "number", description: "Porta externa (no host)" },
        targetPort: { type: "number", description: "Porta interna (no container)" },
        protocol: {
          type: "string",
          enum: ["tcp", "udp"],
          description: "Protocolo (default: tcp)",
        },
        confirm: {
          type: "string",
          description: `Obrigatório apenas para publishedPort < 1024. Deve ser "${CONFIRM_KEYWORD}".`,
        },
      },
      required: ["projectName", "serviceName", "publishedPort", "targetPort"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handlePortTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  assertValidName(projectName, "projectName");
  assertValidName(serviceName, "serviceName");
  const ctx = contextHeader(projectName, serviceName);

  if (name === "list_ports") {
    const result = await client.query("ports.listPorts", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "create_port") {
    const { publishedPort, targetPort, protocol, confirm } = args as {
      publishedPort: number;
      targetPort: number;
      protocol?: string;
      confirm?: string;
    };
    assertValidPort(publishedPort, "publishedPort");
    assertValidPort(targetPort, "targetPort");
    // Portas privilegiadas (<1024: 22/80/443/...) expostas diretamente no host são
    // uma decisão de segurança relevante — exigem confirmação explícita.
    if (publishedPort < 1024) {
      const blocked = guardDestructive(
        confirm,
        "create_port",
        `publicar porta privilegiada ${publishedPort} do serviço "${serviceName}" diretamente no host`
      );
      if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    }
    // A API espera os campos em `values` com os nomes published/target (não
    // publishedPort/targetPort) — descoberto em teste real.
    const payload = {
      projectName,
      serviceName,
      values: {
        published: publishedPort,
        target: targetPort,
        protocol: protocol ?? "tcp",
      },
    };
    await client.mutate("ports.createPort", payload);
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "porta_publicada",
            porta: payload.values,
            dica: "Faça deploy_service para aplicar.",
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
