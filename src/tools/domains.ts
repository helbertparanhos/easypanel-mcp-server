import { randomBytes } from "node:crypto";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import { contextHeader, guardDestructive, ok, CONFIRM_KEYWORD } from "../context.js";

export const domainTools: Tool[] = [
  {
    name: "list_domains",
    description: "Lista todos os domínios configurados em um serviço.",
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
    name: "add_domain",
    description:
      "Adiciona um domínio customizado ao serviço com HTTPS automático via Let's Encrypt.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        host: { type: "string", description: "Hostname do domínio (ex: app.meusite.com)" },
        port: { type: "number", description: "Porta interna do serviço (ex: 3000, 8080)" },
        https: {
          type: "boolean",
          description: "Ativar HTTPS com Let's Encrypt (default: true)",
          default: true,
        },
        path: {
          type: "string",
          description: "Caminho base (default: /)",
          default: "/",
        },
      },
      required: ["projectName", "serviceName", "host", "port"],
    },
  },
  {
    name: "remove_domain",
    description: `⚠️ Remove permanentemente um domínio. O tráfego para esse host parará de funcionar. Requer confirm: "${CONFIRM_KEYWORD}".`,
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        domainId: {
          type: "string",
          description: "ID do domínio a remover (obtido via list_domains)",
        },
        confirm: {
          type: "string",
          description: `Confirmação obrigatória. Deve ser exatamente "${CONFIRM_KEYWORD}"`,
        },
      },
      required: ["projectName", "serviceName", "domainId", "confirm"],
    },
  },
  {
    name: "set_primary_domain",
    description: "Define qual domínio é o primário (usado como URL principal do serviço).",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        domainId: {
          type: "string",
          description: "ID do domínio a tornar primário (obtido via list_domains)",
        },
      },
      required: ["projectName", "serviceName", "domainId"],
    },
  },
];

function generateDomainId(): string {
  // Use CSPRNG — Math.random() is predictable and unsuitable for IDs used as auth keys
  return "cm" + randomBytes(13).toString("hex").slice(0, 22);
}

type Args = Record<string, unknown>;

export async function handleDomainTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  const ctx = contextHeader(projectName, serviceName);

  if (name === "list_domains") {
    const result = await client.query("domains.listDomains", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "add_domain") {
    const { host, port, https = true, path = "/" } = args as {
      host: string;
      port: number;
      https?: boolean;
      path?: string;
    };
    const domainPayload = {
      id: generateDomainId(),
      https,
      host,
      path,
      middlewares: [],
      certificateResolver: "",
      wildcard: false,
      destinationType: "service",
      serviceDestination: {
        protocol: "http",
        port: Number(port),
        path: "/",
        projectName,
        serviceName,
        composeService: "",
      },
    };
    const result = await client.mutate("domains.createDomain", domainPayload);
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "dominio_adicionado",
            host,
            https,
            port,
            resultado: result,
          }),
        },
      ],
    };
  }

  if (name === "remove_domain") {
    const { domainId, confirm } = args as { domainId: string; confirm: string };
    const blocked = guardDestructive(
      confirm,
      "remove_domain",
      `domínio ID "${domainId}" do serviço "${serviceName}"`
    );
    if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    await client.mutate("domains.deleteDomain", { id: domainId });
    return {
      content: [{ type: "text" as const, text: ok(ctx, { status: "dominio_removido", domainId }) }],
    };
  }

  if (name === "set_primary_domain") {
    const { domainId } = args as { domainId: string };
    await client.mutate("domains.setPrimaryDomain", { id: domainId });
    return {
      content: [{ type: "text" as const, text: ok(ctx, { status: "dominio_primario_definido", domainId }) }],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
