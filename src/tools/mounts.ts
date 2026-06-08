import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getClient } from "../client.js";
import {
  contextHeader,
  ok,
  assertValidName,
  guardDestructive,
  CONFIRM_KEYWORD,
} from "../context.js";

/**
 * Detecta bind mounts perigosos: montar caminhos sensíveis do host dentro do
 * container expõe (ou permite escrever em) o filesystem do servidor — escape de
 * container efetivo. `/var/run/docker.sock` é o caso mais grave (controle total
 * do Docker host). Exigimos confirmação explícita nesses casos.
 */
function looksDangerousHostPath(hostPath: string): boolean {
  const p = String(hostPath).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (p === "/" || p === "") return true;
  if (/\/(docker\.sock)$/i.test(p)) return true;
  return /^\/(etc|var|usr|bin|sbin|root|boot|lib|lib64|sys|proc|dev|opt|home|srv)(\/|$)/i.test(p);
}

export const mountTools: Tool[] = [
  {
    name: "list_mounts",
    description:
      "Lista os volumes/mounts de um serviço (volumes nomeados, bind mounts e arquivos montados). Use para ver onde os dados persistentes do serviço estão.",
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
    name: "create_mount",
    description:
      "Adiciona um volume/mount a um serviço para persistir dados entre deploys. Use type 'volume' para volume nomeado gerenciado, 'bind' para mapear um caminho do host. Aplica no próximo deploy.",
    inputSchema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "Nome do projeto" },
        serviceName: { type: "string", description: "Nome do serviço" },
        type: {
          type: "string",
          enum: ["volume", "bind"],
          description: "'volume' (nomeado, gerenciado pelo Docker) ou 'bind' (caminho do host)",
        },
        mountPath: { type: "string", description: "Caminho dentro do container, ex: /app/data" },
        name: { type: "string", description: "Nome do volume (apenas para type=volume)" },
        hostPath: { type: "string", description: "Caminho no host (apenas para type=bind)" },
        confirm: {
          type: "string",
          description: `Obrigatório apenas para bind mounts de caminhos sensíveis do host (/, /etc, docker.sock, etc). Deve ser "${CONFIRM_KEYWORD}".`,
        },
      },
      required: ["projectName", "serviceName", "type", "mountPath"],
    },
  },
];

type Args = Record<string, unknown>;

export async function handleMountTool(name: string, args: Args) {
  const client = getClient();
  const { projectName, serviceName } = args as { projectName: string; serviceName: string };
  assertValidName(projectName, "projectName");
  assertValidName(serviceName, "serviceName");
  const ctx = contextHeader(projectName, serviceName);

  if (name === "list_mounts") {
    const result = await client.query("mounts.listMounts", { projectName, serviceName });
    return { content: [{ type: "text" as const, text: ok(ctx, result) }] };
  }

  if (name === "create_mount") {
    const { type, mountPath, name: volumeName, hostPath, confirm } = args as {
      type: string;
      mountPath: string;
      name?: string;
      hostPath?: string;
      confirm?: string;
    };

    // Bind mount apontando para caminho sensível do host = escape de container.
    // Exige CONFIRMO explícito, como as demais ações perigosas do servidor.
    if (type === "bind" && hostPath && looksDangerousHostPath(hostPath)) {
      const blocked = guardDestructive(
        confirm,
        "create_mount",
        `bind mount de caminho sensível do host ("${hostPath}") no serviço "${serviceName}" — expõe o filesystem do servidor ao container`
      );
      if (blocked) return { content: [{ type: "text" as const, text: ctx + blocked }] };
    }

    // A API espera a config do mount aninhada em `values` (descoberto em teste real).
    const values: Record<string, unknown> = { type, mountPath };
    if (volumeName !== undefined) values.name = volumeName;
    if (hostPath !== undefined) values.hostPath = hostPath;
    await client.mutate("mounts.createMount", { projectName, serviceName, values });
    return {
      content: [
        {
          type: "text" as const,
          text: ok(ctx, {
            status: "mount_criado",
            mount: values,
            dica: "Faça deploy_service para aplicar.",
          }),
        },
      ],
    };
  }

  throw new Error(`Tool desconhecida: ${name}`);
}
